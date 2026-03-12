package controlplane

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"sync"
	"time"

	"anlticsheat/api/internal/config"

	"github.com/jackc/pgx/v5/pgxpool"
)

type SiteRegistry interface {
	GetSite(ctx context.Context, id string) (config.Site, bool, error)
	ListSites(ctx context.Context) ([]config.Site, error)
	Close()
}

type StaticSiteRegistry struct {
	sites map[string]config.Site
}

func NewStaticSiteRegistry(sites map[string]config.Site) *StaticSiteRegistry {
	cloned := make(map[string]config.Site, len(sites))
	for key, value := range sites {
		cloned[key] = siteWithDefaults(value)
	}
	return &StaticSiteRegistry{sites: cloned}
}

func (r *StaticSiteRegistry) GetSite(_ context.Context, id string) (config.Site, bool, error) {
	site, ok := r.sites[strings.TrimSpace(id)]
	return site, ok, nil
}

func (r *StaticSiteRegistry) ListSites(_ context.Context) ([]config.Site, error) {
	sites := make([]config.Site, 0, len(r.sites))
	for _, site := range r.sites {
		sites = append(sites, site)
	}
	sort.Slice(sites, func(i, j int) bool {
		return sites[i].ID < sites[j].ID
	})
	return sites, nil
}

func (r *StaticSiteRegistry) Close() {}

type CachedNeonSiteRegistry struct {
	pool            *pgxpool.Pool
	refreshInterval time.Duration
	logger          *slog.Logger

	mu       sync.RWMutex
	sites    map[string]config.Site
	lastSync time.Time
}

func NewCachedNeonSiteRegistry(
	ctx context.Context,
	connectionString string,
	refreshInterval time.Duration,
	logger *slog.Logger,
) (*CachedNeonSiteRegistry, error) {
	poolConfig, err := pgxpool.ParseConfig(strings.TrimSpace(connectionString))
	if err != nil {
		return nil, fmt.Errorf("parse neon connection string: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("connect control plane: %w", err)
	}

	registry := &CachedNeonSiteRegistry{
		pool:            pool,
		refreshInterval: refreshInterval,
		logger:          logger,
		sites:           map[string]config.Site{},
	}

	if err := registry.refresh(ctx); err != nil {
		pool.Close()
		return nil, err
	}

	return registry, nil
}

func (r *CachedNeonSiteRegistry) Start(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(r.refreshInterval)
		defer ticker.Stop()

		for {
			select {
			case <-ticker.C:
				if err := r.refresh(ctx); err != nil {
					r.logger.Error("refresh site registry failed", slog.Any("error", err))
				}
			case <-ctx.Done():
				return
			}
		}
	}()
}

func (r *CachedNeonSiteRegistry) GetSite(ctx context.Context, id string) (config.Site, bool, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return config.Site{}, false, nil
	}

	r.mu.RLock()
	site, ok := r.sites[id]
	r.mu.RUnlock()

	if ok {
		return site, true, nil
	}

	if err := r.refresh(ctx); err != nil {
		return config.Site{}, false, err
	}

	r.mu.RLock()
	site, ok = r.sites[id]
	r.mu.RUnlock()

	return site, ok, nil
}

func (r *CachedNeonSiteRegistry) ListSites(ctx context.Context) ([]config.Site, error) {
	if time.Since(r.lastSync) >= r.refreshInterval {
		if err := r.refresh(ctx); err != nil {
			return nil, err
		}
	}

	r.mu.RLock()
	defer r.mu.RUnlock()

	sites := make([]config.Site, 0, len(r.sites))
	for _, site := range r.sites {
		sites = append(sites, site)
	}
	sort.Slice(sites, func(i, j int) bool {
		return sites[i].ID < sites[j].ID
	})
	return sites, nil
}

func (r *CachedNeonSiteRegistry) Close() {
	if r.pool != nil {
		r.pool.Close()
	}
}

func (r *CachedNeonSiteRegistry) refresh(ctx context.Context) error {
	next, err := r.loadSitesWithPrivacy(ctx)
	if err != nil && missingPrivacyColumns(err) {
		r.logger.Warn("site registry privacy columns unavailable; falling back to legacy site load", slog.Any("error", err))
		next, err = r.loadSitesLegacy(ctx)
	}
	if err != nil {
		return err
	}

	r.mu.Lock()
	r.sites = next
	r.lastSync = time.Now().UTC()
	r.mu.Unlock()
	return nil
}

