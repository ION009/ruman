package geo

import (
	"log/slog"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"anlticsheat/api/internal/cache"
	"anlticsheat/api/internal/config"

	maxminddb "github.com/oschwald/maxminddb-golang"
)

const (
	defaultCacheSize = 50000
	defaultCacheTTL  = 24 * time.Hour
)

type Resolver interface {
	Lookup(ip string, headers http.Header) Location
	Close() error
}

type Location struct {
	CountryCode string
	CountryName string
	Continent   string
	RegionCode  string
	RegionName  string
	City        string
	Timezone    string
	Precision   string
}

func (l Location) Valid() bool {
	return strings.TrimSpace(l.CountryCode) != ""
}

type configuredResolver struct {
	devLocation Location
}

func (r configuredResolver) lookupFallback(rawIP string, headers http.Header) Location {
	if location := devLocationForIP(rawIP, r.devLocation); location.Valid() {
		return location
	}
	return headerLocation(headers)
}

type noopResolver struct {
	configuredResolver
}

func (r noopResolver) Lookup(rawIP string, headers http.Header) Location {
	return r.lookupFallback(rawIP, headers)
}

func (noopResolver) Close() error {
	return nil
}

type maxMindResolver struct {
	reader *maxminddb.Reader
	cache  *cache.LRU[string, Location]
	mu     sync.Mutex
	logger *slog.Logger
	configuredResolver
}

