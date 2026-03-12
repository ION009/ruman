"use client";

import { Activity, ArrowRight, Goal, Radio, Siren, Users } from "lucide-react";
import Link from "next/link";

import { OpsHero, OpsMetricCard, OpsNotice, OpsStatusBadge } from "@/components/dashboard/ops-kit";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardGoalReport, useDashboardReplaySessions, useDashboardSummary } from "@/hooks/use-dashboard";
import { formatCompact, formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

export function RealTimeView() {
  const selectedRange = useDashboardStore((state) => state.selectedRange);
  const summaryQuery = useDashboardSummary();
  const replaySessionsQuery = useDashboardReplaySessions();
  const goalReportQuery = useDashboardGoalReport();

  if (
    summaryQuery.isLoading &&
    replaySessionsQuery.isLoading &&
    goalReportQuery.isLoading &&
    !summaryQuery.data &&
    !replaySessionsQuery.data
  ) {
    return <Skeleton className="h-[880px] rounded-2xl" />;
  }

  if (summaryQuery.error) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Live Activity unavailable</CardTitle>
        <CardDescription>{summaryQuery.error.message}</CardDescription>
      </Card>
    );
  }

  if (!summaryQuery.data) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Live Activity unavailable</CardTitle>
        <CardDescription>The live summary payload did not include any data.</CardDescription>
      </Card>
    );
  }

  const liveSessions = [...(replaySessionsQuery.data?.sessions ?? [])]
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
    .slice(0, 8);
  const goalRows = [...(goalReportQuery.data?.goals ?? [])].sort(
    (left, right) => right.conversions - left.conversions,
  );
  const activePages = summaryQuery.data.topPages.slice(0, 6);
  const issueHeavySessions = liveSessions.filter(
    (session) => session.errorCount > 0 || session.rageClickCount > 0,
  ).length;
  const liveGoalConversions = goalRows.reduce((sum, goal) => sum + goal.conversions, 0);
  const topPageTraffic = activePages[0]?.pageviews ?? 0;

  return (
    <div className="space-y-6">
      <OpsHero
        eyebrow="Live Activity"
        title="Run the operator board for active traffic, issue triage, and sampled replay movement."
        description="This page is the live operations surface: current visitor pressure, session replay triage, hot pages, and the goals converting right now."
        actions={
          <>
            <Button asChild size="sm">
              <Link href="/session-replay">
                Open replay queue
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/goals">Review goal reporting</Link>
            </Button>
          </>
        }
        aside={
          <div className="space-y-4">
            <div>
              <p className="eyebrow text-[10px] text-muted-foreground">Current watch</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight">
                {formatNumber(summaryQuery.data.overview.realtimeVisitors)}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                live visitors with {formatCompact(liveSessions.length)} sampled sessions flowing through the replay queue.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <div className="rounded-[1.35rem] border border-border/70 bg-white/68 p-3.5">
                <p className="eyebrow text-[10px] text-muted-foreground">Issue-heavy sessions</p>
                <p className="mt-2 text-xl font-semibold">{formatCompact(issueHeavySessions)}</p>
              </div>
              <div className="rounded-[1.35rem] border border-border/70 bg-white/68 p-3.5">
                <p className="eyebrow text-[10px] text-muted-foreground">Tracked conversions</p>
                <p className="mt-2 text-xl font-semibold">{formatCompact(liveGoalConversions)}</p>
              </div>
            </div>
          </div>
        }
      />

      {selectedRange !== "24h" ? (
        <OpsNotice
          tone="warning"
          title="Live Activity is sharpest on the 24h window."
          description="The operator board still works on broader ranges, but active triage is clearest when the global dashboard range is set to `24h`."
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <OpsMetricCard
          label="Active visitors"
          value={formatNumber(summaryQuery.data.overview.realtimeVisitors)}
          detail="Visitors active within the current live sampling window."
          icon={Users}
        />
        <OpsMetricCard
          label="Hot pages"
          value={formatNumber(activePages.length)}
          detail={activePages[0] ? `${activePages[0].path} is carrying the strongest volume.` : "No pages in the live set yet."}
          icon={Radio}
          accent="info"
        />
        <OpsMetricCard
          label="Issue pressure"
          value={formatNumber(issueHeavySessions)}
          detail="Sessions carrying rage, dead clicks, console noise, or network failures."
          icon={Siren}
          accent={issueHeavySessions > 0 ? "warning" : "default"}
        />
        <OpsMetricCard
          label="Goal conversions"
          value={formatCompact(liveGoalConversions)}
          detail={goalRows[0] ? `${goalRows[0].name} is leading the current conversion board.` : "No goal conversions surfaced yet."}
          icon={Goal}
          accent="critical"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr),minmax(320px,0.9fr)]">
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Live feed</CardTitle>
                <CardDescription>Most recent sampled sessions with issue-first flags.</CardDescription>
              </div>
              <OpsStatusBadge tone="info">{formatCompact(liveSessions.length)} tracked</OpsStatusBadge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {liveSessions.length ? (
              liveSessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="rounded-[1.4rem] border border-border/70 bg-white/65 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold">{session.entryPath || "/"}</p>
                        {session.errorCount > 0 ? <Badge variant="critical">{session.errorCount} errors</Badge> : null}
                        {session.rageClickCount > 0 ? <Badge variant="warning">{session.rageClickCount} rage</Badge> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {session.deviceType || "device"} · {session.browser || "browser"} · {session.os || "os"} · updated {timeAgo(session.updatedAt)}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/session-replay?session=${encodeURIComponent(session.sessionId)}`}>
                        Open replay
                      </Link>
                    </Button>
                  </div>

                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                    <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-2">
                      <p className="eyebrow text-[10px] text-muted-foreground">Path spread</p>
                      <p className="mt-1 truncate">{session.paths.slice(0, 3).join(" • ") || session.exitPath || "/"}</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-2">
                      <p className="eyebrow text-[10px] text-muted-foreground">Duration</p>
                      <p className="mt-1">{Math.round(session.durationMs / 1000)}s · {formatCompact(session.eventCount)} events</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/80 px-3 py-2">
                      <p className="eyebrow text-[10px] text-muted-foreground">Capture</p>
                      <p className="mt-1">{session.chunkCount} chunks · {Math.round(session.sampleRate * 100)}% sampled</p>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <OpsNotice
                title="No live replay feed yet."
                description="Once replay-sampled sessions arrive, this queue becomes the operator feed for active triage."
              />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle>Active pages</CardTitle>
              <CardDescription>Where current traffic is concentrating.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activePages.length ? (
                activePages.map((page) => {
                  const share = topPageTraffic > 0 ? (page.pageviews / topPageTraffic) * 100 : 0;
                  return (
                    <div key={page.path} className="rounded-[1.3rem] border border-border/70 bg-white/65 p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="truncate text-sm font-medium">{page.path}</p>
                        <p className="text-sm font-semibold">{formatCompact(page.pageviews)}</p>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-secondary/80">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(12, share)}%` }} />
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {formatCompact(page.sessions)} sessions · {formatPercent(page.avgScrollDepth)} avg scroll
                      </p>
                    </div>
                  );
                })
              ) : (
                <OpsNotice
                  title="No active pages in the current range."
                  description="As traffic lands, the pages absorbing the most volume will surface here."
                />
              )}
            </CardContent>
          </Card>

          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle>Live conversions</CardTitle>
              <CardDescription>Goal performance on the current board.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {goalRows.length ? (
                goalRows.slice(0, 5).map((goal) => (
                  <div key={goal.id} className="rounded-[1.3rem] border border-border/70 bg-white/65 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{goal.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {goal.type} · {goal.match} · {goal.value}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">{formatCompact(goal.conversions)}</p>
                        <p className="text-xs text-muted-foreground">{formatPercent(goal.conversionRate, 1)} CVR</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <OpsNotice
                  title="No goal reporting yet."
                  description="Create tracked goals to see live conversion pressure alongside current traffic."
                />
              )}
            </CardContent>
          </Card>

          <Card className="section-frame rounded-2xl">
            <CardContent className="p-4">
              <div className="rounded-[1.35rem] border border-border/70 bg-white/62 p-4">
                <div className="flex items-center gap-2">
                  <Activity className="size-4 text-primary" />
                  <p className="text-sm font-medium">Operator note</p>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Live Activity reuses summary, replay, and goal analytics payloads already flowing through the app. It is intended for fast launch operations, not long-range historical analysis.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
