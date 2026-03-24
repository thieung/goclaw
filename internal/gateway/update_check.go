package gateway

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	// GithubRepo is the GitHub repository for version checks.
	GithubRepo          = "nextlevelbuilder/goclaw"
	defaultCheckInterval = 1 * time.Hour
)

// UpdateMode controls the auto-update behavior.
type UpdateMode string

const (
	UpdateModeOff      UpdateMode = "off"
	UpdateModeNotify   UpdateMode = "notify"
	UpdateModeDownload UpdateMode = "download"
)

// UpdateInfo holds the latest release information from GitHub.
type UpdateInfo struct {
	LatestVersion   string `json:"latestVersion"`
	UpdateURL       string `json:"updateUrl"`
	UpdateAvailable bool   `json:"updateAvailable"`
	Downloaded      bool   `json:"downloaded"` // binary downloaded, ready to swap on restart
}

// UpdateCheckerConfig holds config for the update checker.
type UpdateCheckerConfig struct {
	Mode          string // "off", "notify", "download"
	CheckInterval string // duration string, e.g. "1h"
}

// UpdateChecker periodically checks GitHub for new releases.
type UpdateChecker struct {
	currentVersion string
	mode           UpdateMode
	checkInterval  time.Duration
	mu             sync.RWMutex
	info           *UpdateInfo
}

// NewUpdateChecker creates an UpdateChecker for the given current version.
func NewUpdateChecker(currentVersion string, cfg UpdateCheckerConfig) *UpdateChecker {
	mode := UpdateModeNotify
	switch UpdateMode(cfg.Mode) {
	case UpdateModeOff, UpdateModeDownload:
		mode = UpdateMode(cfg.Mode)
	}

	interval := defaultCheckInterval
	if cfg.CheckInterval != "" {
		if d, err := time.ParseDuration(cfg.CheckInterval); err == nil && d > 0 {
			interval = d
		}
	}

	return &UpdateChecker{
		currentVersion: currentVersion,
		mode:           mode,
		checkInterval:  interval,
	}
}

// Start begins periodic update checking. Call with a cancellable context.
func (uc *UpdateChecker) Start(ctx context.Context) {
	if uc.mode == UpdateModeOff {
		slog.Debug("update checker disabled")
		return
	}

	// Initial check after short delay (don't block startup)
	go func() {
		select {
		case <-time.After(5 * time.Second):
		case <-ctx.Done():
			return
		}
		uc.check()

		ticker := time.NewTicker(uc.checkInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				uc.check()
			case <-ctx.Done():
				return
			}
		}
	}()
}

// Info returns the cached update info, or nil if not yet checked.
func (uc *UpdateChecker) Info() *UpdateInfo {
	uc.mu.RLock()
	defer uc.mu.RUnlock()
	return uc.info
}

func (uc *UpdateChecker) check() {
	tagName, htmlURL, err := FetchLatestRelease(uc.currentVersion)
	if err != nil {
		slog.Warn("update check: failed", "error", err)
		return
	}

	if tagName == "" {
		return
	}

	info := &UpdateInfo{
		LatestVersion:   tagName,
		UpdateURL:       htmlURL,
		UpdateAvailable: IsNewer(uc.currentVersion, tagName),
	}

	if info.UpdateAvailable {
		slog.Info("new version available", "current", uc.currentVersion, "latest", tagName)

		// In download mode, background-download the new binary.
		if uc.mode == UpdateModeDownload {
			info.Downloaded = uc.backgroundDownload(tagName)
		}
	}

	uc.mu.Lock()
	uc.info = info
	uc.mu.Unlock()
}

