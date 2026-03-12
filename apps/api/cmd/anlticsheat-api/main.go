package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	"anlticsheat/api/internal/alerts"
	"anlticsheat/api/internal/config"
	"anlticsheat/api/internal/controlplane"
	"anlticsheat/api/internal/geo"
	"anlticsheat/api/internal/httpapi"
	"anlticsheat/api/internal/identity"
	"anlticsheat/api/internal/ingest"
	"anlticsheat/api/internal/metrics"
	"anlticsheat/api/internal/migrate"
	"anlticsheat/api/internal/reportscheduler"
	"anlticsheat/api/internal/storage"

	"github.com/jackc/pgx/v5/pgxpool"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := config.LoadEnvFiles(
		".env.local",
		".env",
		"apps/api/.env.local",
		"apps/api/.env",
	); err != nil {
		logger.Error("failed to load local env files", slog.Any("error", err))
		os.Exit(1)
	}

	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", slog.Any("error", err))
		os.Exit(1)
	}
	if err := validateStorageSafety(cfg); err != nil {
		logger.Error("unsafe storage configuration", slog.Any("error", err))
		os.Exit(1)
	}

	migrationCtx, migrationCancel := context.WithTimeout(context.Background(), 45*time.Second)
	if err := runMigrations(migrationCtx, cfg); err != nil {
		migrationCancel()
		logger.Error("failed to run migrations", slog.Any("error", err))
		os.Exit(1)
	}
	migrationCancel()

	store, err := newStore(cfg)
	if err != nil {
		logger.Error("failed to configure storage", slog.Any("error", err))
		os.Exit(1)
	}

	wal, err := newWAL(cfg)
	if err != nil {
		logger.Error("failed to configure wal", slog.Any("error", err))
		os.Exit(1)
	}
	neonPool, err := newNeonPool(context.Background(), cfg)
	if err != nil {
		logger.Error("failed to configure neon pool", slog.Any("error", err))
		os.Exit(1)
	}
	appCtx, cancelApp := context.WithCancel(context.Background())
	defer cancelApp()

	sites, err := newSiteRegistry(appCtx, cfg, logger)
	if err != nil {
		logger.Error("failed to configure site registry", slog.Any("error", err))
		os.Exit(1)
	}

	batcherCtx, cancelBatcher := context.WithCancel(context.Background())
	batcher := ingest.NewBatchWriter(store, ingest.BatchWriterConfig{
		FlushInterval:   cfg.FlushInterval,
		MaxItems:        cfg.BatchMaxItems,
		QueueCapacity:   cfg.QueueCapacity,
		ShutdownTimeout: cfg.ShutdownTimeout,
	}, logger, wal)
	metricRegistry := metrics.New()
	batcher.SetObserver(metricRegistry)
	metricRegistry.SetQueueDepthFunc(batcher.QueueDepth)

	batcher.Start(batcherCtx)

	resolver := identity.NewResolver(cfg.IdentityCacheSize, cfg.IdentityCacheTTL)
	geoResolver := geo.NewResolver(cfg, logger)
	server := httpapi.New(cfg, sites, resolver, geoResolver, batcher, store, store, store, store, store, neonPool, metricRegistry, logger)
	alertChecker := alerts.NewChecker(neonPool, store, sites, cfg, logger)
	alertChecker.Start(appCtx)
	reportScheduler := reportscheduler.New(neonPool, store, sites, cfg, logger)
	reportScheduler.Start(appCtx)
	httpServer := &http.Server{
		Addr:              ":" + cfg.HTTPPort,
		Handler:           server.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	var closeOnce sync.Once
	closeResources := func() {
		closeOnce.Do(func() {
			if wal != nil {
				_ = wal.Close()
			}
			if closer, ok := store.(interface{ Close() error }); ok {
				_ = closer.Close()
			}
			if geoResolver != nil {
				_ = geoResolver.Close()
			}
			if neonPool != nil {
				neonPool.Close()
			}
			sites.Close()
			cancelBatcher()
			cancelApp()
		})
	}
	defer closeResources()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)

	go func() {
		<-signals

		shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
		defer cancel()

		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			logger.Error("server shutdown failed", slog.Any("error", err))
		}
		cancelBatcher()
		if err := batcher.DrainAndClose(shutdownCtx); err != nil {
			logger.Error("batcher drain failed", slog.Any("error", err))
		}
		closeResources()
	}()

	logger.Info("starting api", slog.String("addr", httpServer.Addr), slog.String("storage", cfg.Storage))

	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		logger.Error("server exited", slog.Any("error", err))
		closeResources()
		os.Exit(1)
	}

	cancelBatcher()
	drainCtx, cancelDrain := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancelDrain()
	_ = batcher.DrainAndClose(drainCtx)
	closeResources()
}