type maxMindCityRecord struct {
	Continent struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"continent"`
	Country struct {
		ISOCode string            `maxminddb:"iso_code"`
		Names   map[string]string `maxminddb:"names"`
	} `maxminddb:"country"`
	City struct {
		Names map[string]string `maxminddb:"names"`
	} `maxminddb:"city"`
	Subdivisions []struct {
		ISOCode string            `maxminddb:"iso_code"`
		Names   map[string]string `maxminddb:"names"`
	} `maxminddb:"subdivisions"`
	Location struct {
		TimeZone string `maxminddb:"time_zone"`
	} `maxminddb:"location"`
}

func NewResolver(cfg config.Config, logger *slog.Logger) Resolver {
	path := detectDatabasePath(cfg.GeoIPDBPath)
	if path == "" {
		if logger != nil {
			logger.Info("geoip database not configured; falling back to coarse geo headers")
		}
		return noopResolver{
			configuredResolver: configuredResolver{
				devLocation: devLocationFromConfig(cfg),
			},
		}
	}

	reader, err := maxminddb.Open(path)
	if err != nil {
		if logger != nil {
			logger.Warn("failed to open geoip database; falling back to coarse geo headers", "path", path, "error", err)
		}
		return noopResolver{
			configuredResolver: configuredResolver{
				devLocation: devLocationFromConfig(cfg),
			},
		}
	}

	if logger != nil {
		logger.Info("geoip database loaded", "path", path)
	}

	return &maxMindResolver{
		reader: reader,
		cache:  cache.NewLRU[string, Location](defaultCacheSize, defaultCacheTTL),
		logger: logger,
		configuredResolver: configuredResolver{
			devLocation: devLocationFromConfig(cfg),
		},
	}
}

func detectDatabasePath(configured string) string {
	candidates := []string{
		strings.TrimSpace(configured),
		"GeoLite2-City.mmdb",
		filepath.Join("apps", "api", "GeoLite2-City.mmdb"),
	}

	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func (r *maxMindResolver) Lookup(rawIP string, headers http.Header) Location {
	if location := devLocationForIP(rawIP, r.devLocation); location.Valid() {
		return location
	}

	addr, ok := parseLookupAddr(rawIP)
	if !ok {
		return r.lookupFallback(rawIP, headers)
	}

	key := addr.String()
	now := time.Now().UTC()

	r.mu.Lock()
	if cached, ok := r.cache.Get(key, now); ok {
		r.mu.Unlock()
		if cached.Valid() {
			return cached
		}
		return r.lookupFallback(rawIP, headers)
	}
	r.mu.Unlock()

	record := maxMindCityRecord{}
	if err := r.reader.Lookup(addr.AsSlice(), &record); err == nil {
		location := normalizeLocation(record)
		r.mu.Lock()
		r.cache.Set(key, location, now)
		r.mu.Unlock()
		if location.Valid() {
			return location
		}
	}

	location := r.lookupFallback(rawIP, headers)
	r.mu.Lock()
	r.cache.Set(key, location, now)
	r.mu.Unlock()
	return location
}

func (r *maxMindResolver) Close() error {
	if r == nil || r.reader == nil {
		return nil
	}
	return r.reader.Close()
}

func parseLookupAddr(rawIP string) (netip.Addr, bool) {
	addr, err := netip.ParseAddr(strings.TrimSpace(rawIP))
	if err != nil {
		return netip.Addr{}, false
	}
	if !addr.IsValid() ||
		!addr.IsGlobalUnicast() ||
		addr.IsPrivate() ||
		addr.IsLoopback() ||
		addr.IsLinkLocalUnicast() ||
		addr.IsLinkLocalMulticast() ||
		addr.IsMulticast() ||
		addr.IsUnspecified() {
		return netip.Addr{}, false
	}
	return addr.Unmap(), true
}

func normalizeLocation(record maxMindCityRecord) Location {
	location := Location{
		CountryCode: strings.ToUpper(strings.TrimSpace(record.Country.ISOCode)),
		CountryName: bestName(record.Country.Names),
		Continent:   bestName(record.Continent.Names),
		Timezone:    strings.TrimSpace(record.Location.TimeZone),
	}

	if len(record.Subdivisions) > 0 {
		location.RegionCode = strings.ToUpper(strings.TrimSpace(record.Subdivisions[0].ISOCode))
		location.RegionName = bestName(record.Subdivisions[0].Names)
	}
	location.City = bestName(record.City.Names)
	location.Precision = precisionFor(location)

	if !location.Valid() {
		return Location{}
	}
	if location.CountryName == "" {
		location.CountryName = location.CountryCode
	}
	if location.RegionName == "" {
		location.RegionName = location.RegionCode
	}
	return location
}

func headerLocation(headers http.Header) Location {
	if headers == nil {
		return Location{}
	}

	countryCode := strings.ToUpper(strings.TrimSpace(firstHeader(headers,
		"CF-IPCountry",
		"X-Vercel-IP-Country",
		"CloudFront-Viewer-Country",
		"X-Country-Code",
	)))
	if countryCode == "" || countryCode == "XX" || countryCode == "T1" {
		return Location{}
	}

	location := Location{
		CountryCode: countryCode,
		CountryName: strings.TrimSpace(firstHeader(headers, "X-Country-Name")),
		RegionCode:  strings.TrimSpace(firstHeader(headers, "X-Vercel-IP-Country-Region", "CloudFront-Viewer-Country-Region", "X-Region-Code")),
		City:        strings.TrimSpace(firstHeader(headers, "X-Vercel-IP-City", "CloudFront-Viewer-City", "X-City")),
		Timezone:    strings.TrimSpace(firstHeader(headers, "X-Vercel-IP-Timezone", "X-Timezone")),
		Continent:   strings.TrimSpace(firstHeader(headers, "X-Continent-Name")),
	}
	if location.CountryName == "" {
		location.CountryName = countryCode
	}
	if location.RegionCode != "" {
		location.RegionName = location.RegionCode
	}
	location.Precision = precisionFor(location)
	return location
}

func firstHeader(headers http.Header, keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(headers.Get(key))
		if value != "" {
			return value
		}
	}
	return ""
}

func bestName(names map[string]string) string {
	if len(names) == 0 {
		return ""
	}
	for _, key := range []string{"en", "default"} {
		if value := strings.TrimSpace(names[key]); value != "" {
			return value
		}
	}
	for _, value := range names {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func precisionFor(location Location) string {
	switch {
	case strings.TrimSpace(location.City) != "":
		return "city"
	case strings.TrimSpace(location.RegionCode) != "" || strings.TrimSpace(location.RegionName) != "":
		return "region"
	case strings.TrimSpace(location.CountryCode) != "":
		return "country"
	default:
		return "unknown"
	}
}

func devLocationFromConfig(cfg config.Config) Location {
	location := Location{
		CountryCode: strings.ToUpper(strings.TrimSpace(cfg.DevGeoCountryCode)),
		CountryName: strings.TrimSpace(cfg.DevGeoCountryName),
		Continent:   strings.TrimSpace(cfg.DevGeoContinent),
		RegionCode:  strings.ToUpper(strings.TrimSpace(cfg.DevGeoRegionCode)),
		RegionName:  strings.TrimSpace(cfg.DevGeoRegionName),
		City:        strings.TrimSpace(cfg.DevGeoCity),
		Timezone:    strings.TrimSpace(cfg.DevGeoTimezone),
	}
	if !location.Valid() {
		return Location{}
	}
	if location.CountryName == "" {
		location.CountryName = location.CountryCode
	}
	if location.RegionName == "" {
		location.RegionName = location.RegionCode
	}
	location.Precision = precisionFor(location)
	return location
}

func devLocationForIP(rawIP string, configured Location) Location {
	if !configured.Valid() {
		return Location{}
	}
	addr, err := netip.ParseAddr(strings.TrimSpace(rawIP))
	if err != nil || !addr.IsValid() {
		return Location{}
	}
	if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsUnspecified() {
		return configured
	}
	return Location{}
}
