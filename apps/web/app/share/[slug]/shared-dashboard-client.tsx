"use client";

import { ExternalLink, Flame, Globe2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardSummary, HeatmapView } from "@/lib/dashboard/types";
import { formatCompact, formatPercent } from "@/lib/utils";

type SharedDashboardPayload = {
  site?: {
    id?: string;
    name?: string;
  };
  summary?: DashboardSummary | null;
  heatmap?: HeatmapView | null;
};

export function SharedDashboardClient({ slug }: { slug: string }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<{
    data: SharedDashboardPayload | null;
    error: string;
    loading: boolean;
    passwordRequired: boolean;
  }>({
    data: null,
    error: "",
    loading: true,
    passwordRequired: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadWithPassword(candidatePassword?: string) {
      try {
        const hasPassword = typeof candidatePassword === "string" && candidatePassword.trim().length > 0;
        const response = await fetch(`/api/share/${encodeURIComponent(slug)}`, {
          method: hasPassword ? "POST" : "GET",
          cache: "no-store",
          headers: hasPassword ? { "Content-Type": "application/json" } : undefined,
          body: hasPassword ? JSON.stringify({ password: candidatePassword.trim() }) : undefined,
        });
        const payload = (await response.json().catch(() => ({}))) as SharedDashboardPayload & {
          error?: string;
          message?: string;
          passwordRequired?: boolean;
        };

        if (!response.ok) {
          if (response.status === 403 && payload.passwordRequired) {
            if (!cancelled) {
              setState({
                data: null,
                error: payload.error ?? "Password required.",
                loading: false,
                passwordRequired: true,
              });
            }
            return;
          }
          throw new Error(payload.error ?? payload.message ?? "Shared dashboard is unavailable.");
        }

        if (!cancelled) {
          setState({
            data: payload,
            error: "",
            loading: false,
            passwordRequired: false,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({
            data: null,
            error: error instanceof Error ? error.message : "Shared dashboard is unavailable.",
            loading: false,
            passwordRequired: false,
          });
        }
      }
    }

    void loadWithPassword();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (state.loading && !state.passwordRequired) {
    return (
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-10">
        <Skeleton className="h-32 rounded-3xl" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="h-[420px] rounded-3xl" />
      </div>
    );
  }

  if (state.error || !state.data?.summary) {
    if (state.passwordRequired) {
      return (
        <div className="mx-auto max-w-md px-4 py-12">
          <div className="section-frame rounded-2xl border border-border/50 p-6 text-center">
            <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-accent-teal/10">
              <ShieldCheck className="size-5 text-accent-teal" />
            </div>
            <h2 className="text-lg font-semibold text-text-primary">Password protected</h2>
            <p className="mt-1 text-[13px] text-text-secondary">{state.error || "Enter the password for this shared dashboard."}</p>
            <form
              className="mt-5 space-y-4 text-left"
              onSubmit={async (event) => {
                event.preventDefault();
                setState((current) => ({ ...current, loading: true, error: "" }));
                try {
                  const response = await fetch(`/api/share/${encodeURIComponent(slug)}`, {
                    method: "POST",
                    cache: "no-store",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ password }),
                  });
                  const payload = (await response.json().catch(() => ({}))) as SharedDashboardPayload & {
                    error?: string;
                    passwordRequired?: boolean;
                  };

                  if (!response.ok) {
                    setState({
                      data: null,
                      error: payload.error ?? "Incorrect password.",
                      loading: false,
                      passwordRequired: Boolean(payload.passwordRequired),
                    });
                    return;
                  }

                  setState({
                    data: payload,
                    error: "",
                    loading: false,
                    passwordRequired: false,
                  });
                } catch (error) {
                  setState({
                    data: null,
                    error: error instanceof Error ? error.message : "Shared dashboard is unavailable.",
                    loading: false,
                    passwordRequired: true,
                  });
                }
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="shared-password">Password</Label>
                <Input
                  id="shared-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Enter dashboard password"
                />
              </div>
              <Button type="submit" className="w-full" disabled={state.loading || !password.trim()}>
                {state.loading ? "Unlocking..." : "Unlock dashboard"}
              </Button>
            </form>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="section-frame rounded-2xl border border-border/50 px-6 py-12 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-accent-teal/10">
            <ShieldCheck className="size-5 text-accent-teal" />
          </div>
          <h1 className="text-xl font-semibold text-text-primary">Shared dashboard unavailable</h1>
          <p className="mt-2 text-[13px] text-text-secondary">
            {state.error || "This shared dashboard link is not ready yet."}
          </p>
        </div>
      </div>
    );
  }

  const summary = state.data.summary;
  const heatmap = state.data.heatmap;
  const topPage = summary.topPages[0];
  const strongestReferrer = summary.referrers[0];
  const dominantDevice = summary.devices[0];

  return (
    <div className="min-h-screen bg-surface-tertiary">
      <div className="mx-auto max-w-6xl space-y-5 px-4 py-10">
        <div className="section-frame rounded-2xl border border-border/50 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-secondary">
                  Public snapshot
                </span>
                <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {summary.range}
                </span>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
                  {state.data.site?.name || "Shared dashboard"}
                </h1>
                <p className="mt-1.5 max-w-2xl text-[13px] text-text-secondary">
                  Read-only analytics snapshot with the essentials: overview, top pages, traffic sources,
                  devices, and a heatmap summary.
                </p>
              </div>
            </div>

            <Link
              href="/auth/sign-in"
              className="inline-flex items-center gap-2 rounded-xl border border-border/50 bg-foreground px-4 py-2 text-[13px] font-medium text-white transition-colors hover:bg-foreground/90"
            >
              Open full dashboard
              <ExternalLink className="size-3.5" />
            </Link>
          </div>
        </div>

        <div className="ov-kpi-strip">
          {[
            { label: "Pageviews", value: formatCompact(summary.overview.pageviews) },
            { label: "Visitors", value: formatCompact(summary.overview.uniqueVisitors) },
            { label: "Bounce rate", value: formatPercent(summary.overview.bounceRate) },
          ].map((item, index) => (
            <div key={item.label} className={`ov-kpi-cell${index > 0 ? " ov-kpi-cell--bordered" : ""}`}>
              <p className="ov-kpi-label">{item.label}</p>
              <p className="ov-kpi-number">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold text-text-primary">Overview highlights</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">High-level traffic and engagement indicators.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-4">
                <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <Flame className="size-3.5 text-accent-teal" />
                  Top page
                </div>
                <p className="mt-2 text-lg font-semibold text-text-primary">{topPage?.path || "/"}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {topPage ? `${formatCompact(topPage.pageviews)} views · ${formatPercent(topPage.avgScrollDepth)} depth` : "No page data"}
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-4">
                <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                  <Globe2 className="size-3.5 text-accent-teal" />
                  Top source
                </div>
                <p className="mt-2 text-lg font-semibold text-text-primary">{strongestReferrer?.source || "Direct"}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {strongestReferrer ? `${formatCompact(strongestReferrer.pageviews)} visits` : "No referrer data"}
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-4">
                <p className="text-[11px] text-text-secondary">Primary device</p>
                <p className="mt-2 text-lg font-semibold text-text-primary">{dominantDevice?.device || "Unknown"}</p>
                <p className="mt-1 text-[11px] text-text-muted">
                  {dominantDevice ? `${formatCompact(dominantDevice.pageviews)} pageviews` : "No device data"}
                </p>
              </div>
              <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-4">
                <p className="text-[11px] text-text-secondary">Rage clicks</p>
                <p className="mt-2 text-lg font-semibold text-text-primary">{formatCompact(summary.overview.rageClicks)}</p>
                <p className="mt-1 text-[11px] text-text-muted">Read-only signal of interaction friction.</p>
              </div>
            </div>
          </div>

          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold text-text-primary">Heatmap snapshot</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">Condensed page interaction context.</p>
            <div className="mt-4 space-y-3">
              {heatmap ? (
                <>
                  <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-4">
                    <p className="text-[11px] text-text-secondary">Focused path</p>
                    <p className="mt-2 text-lg font-semibold text-text-primary">{heatmap.path || "/"}</p>
                    <p className="mt-1 text-[11px] text-text-muted">
                      {formatCompact(heatmap.totals.clicks)} clicks · {formatCompact(heatmap.totals.moveEvents)} moves
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-3">
                      <p className="text-[10px] text-text-muted">Confidence</p>
                      <p className="mt-1.5 text-xl font-semibold text-text-primary">{Math.round(heatmap.confidence.score)}%</p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-3">
                      <p className="text-[10px] text-text-muted">Sessions</p>
                      <p className="mt-1.5 text-xl font-semibold text-text-primary">{formatCompact(heatmap.totals.uniqueSessions)}</p>
                    </div>
                    <div className="rounded-xl border border-border/50 bg-surface-tertiary/60 p-3">
                      <p className="text-[10px] text-text-muted">Rage share</p>
                      <p className="mt-1.5 text-xl font-semibold text-text-primary">
                        {heatmap.totals.clicks > 0
                          ? formatPercent((heatmap.totals.rageClicks / heatmap.totals.clicks) * 100)
                          : "0%"}
                      </p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border/50 bg-surface-tertiary/40 px-5 py-10 text-center">
                  <p className="text-[13px] font-medium text-text-primary">Heatmap data not published</p>
                  <p className="mt-1.5 text-[12px] text-text-secondary">
                    This shared dashboard does not include a public heatmap snapshot yet.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