func newSiteRegistry(
	ctx context.Context,
	cfg config.Config,
	logger *slog.Logger,
) (controlplane.SiteRegistry, error) {
	if cfg.NeonDatabaseURL == "" {
		return controlplane.NewStaticSiteRegistry(cfg.Sites), nil
	}

	registry, err := controlplane.NewCachedNeonSiteRegistry(ctx, cfg.NeonDatabaseURL, cfg.SiteRegistryRefresh, logger)
	if err != nil {
		logger.Warn(
			"failed to initialize neon site registry; falling back to static registry",
			slog.Any("error", err),
			slog.Int("static_site_count", len(cfg.Sites)),
		)
		return controlplane.NewStaticSiteRegistry(cfg.Sites), nil
	}
	registry.Start(ctx)
	return registry, nil
}

func newStore(cfg config.Config) (interface {
	ingest.Writer
	storage.StatsProvider
	storage.DashboardProvider
	storage.ExportProvider
	storage.ReplayProvider
	storage.PrivacyProvider
}, error) {
	switch cfg.Storage {
	case "", "memory":
		return storage.NewMemoryStore(), nil
	case "clickhouse":
		return storage.NewClickHouseStore(cfg.ClickHouseDSN)
	default:
		return nil, errors.New("unknown storage backend: " + cfg.Storage)
	}
}

func newWAL(cfg config.Config) (*ingest.WAL, error) {
	if strings.TrimSpace(cfg.WALDir) == "" {
		return nil, nil
	}
	return ingest.OpenWAL(cfg.WALDir)
}

func runMigrations(ctx context.Context, cfg config.Config) error {
	if strings.TrimSpace(cfg.NeonDatabaseURL) != "" {
		poolConfig, err := pgxpool.ParseConfig(strings.TrimSpace(cfg.NeonDatabaseURL))
		if err != nil {
			return err
		}
		pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
		if err != nil {
			return err
		}
		if err := migrate.RunNeon(ctx, pool, "db/neon/migrations"); err != nil {
			pool.Close()
			return err
		}
		pool.Close()
	}

	if strings.TrimSpace(cfg.ClickHouseDSN) != "" {
		store, err := storage.NewClickHouseStore(cfg.ClickHouseDSN)
		if err != nil {
			return err
		}
		defer store.Close()
		if err := migrate.RunClickHouse(ctx, store, "db/clickhouse/migrations"); err != nil {
			return err
		}
	}
	return nil
}

func newNeonPool(ctx context.Context, cfg config.Config) (*pgxpool.Pool, error) {
	if strings.TrimSpace(cfg.NeonDatabaseURL) == "" {
		return nil, nil
	}
	poolConfig, err := pgxpool.ParseConfig(strings.TrimSpace(cfg.NeonDatabaseURL))
	if err != nil {
		return nil, err
	}
	return pgxpool.NewWithConfig(ctx, poolConfig)
}

func validateStorageSafety(cfg config.Config) error {
	if strings.EqualFold(strings.TrimSpace(cfg.Storage), "memory") && !cfg.AllowMemoryStorage {
		return errors.New(
			"ANLTICSHEAT_STORAGE=memory is ephemeral and disabled by default; set ANLTICSHEAT_ALLOW_MEMORY_STORAGE=true only for disposable local testing",
		)
	}
	return nil
}
