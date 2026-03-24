package cmd

import (
	"fmt"
	"log/slog"

	"github.com/spf13/cobra"

	"github.com/nextlevelbuilder/goclaw/internal/config"
	"github.com/nextlevelbuilder/goclaw/internal/gateway"
)

func updateCmd() *cobra.Command {
	var (
		targetVersion string
		dryRun        bool
		method        string
		force         bool
	)

	cmd := &cobra.Command{
		Use:   "update",
		Short: "Update GoClaw to the latest version",
		Long:  "Checks for new releases and updates the GoClaw binary. Detects installation method automatically.",
		RunE: func(cmd *cobra.Command, args []string) error {
			return runUpdate(targetVersion, dryRun, method, force)
		},
	}

	cmd.Flags().StringVar(&targetVersion, "version", "", "target a specific version (e.g. v1.30.0)")
	cmd.Flags().BoolVar(&dryRun, "dry-run", false, "show what would happen without applying")
	cmd.Flags().StringVar(&method, "method", "", "override install method detection (binary|source|docker)")
	cmd.Flags().BoolVar(&force, "force", false, "update even if already on the latest version")

	return cmd
}

func runUpdate(targetVersion string, dryRun bool, method string, force bool) error {
	// Detect or override install method.
	var installMethod gateway.InstallMethod
	switch method {
	case "binary":
		installMethod = gateway.InstallBinary
	case "source":
		installMethod = gateway.InstallSource
	case "docker":
		installMethod = gateway.InstallDocker
	case "":
		installMethod = gateway.DetectInstallMethod()
	default:
		return fmt.Errorf("unknown method %q (use: binary, source, docker)", method)
	}

	// Resolve target version.
	latest, _, err := gateway.FetchLatestRelease(Version)
	if err != nil {
		return fmt.Errorf("check latest version: %w", err)
	}

	version := latest
	if targetVersion != "" {
		version = targetVersion
	}

	fmt.Printf("  Current version: %s\n", Version)
	fmt.Printf("  Latest version:  %s\n", latest)
	fmt.Printf("  Install method:  %s\n", installMethod)

	if version == "" {
		return fmt.Errorf("could not determine target version")
	}

	// Check if update is needed.
	if !force && !gateway.IsNewer(Version, version) {
		fmt.Printf("\n  goclaw is already up to date (%s).\n", Version)
		return nil
	}

	fmt.Printf("  Target version:  %s\n", version)
	fmt.Println()

	switch installMethod {
	case gateway.InstallBinary:
		return runBinaryUpdate(version, dryRun)
	case gateway.InstallSource:
		printSourceInstructions()
		return nil
	case gateway.InstallDocker:
		printDockerInstructions()
		return nil
	default:
		return fmt.Errorf("unsupported install method: %s", installMethod)
	}
}

func runBinaryUpdate(version string, dryRun bool) error {
	su, err := gateway.NewSelfUpdater()
	if err != nil {
		return err
	}

	if dryRun {
		fmt.Printf("  Would update binary at %s to %s\n", su.BinaryPath(), version)
		fmt.Println("  Would run database migrations after update")
		return nil
	}

	fmt.Printf("  Downloading %s...\n", gateway.AssetName(version))
	tarballPath, err := su.DownloadRelease(version)
	if err != nil {
		return fmt.Errorf("download: %w", err)
	}

	fmt.Print("  Verifying checksum... ")
	if err := su.VerifyChecksum(tarballPath, version); err != nil {
		fmt.Println("FAILED")
		return fmt.Errorf("verify: %w", err)
	}
	fmt.Println("OK")

	fmt.Print("  Replacing binary... ")
	if err := su.ExtractAndSwap(tarballPath); err != nil {
		fmt.Println("FAILED")
		return fmt.Errorf("swap: %w", err)
	}
	fmt.Println("OK")

	// Run DB migrations if database is configured.
	fmt.Print("  Running database migrations... ")
	cfg, cfgErr := config.Load(resolveConfigPath())
	if cfgErr != nil || cfg.Database.PostgresDSN == "" {
		fmt.Println("SKIPPED (no database configured)")
	} else if err := checkSchemaOrAutoUpgrade(cfg.Database.PostgresDSN); err != nil {
		fmt.Println("SKIPPED")
		slog.Debug("post-update migrations skipped", "error", err)
	} else {
		fmt.Println("OK")
	}

	fmt.Println()
	fmt.Printf("  Updated to %s. Restart gateway to apply:\n", version)
	fmt.Println("    source .env.local && goclaw")
	return nil
}

func printSourceInstructions() {
	fmt.Println("  Source installation detected.")
	fmt.Println("  To update manually:")
	fmt.Println()
	fmt.Println("    git pull origin main")
	fmt.Println("    go build -o goclaw .")
	fmt.Println("    ./goclaw upgrade")
	fmt.Println("    source .env.local && ./goclaw")
}

func printDockerInstructions() {
	fmt.Println("  Docker installation detected.")
	fmt.Println("  To update:")
	fmt.Println()
	fmt.Println("    docker compose pull")
	fmt.Println("    docker compose up -d --build")
	fmt.Println()
	fmt.Println("  Or use Watchtower for automatic updates:")
	fmt.Println("    docker compose -f docker-compose.yml -f docker-compose.postgres.yml \\")
	fmt.Println("      -f docker-compose.selfservice.yml -f docker-compose.watchtower.yml up -d")
}