func (r *CachedNeonSiteRegistry) loadSitesWithPrivacy(ctx context.Context) (map[string]config.Site, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			s.id,
			COALESCE(s.name, s.id) AS name,
			COALESCE(NULLIF(s.salt, ''), md5(s.id)) AS salt,
			COALESCE(array_remove(array_agg(o.origin ORDER BY o.origin), NULL), ARRAY[]::text[]) AS origins,
			COALESCE(ss.block_bot_traffic_enabled, TRUE) AS block_bot_traffic_enabled,
			COALESCE(ss.visitor_cookie_enabled, FALSE) AS visitor_cookie_enabled,
			COALESCE(ss.dom_snapshots_enabled, FALSE) AS dom_snapshots_enabled,
			COALESCE(ss.replay_mask_text_enabled, FALSE) AS replay_mask_text_enabled,
			COALESCE(ss.spa_tracking_enabled, TRUE) AS spa_tracking_enabled,
			COALESCE(ss.error_tracking_enabled, TRUE) AS error_tracking_enabled,
			COALESCE(ss.performance_tracking_enabled, TRUE) AS performance_tracking_enabled
		FROM analytics_sites s
		LEFT JOIN analytics_site_origins o ON o.site_id = s.id
		LEFT JOIN analytics_site_settings ss ON ss.site_id = s.id
		WHERE s.is_active = TRUE
		GROUP BY
			s.id,
			s.name,
			s.salt,
			ss.block_bot_traffic_enabled,
			ss.visitor_cookie_enabled,
			ss.dom_snapshots_enabled,
			ss.replay_mask_text_enabled,
			ss.spa_tracking_enabled,
			ss.error_tracking_enabled,
			ss.performance_tracking_enabled
	`)
	if err != nil {
		return nil, fmt.Errorf("load sites from control plane: %w", err)
	}
	defer rows.Close()

	next := map[string]config.Site{}
	for rows.Next() {
		var site config.Site
		var origins []string
		if err := rows.Scan(
			&site.ID,
			&site.Name,
			&site.Salt,
			&origins,
			&site.BlockBotTrafficEnabled,
			&site.VisitorCookieEnabled,
			&site.DomSnapshotsEnabled,
			&site.ReplayMaskTextEnabled,
			&site.SPATrackingEnabled,
			&site.ErrorTrackingEnabled,
			&site.PerformanceTrackingEnabled,
		); err != nil {
			return nil, fmt.Errorf("scan control plane site: %w", err)
		}
		site.Origins = origins
		next[site.ID] = siteWithDefaults(site)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate control plane sites: %w", err)
	}
	return next, nil
}

func (r *CachedNeonSiteRegistry) loadSitesLegacy(ctx context.Context) (map[string]config.Site, error) {
	rows, err := r.pool.Query(ctx, `
		SELECT
			s.id,
			COALESCE(s.name, s.id) AS name,
			COALESCE(array_remove(array_agg(o.origin ORDER BY o.origin), NULL), ARRAY[]::text[]) AS origins
		FROM analytics_sites s
		LEFT JOIN analytics_site_origins o ON o.site_id = s.id
		WHERE s.is_active = TRUE
		GROUP BY s.id, s.name
	`)
	if err != nil {
		return nil, fmt.Errorf("load sites from control plane: %w", err)
	}
	defer rows.Close()

	next := map[string]config.Site{}
	for rows.Next() {
		var site config.Site
		var origins []string
		if err := rows.Scan(&site.ID, &site.Name, &origins); err != nil {
			return nil, fmt.Errorf("scan control plane site: %w", err)
		}
		if strings.TrimSpace(site.Salt) == "" {
			site.Salt = site.ID
		}
		site.Origins = origins
		next[site.ID] = siteWithDefaults(site)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate control plane sites: %w", err)
	}
	return next, nil
}

func missingPrivacyColumns(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "column s.salt does not exist") ||
		strings.Contains(message, "relation \"analytics_site_settings\" does not exist") ||
		strings.Contains(message, "column ss.block_bot_traffic_enabled does not exist") ||
		strings.Contains(message, "column ss.visitor_cookie_enabled does not exist") ||
		strings.Contains(message, "column ss.dom_snapshots_enabled does not exist") ||
		strings.Contains(message, "column ss.replay_mask_text_enabled does not exist") ||
		strings.Contains(message, "column ss.spa_tracking_enabled does not exist") ||
		strings.Contains(message, "column ss.error_tracking_enabled does not exist") ||
		strings.Contains(message, "column ss.performance_tracking_enabled does not exist")
}

func siteWithDefaults(site config.Site) config.Site {
	if strings.TrimSpace(site.Salt) == "" {
		site.Salt = site.ID
	}
	return site
}
