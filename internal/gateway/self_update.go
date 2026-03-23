package gateway

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const (
	// maxBinarySize is the maximum allowed extracted binary size (500 MB).
	maxBinarySize = 500 << 20
	// downloadTimeout is the HTTP timeout for downloading release assets.
	downloadTimeout = 5 * time.Minute
)

// downloadClient is an HTTP client with a timeout for downloading release assets.
var downloadClient = &http.Client{Timeout: downloadTimeout}

// InstallMethod represents how GoClaw was installed.
type InstallMethod string

const (
	InstallBinary InstallMethod = "binary"
	InstallSource InstallMethod = "source"
	InstallDocker InstallMethod = "docker"
)

// SelfUpdater handles downloading, verifying, and swapping the GoClaw binary.
type SelfUpdater struct {
	binaryPath string
	repo       string
}

// NewSelfUpdater creates a SelfUpdater for the current binary.
func NewSelfUpdater() (*SelfUpdater, error) {
	exe, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("resolve executable: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(exe)
	if err != nil {
		return nil, fmt.Errorf("resolve symlinks: %w", err)
	}
	return &SelfUpdater{
		binaryPath: resolved,
		repo:       GithubRepo,
	}, nil
}

// BinaryPath returns the resolved path to the current binary.
func (su *SelfUpdater) BinaryPath() string { return su.binaryPath }

// DetectInstallMethod determines how GoClaw was installed.
func DetectInstallMethod() InstallMethod {
	// Docker: check for /.dockerenv or /run/.containerenv
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return InstallDocker
	}
	if _, err := os.Stat("/run/.containerenv"); err == nil {
		return InstallDocker
	}

	// Source: check if binary's directory contains .git + go.mod
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			dir = filepath.Dir(resolved)
		}
		gitPath := filepath.Join(dir, ".git")
		modPath := filepath.Join(dir, "go.mod")
		if _, e1 := os.Stat(gitPath); e1 == nil {
			if _, e2 := os.Stat(modPath); e2 == nil {
				return InstallSource
			}
		}
	}

	return InstallBinary
}

// AssetName returns the tarball filename for a given version.
func AssetName(version string) string {
	ver := strings.TrimPrefix(version, "v")
	return fmt.Sprintf("goclaw-%s-%s-%s.tar.gz", ver, runtime.GOOS, runtime.GOARCH)
}

// downloadURL returns the GitHub release download URL for an asset.
func (su *SelfUpdater) downloadURL(version, asset string) string {
	return fmt.Sprintf("https://github.com/%s/releases/download/%s/%s", su.repo, version, asset)
}

// DownloadRelease downloads the release tarball to a temp directory.
// Returns the path to the downloaded tarball.
func (su *SelfUpdater) DownloadRelease(version string) (string, error) {
	asset := AssetName(version)
	url := su.downloadURL(version, asset)

	tmpDir, err := os.MkdirTemp("", "goclaw-update-*")
	if err != nil {
		return "", fmt.Errorf("create temp dir: %w", err)
	}

	tarballPath := filepath.Join(tmpDir, asset)
	slog.Info("downloading release", "url", url)

	resp, err := downloadClient.Get(url) //nolint:gosec // URL is constructed from known repo
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}

	f, err := os.Create(tarballPath)
	if err != nil {
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("create file: %w", err)
	}

	if _, err := io.Copy(f, resp.Body); err != nil {
		f.Close()
		os.RemoveAll(tmpDir)
		return "", fmt.Errorf("write file: %w", err)
	}
	f.Close()

	return tarballPath, nil
}

