"use client";

import { ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { startTransition, useDeferredValue, useEffect, useState } from "react";

import { Globe3D, type GlobeCountrySignal } from "@/components/ui/3d-globe";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardMap } from "@/hooks/use-dashboard";
import type {
  DashboardMapCityMetric,
  DashboardMapCountryMetric,
  DashboardMapRegionMetric,
} from "@/lib/dashboard/types";
import { cn, formatCompact, formatNumber, formatPercent } from "@/lib/utils";

/* ── Helpers ───────────────────────────────────────── */

function flagEmoji(code: string) {
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) return "·";
  return String.fromCodePoint(...normalized.split("").map((c) => 127397 + c.charCodeAt(0)));
}

function formatDelta(value: number) {
  const n = Math.abs(value) < 0.05 ? 0 : value;
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function DeltaPill({ value }: { value: number }) {
  const positive = value > 0.5;
  const negative = value < -0.5;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
        positive && "bg-status-success-bg text-status-success",
        negative && "bg-status-error-bg text-status-error",
        !positive && !negative && "bg-surface-secondary text-text-secondary",
      )}
    >
      {negative ? <TrendingDown className="size-3" /> : <TrendingUp className="size-3" />}
      {formatDelta(value)}
    </span>
  );
}

function Empty({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex h-[100px] items-center justify-center text-center">
      <div>
        <p className="text-[13px] font-medium text-text-secondary">{title}</p>
        <p className="mt-1 text-[11px] text-text-muted">{sub}</p>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Main component
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

export function MapView() {
  const mapQuery = useDashboardMap();
  const [selectedCountry, setSelectedCountry] = useState("");
  const activeCountry = useDeferredValue(selectedCountry);

  useEffect(() => {
    if (!mapQuery.data) return;

    const liveFallback =
      [...mapQuery.data.countries]
        .sort((a, b) => b.activeNow - a.activeNow || b.visitors - a.visitors)[0]?.countryCode ??
      mapQuery.data.summary.topCountryCode ??
      mapQuery.data.countries[0]?.countryCode ??
      "";

    if (!liveFallback) return;

    const hasSelection = mapQuery.data.countries.some((c) => c.countryCode === selectedCountry);
    if (hasSelection) return;

    startTransition(() => setSelectedCountry(liveFallback));
  }, [mapQuery.data, selectedCountry]);

  /* ── Error / Loading / Empty ─────────────────── */

  if (mapQuery.error) {
    return (
      <div className="ov-section p-6">
        <p className="text-sm font-semibold">Realtime geo unavailable</p>
        <p className="mt-1 text-sm text-text-secondary">{mapQuery.error.message}</p>
      </div>
    );
  }

  if (mapQuery.isLoading && !mapQuery.data) {
    return (
      <div className="ov-root">
        <Skeleton className="h-[620px] rounded-lg" />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr),minmax(0,0.92fr)]">
          <Skeleton className="h-[600px] rounded-lg" />
          <div className="space-y-4">
            <Skeleton className="h-[300px] rounded-lg" />
            <Skeleton className="h-[300px] rounded-lg" />
          </div>
        </div>
      </div>
    );
  }

  if (!mapQuery.data || !mapQuery.data.countries.length) {
    return (
      <div className="ov-section p-6">
        <p className="text-sm font-semibold">No geo data yet</p>
        <p className="mt-1 text-sm text-text-secondary">
          The selected range does not contain country-level location data yet.
        </p>
      </div>
    );
  }

  /* ── Derived data ────────────────────────────── */

  const summary = mapQuery.data.summary;
  const countries = mapQuery.data.countries;
  const liveCountries = [...countries]
    .sort((a, b) => b.activeNow - a.activeNow || b.visitors - a.visitors)
    .slice(0, 12);

  const selected =
    countries.find((c) => c.countryCode === activeCountry) ??
    liveCountries[0] ??
    countries[0];

  const selectedRegions = mapQuery.data.regions
    .filter((r) => r.countryCode === selected.countryCode)
    .slice(0, 6);

  const selectedCities = mapQuery.data.cities
    .filter((c) => c.countryCode === selected.countryCode)
    .slice(0, 6);

  const selectedWithheld = mapQuery.data.withheld.filter(
    (w) => w.countryCode === selected.countryCode,
  );

  const withheldRows = mapQuery.data.withheld.slice(0, 8);

  const countryPeak = Math.max(...liveCountries.map((c) => c.visitors), 1);
  const regionPeak = Math.max(...selectedRegions.map((r) => r.visitors), 1);
  const cityPeak = Math.max(...selectedCities.map((c) => c.visitors), 1);
  const withheldPeak = Math.max(...withheldRows.map((w) => w.visitors), 1);

  /* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
     Render
     ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */

  return (
    <div className="ov-root [font-variant-numeric:tabular-nums]">
      {/* ── Globe Hero ─────────────────────────── */}
      <div className="ov-section overflow-hidden">
        <Globe3D
          signals={countries.map((c): GlobeCountrySignal => ({
            id: c.countryCode,
            label: c.countryName || c.countryCode,
            value: c.visitors,
            countryCode: c.countryCode,
            sessions: c.sessions,
            pageviews: c.pageviews,
            share: c.share,
          }))}
          selectedSignalId={selected.countryCode}
          onSignalClick={(s) => startTransition(() => setSelectedCountry(s.countryCode ?? s.id))}
          className="h-[420px] sm:h-[520px] lg:h-[620px]"
        />
      </div>

      {/* ── Coverage summary strip ─────────────── */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Active Now</span>
          <span className="ov-kpi-number">{formatCompact(summary.activeNow)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Located Visitors</span>
          <span className="ov-kpi-number">{formatCompact(summary.locatedVisitors)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Countries</span>
          <span className="ov-kpi-number">{formatNumber(summary.countries)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Coverage</span>
          <span className="ov-kpi-number">{formatPercent(summary.coverageConfidence, 0)}</span>
        </div>
        <div className="ov-kpi-cell">
          <span className="ov-kpi-label">Withheld</span>
          <span className="ov-kpi-number">{formatPercent(summary.withheldShare, 0)}</span>
        </div>
      </div>

      {/* ── Country Board + Selected Market ─────── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.08fr),minmax(0,0.92fr)]">
        {/* Country Board */}
        <div className="ov-section">
          <div className="ov-section-header">
            <h3 className="ov-section-title">Country Board</h3>
            <span className="text-[11px] font-medium text-text-muted">
              {formatNumber(countries.length)} markets
            </span>
          </div>
          <div className="ov-list">
            <div className="ov-list-header">
              <span>Country</span>
              <span>Visitors</span>
            </div>
            {liveCountries.map((country) => {
              const isSelected = country.countryCode === selected.countryCode;
              return (
                <button
                  key={country.countryCode}
                  type="button"
                  onClick={() => startTransition(() => setSelectedCountry(country.countryCode))}
                  className={cn(
                    "ov-list-row w-full text-left transition-colors",
                    isSelected && "bg-status-info-bg",
                  )}
                >
                  <div className="ov-list-bar-bg">
                    <div
                      className="ov-list-bar-fill"
                      style={{
                        width: `${Math.max(2, (country.visitors / countryPeak) * 100)}%`,
                        backgroundColor: isSelected ? "#0D9488" : "#CCFBF1",
                      }}
                    />
                  </div>
                  <span className="ov-list-label flex items-center gap-2">
                    <span className="text-base leading-none">{flagEmoji(country.countryCode)}</span>
                    <span>{country.countryName || country.countryCode}</span>
                  </span>
                  <span className="ov-list-value flex items-center gap-2">
                    {formatCompact(country.visitors)}
                    {country.growthVsPrevious !== 0 && (
                      <DeltaPill value={country.growthVsPrevious} />
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected Market detail */}
        <div className="space-y-4">
          <div className="ov-section">
            <div className="ov-section-header">
              <h3 className="ov-section-title">
                {flagEmoji(selected.countryCode)} {selected.countryName}
              </h3>
              <span className="text-[11px] font-medium text-text-muted">
                {formatCompact(selected.activeNow)} active now
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 px-4 pb-4 pt-3">
              <div>
                <p className="text-[11px] font-medium text-text-muted">Visitors</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-lg font-semibold tabular-nums text-text-primary">
                    {formatCompact(selected.visitors)}
                  </span>
                  <DeltaPill value={selected.growthVsPrevious} />
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-muted">Sessions</p>
                <span className="mt-1 block text-lg font-semibold tabular-nums text-text-primary">
                  {formatCompact(selected.sessions)}
                </span>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-muted">Pageviews</p>
                <span className="mt-1 block text-lg font-semibold tabular-nums text-text-primary">
                  {formatCompact(selected.pageviews)}
                </span>
              </div>
              <div>
                <p className="text-[11px] font-medium text-text-muted">Share</p>
                <span className="mt-1 block text-lg font-semibold tabular-nums text-text-primary">
                  {formatPercent(selected.share, 1)}
                </span>
              </div>
            </div>
          </div>

          {/* Regions + Cities */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="ov-section">
              <div className="ov-section-header">
                <h3 className="ov-section-title">Regions</h3>
              </div>
              {selectedRegions.length > 0 ? (
                <div className="ov-list">
                  <div className="ov-list-header">
                    <span>Region</span>
                    <span>Visitors</span>
                  </div>
                  {selectedRegions.map((r) => (
                    <div key={`${r.countryCode}-${r.regionCode}-${r.regionName}`} className="ov-list-row">
                      <div className="ov-list-bar-bg">
                        <div
                          className="ov-list-bar-fill"
                          style={{
                            width: `${Math.max(2, (r.visitors / regionPeak) * 100)}%`,
                            backgroundColor: "#CCFBF1",
                          }}
                        />
                      </div>
                      <span className="ov-list-label">{r.regionName || r.regionCode || "Unknown"}</span>
                      <span className="ov-list-value">{formatCompact(r.visitors)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No regions" sub="Region data appears as traffic resolves." />
              )}
            </div>

            <div className="ov-section">
              <div className="ov-section-header">
                <h3 className="ov-section-title">Cities</h3>
              </div>
              {selectedCities.length > 0 ? (
                <div className="ov-list">
                  <div className="ov-list-header">
                    <span>City</span>
                    <span>Visitors</span>
                  </div>
                  {selectedCities.map((c) => (
                    <div key={`${c.countryCode}-${c.regionName}-${c.city}`} className="ov-list-row">
                      <div className="ov-list-bar-bg">
                        <div
                          className="ov-list-bar-fill"
                          style={{
                            width: `${Math.max(2, (c.visitors / cityPeak) * 100)}%`,
                            backgroundColor: "#CCFBF1",
                          }}
                        />
                      </div>
                      <span className="ov-list-label">{c.city}</span>
                      <span className="ov-list-value">{formatCompact(c.visitors)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty title="No cities" sub="City data appears as traffic resolves." />
              )}
            </div>
          </div>

          {/* Privacy withheld notice */}
          {selectedWithheld.length > 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-border-default bg-surface-hover px-4 py-3">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-teal" />
              <p className="text-[12px] leading-5 text-text-secondary">
                {formatNumber(selectedWithheld.length)} localities withheld in {selected.countryName} —{" "}
                {formatCompact(selectedWithheld.reduce((s, r) => s + r.visitors, 0))} visitors below the privacy floor of {formatNumber(summary.privacyFloor)}.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Privacy Filtered (global) ──────────── */}
      {withheldRows.length > 0 && (
        <div className="ov-section">
          <div className="ov-section-header">
            <h3 className="ov-section-title">Privacy Filtered</h3>
            <span className="text-[11px] font-medium text-text-muted">
              {formatPercent(summary.withheldShare, 0)} withheld
            </span>
          </div>
          <div className="ov-list">
            <div className="ov-list-header">
              <span>Locality</span>
              <span>Visitors</span>
            </div>
            {withheldRows.map((row) => (
              <div key={`${row.countryCode}-${row.regionName}-${row.city}`} className="ov-list-row">
                <div className="ov-list-bar-bg">
                  <div
                    className="ov-list-bar-fill"
                    style={{
                      width: `${Math.max(2, (row.visitors / withheldPeak) * 100)}%`,
                      backgroundColor: "#FDE68A",
                    }}
                  />
                </div>
                <span className="ov-list-label">
                  {row.city}, {row.countryName}
                </span>
                <span className="ov-list-value">{formatCompact(row.visitors)}</span>
              </div>
            ))}
          </div>
          <div className="flex items-start gap-3 border-t border-border-subtle px-4 py-3">
            <p className="text-[11px] leading-5 text-text-muted">
              {formatCompact(summary.unknownVisitors)} unresolved visitors · {formatCompact(summary.withheldVisitors)} below floor of {formatNumber(summary.privacyFloor)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
