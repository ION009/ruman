"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardAIInsights, useDashboardReplaySessions, useDashboardSummary } from "@/hooks/use-dashboard";
import { formatCompact, formatPercent } from "@/lib/utils";

export function PerformanceView() {
  const summaryQuery = useDashboardSummary();
  const insightsQuery = useDashboardAIInsights();
  const replaySessionsQuery = useDashboardReplaySessions();

  if (summaryQuery.isLoading && insightsQuery.isLoading && !summaryQuery.data && !insightsQuery.data) {
    return <Skeleton className="h-[840px] rounded-2xl" />;
  }

  if (summaryQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-text-primary">Performance unavailable</h2>
        <p className="mt-2 text-sm text-status-error">{summaryQuery.error.message}</p>
      </div>
    );
  }

  if (!summaryQuery.data) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-text-primary">Performance unavailable</h2>
        <p className="mt-2 text-sm text-text-secondary">The performance beta does not have summary data yet.</p>
      </div>
    );
  }

  const sessions = replaySessionsQuery.data?.sessions ?? [];
  const pageSignals = summaryQuery.data.topPages.slice(0, 6).map((page) => {
    const relatedInsights = (insightsQuery.data?.items ?? []).filter((item) => item.path === page.path);
    const relatedSessions = sessions.filter((session) => session.paths.includes(page.path));
    const riskScore =
      page.rageClicks * 2 +
      relatedInsights.reduce((sum, item) => sum + item.score, 0) +
      relatedSessions.reduce((sum, session) => sum + session.networkFailureCount + session.consoleErrorCount, 0);

    return {
      path: page.path,
      pageviews: page.pageviews,
      avgScrollDepth: page.avgScrollDepth,
      rageClicks: page.rageClicks,
      riskScore,
      insightCount: relatedInsights.length,
    };
  });

  const performanceFindings = (insightsQuery.data?.items ?? []).filter((item) =>
    `${item.category} ${item.title} ${item.problem ?? ""}`.toLowerCase().includes("performance"),
  );
  const replayFailures = sessions.reduce(
    (sum, session) => sum + session.consoleErrorCount + session.networkFailureCount,
    0,
  );

  const maxRisk = Math.max(1, ...pageSignals.map((p) => p.riskScore));

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight text-text-primary">Performance</h1>
            <span className="rounded-md bg-accent-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">beta</span>
            <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">proxy signals</span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            Derived page risk from replay failures, friction signals, and AI findings. Not full web vitals telemetry.
          </p>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="ov-kpi-strip section-frame grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 sm:grid-cols-4">
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{formatCompact(pageSignals.length)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Watched pages</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-status-error">{formatCompact(replayFailures)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Replay failures</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-amber">{formatCompact(performanceFindings.length)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Perf insights</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-teal">{formatPercent(summaryQuery.data.overview.avgScrollDepth)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Avg scroll depth</span>
        </div>
      </div>

      {/* ── Main two-column layout ── */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr),minmax(280px,0.9fr)]">
        {/* Page watchlist */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <h3 className="mb-3 text-[14px] font-semibold text-text-primary">Page watchlist</h3>
          <p className="mb-4 text-[11px] text-text-muted">Derived performance pressure by page, ranked by composite risk score.</p>

          <div className="ov-list space-y-1">
            {/* List header */}
            <div className="grid grid-cols-[minmax(0,1.2fr),64px,72px] gap-3 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
              <span>Page</span>
              <span className="text-right">Risk</span>
              <span className="text-right">Views</span>
            </div>

            {pageSignals.length ? (
              pageSignals.map((page) => {
                const barWidth = (page.riskScore / maxRisk) * 100;
                return (
                  <div
                    key={page.path}
                    className="ov-list-row relative grid grid-cols-[minmax(0,1.2fr),64px,72px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-secondary/60"
                  >
                    {/* Bar background */}
                    <div className="ov-list-bar-bg absolute inset-0 overflow-hidden rounded-lg">
                      <div className="ov-list-bar-fill h-full bg-accent-amber/[0.06]" style={{ width: `${barWidth}%` }} />
                    </div>

                    {/* Path + meta */}
                    <div className="relative z-10 min-w-0">
                      <p className="ov-list-label truncate text-sm font-medium text-text-primary">{page.path}</p>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-text-muted">
                        <span>{page.rageClicks} rage clicks</span>
                        <span className="text-border-default">/</span>
                        <span>{page.insightCount} findings</span>
                        <span className="text-border-default">/</span>
                        <span>{formatPercent(page.avgScrollDepth)} scroll</span>
                      </div>
                    </div>

                    {/* Risk score */}
                    <span className="ov-list-value relative z-10 text-right text-sm font-semibold tabular-nums text-text-primary">
                      {formatCompact(page.riskScore)}
                    </span>

                    {/* Pageviews */}
                    <span className="ov-list-value relative z-10 text-right text-sm tabular-nums text-text-secondary">
                      {formatCompact(page.pageviews)}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg px-3 py-6 text-center text-sm text-text-secondary">
                No page signals available yet.
              </div>
            )}
          </div>
        </div>

        {/* Beta interpretation sidebar */}
        <div className="space-y-4">
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="mb-3 text-[14px] font-semibold text-text-primary">How to read this page</h3>
            <p className="text-sm text-text-secondary">
              Use this as a prioritization board. It identifies pages likely suffering from load or interaction drag,
              but is not yet a replacement for Web Vitals distributions.
            </p>
          </div>

          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-text-primary">Signals included</h3>
              <span className="rounded-md bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">proxy</span>
            </div>
            <ul className="mt-2.5 space-y-1.5 text-sm text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-accent-teal" />
                Replay console and network failures
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-accent-teal" />
                Rage clicks per page
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-accent-teal" />
                Top page engagement and scroll depth
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-accent-teal" />
                AI findings mentioning performance
              </li>
            </ul>
          </div>

          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-text-primary">Signals missing</h3>
              <span className="rounded-md bg-accent-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">pending</span>
            </div>
            <ul className="mt-2.5 space-y-1.5 text-sm text-text-secondary">
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-text-muted" />
                Largest Contentful Paint (LCP)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-text-muted" />
                Interaction to Next Paint (INP)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-text-muted" />
                Cumulative Layout Shift (CLS)
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1.5 block size-1 shrink-0 rounded-full bg-text-muted" />
                Full vitals query surface
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