// backgroundDownload downloads and verifies a new binary, placing it next to the current binary.
// Returns true if download succeeded.
func (uc *UpdateChecker) backgroundDownload(version string) bool {
	su, err := NewSelfUpdater()
	if err != nil {
		slog.Warn("update download: failed to create updater", "error", err)
		return false
	}

	// Check if already downloaded and non-empty.
	newPath := su.BinaryPath() + ".new"
	if fi, err := os.Stat(newPath); err == nil && fi.Size() > 0 {
		slog.Debug("update download: already downloaded", "path", newPath)
		return true
	}

	tarballPath, err := su.DownloadRelease(version)
	if err != nil {
		slog.Warn("update download: download failed", "error", err)
		return false
	}
	defer os.RemoveAll(filepath.Dir(tarballPath))

	if err := su.VerifyChecksum(tarballPath, version); err != nil {
		slog.Warn("update download: checksum failed", "error", err)
		return false
	}

	// Extract binary to .new path.
	tmpDir := filepath.Dir(tarballPath)
	extractedPath, err := extractBinaryFromTarball(tarballPath, tmpDir)
	if err != nil {
		slog.Warn("update download: extract failed", "error", err)
		return false
	}

	// Move to final .new location.
	if err := os.Rename(extractedPath, newPath); err != nil {
		// Rename may fail across filesystems; fall back to copy.
		if err := copyFile(extractedPath, newPath); err != nil {
			slog.Warn("update download: place binary failed", "error", err)
			return false
		}
	}

	slog.Info("update: new version downloaded, restart to apply", "version", version, "path", newPath)
	return true
}

// copyFile copies src to dst, preserving permissions.
func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	defer out.Close()

	if _, err = io.Copy(out, in); err != nil {
		return err
	}
	return out.Sync()
}

// SwapPreDownloadedBinary checks for a pre-downloaded binary (.new) and swaps it in.
// Call this early in gateway startup before starting the update checker.
func SwapPreDownloadedBinary() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	binaryPath, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return
	}

	newPath := binaryPath + ".new"
	if _, err := os.Stat(newPath); err != nil {
		return // No pre-downloaded binary.
	}

	slog.Info("update: applying pre-downloaded binary", "path", newPath)

	oldPath := binaryPath + ".old"
	if err := os.Rename(binaryPath, oldPath); err != nil {
		slog.Error("update: failed to backup current binary", "error", err)
		return
	}

	if err := os.Rename(newPath, binaryPath); err != nil {
		slog.Error("update: failed to swap binary, rolling back", "error", err)
		os.Rename(oldPath, binaryPath) //nolint:errcheck
		return
	}

	os.Remove(oldPath)
	slog.Info("update: binary swapped successfully, running new version")
}

// FetchLatestRelease queries GitHub API for the latest release tag and URL.
func FetchLatestRelease(currentVersion string) (tagName, htmlURL string, err error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	url := fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GithubRepo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "goclaw/"+currentVersion)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("GitHub API: HTTP %d", resp.StatusCode)
	}

	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&release); err != nil {
		return "", "", err
	}

	return release.TagName, release.HTMLURL, nil
}

// IsNewer returns true if latest is a newer version than current.
// Compares by stripping "v" prefix and using semantic version comparison.
// Returns false if current is "dev" (development build).
func IsNewer(current, latest string) bool {
	current = strings.TrimPrefix(current, "v")
	latest = strings.TrimPrefix(latest, "v")

	if current == "dev" || current == "" || latest == "" {
		return false
	}
	if current == latest {
		return false
	}

	// Semantic version comparison: split by "." and compare numerically
	return compareSemver(latest, current) > 0
}

// compareSemver compares two semver strings (without "v" prefix).
// Returns >0 if a > b, <0 if a < b, 0 if equal.
// Handles pre-release suffixes by stripping them (e.g., "1.2.3-5-gabcdef").
func compareSemver(a, b string) int {
	partsA := parseSemver(a)
	partsB := parseSemver(b)

	for i := range 3 {
		va, vb := 0, 0
		if i < len(partsA) {
			va = partsA[i]
		}
		if i < len(partsB) {
			vb = partsB[i]
		}
		if va != vb {
			return va - vb
		}
	}
	return 0
}

func parseSemver(s string) []int {
	// Strip pre-release suffix: "1.2.3-5-gabcdef" → "1.2.3"
	if idx := strings.IndexByte(s, '-'); idx >= 0 {
		s = s[:idx]
	}
	parts := strings.Split(s, ".")
	nums := make([]int, 0, len(parts))
	for _, p := range parts {
		n, _ := strconv.Atoi(p)
		nums = append(nums, n)
	}
	return nums
}