// VerifyChecksum verifies the SHA256 checksum of a downloaded tarball
// against the checksums file from the GitHub release.
func (su *SelfUpdater) VerifyChecksum(tarballPath, version string) error {
	checksumURL := su.downloadURL(version, fmt.Sprintf("goclaw-%s-checksums.txt", strings.TrimPrefix(version, "v")))

	resp, err := downloadClient.Get(checksumURL) //nolint:gosec
	if err != nil {
		return fmt.Errorf("download checksums: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("checksums file: HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("read checksums: %w", err)
	}

	// Parse checksums file: each line is "hash  filename"
	expectedHash := ""
	tarballName := filepath.Base(tarballPath)
	for _, line := range strings.Split(string(body), "\n") {
		parts := strings.Fields(line)
		if len(parts) == 2 && parts[1] == tarballName {
			expectedHash = parts[0]
			break
		}
	}

	if expectedHash == "" {
		return fmt.Errorf("checksum not found for %s", tarballName)
	}

	// Compute actual hash.
	f, err := os.Open(tarballPath)
	if err != nil {
		return fmt.Errorf("open tarball: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return fmt.Errorf("hash tarball: %w", err)
	}
	actualHash := hex.EncodeToString(h.Sum(nil))

	if actualHash != expectedHash {
		return fmt.Errorf("checksum mismatch: expected %s, got %s", expectedHash, actualHash)
	}

	return nil
}

// ExtractAndSwap extracts the binary from tarball and atomically replaces the current binary.
func (su *SelfUpdater) ExtractAndSwap(tarballPath string) error {
	tmpDir := filepath.Dir(tarballPath)

	// Extract goclaw binary from tarball.
	newBinaryPath, err := extractBinaryFromTarball(tarballPath, tmpDir)
	if err != nil {
		return err
	}

	// Preserve original permissions.
	origInfo, err := os.Stat(su.binaryPath)
	if err != nil {
		return fmt.Errorf("stat current binary: %w", err)
	}
	if err := os.Chmod(newBinaryPath, origInfo.Mode()); err != nil {
		return fmt.Errorf("chmod new binary: %w", err)
	}

	// Atomic swap: current → .old, new → current.
	oldPath := su.binaryPath + ".old"
	if err := os.Rename(su.binaryPath, oldPath); err != nil {
		return fmt.Errorf("backup current binary: %w", err)
	}

	if err := os.Rename(newBinaryPath, su.binaryPath); err != nil {
		// Rollback: restore old binary.
		if rbErr := os.Rename(oldPath, su.binaryPath); rbErr != nil {
			slog.Error("CRITICAL: failed to rollback binary swap", "error", rbErr)
		}
		return fmt.Errorf("swap binary: %w", err)
	}

	// Cleanup old binary.
	os.Remove(oldPath)
	return nil
}

// Update performs the full update flow: download → verify → swap.
func (su *SelfUpdater) Update(version string) error {
	tarballPath, err := su.DownloadRelease(version)
	if err != nil {
		return err
	}
	defer os.RemoveAll(filepath.Dir(tarballPath))

	if err := su.VerifyChecksum(tarballPath, version); err != nil {
		return err
	}

	return su.ExtractAndSwap(tarballPath)
}

// extractBinaryFromTarball finds and extracts the goclaw binary from a .tar.gz.
func extractBinaryFromTarball(tarballPath, destDir string) (string, error) {
	f, err := os.Open(tarballPath)
	if err != nil {
		return "", fmt.Errorf("open tarball: %w", err)
	}
	defer f.Close()

	gz, err := gzip.NewReader(f)
	if err != nil {
		return "", fmt.Errorf("gzip reader: %w", err)
	}
	defer gz.Close()

	tr := tar.NewReader(gz)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("tar read: %w", err)
		}

		// Look for the goclaw binary (may be at root or in a subdirectory).
		name := filepath.Base(hdr.Name)
		if name != "goclaw" || hdr.Typeflag != tar.TypeReg {
			continue
		}

		outPath := filepath.Join(destDir, "goclaw-new")
		out, err := os.OpenFile(outPath, os.O_CREATE|os.O_WRONLY, 0o755)
		if err != nil {
			return "", fmt.Errorf("create binary: %w", err)
		}

		if _, err := io.Copy(out, io.LimitReader(tr, maxBinarySize)); err != nil {
			out.Close()
			return "", fmt.Errorf("extract binary: %w", err)
		}
		out.Close()
		return outPath, nil
	}

	return "", fmt.Errorf("goclaw binary not found in tarball")
}
