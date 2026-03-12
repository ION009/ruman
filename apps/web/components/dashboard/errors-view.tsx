"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useState } from "react";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardAIInsights, useDashboardReplaySessions } from "@/hooks/use-dashboard";
import { formatCompact, timeAgo } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Severity helpers                                                    */
/* ------------------------------------------------------------------ */

const SEVERITY_STYLE: Record<string, { dot: string; bg: string; text: string }> = {
  critical: { dot: "bg-status-error", bg: "bg-status-error-bg", text: "text-status-error" },
  warning:  { dot: "bg-accent-amber", bg: "bg-status-warning-bg", text: "text-amber-800 dark:text-amber-400" },
  info:     { dot: "bg-accent-teal", bg: "bg-status-info-bg", text: "text-accent-teal" },
};

function severitySpan(severity: string) {
  const s = SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.info;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${s.bg} ${s.text}`}
    >
      <span className={`inline-block size-1.5 rounded-full ${s.dot}`} />
      {severity}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                           */
/* ------------------------------------------------------------------ */

export function ErrorsView() {
  const replaySessionsQuery = useDashboardReplaySessions();
  const insightsQuery = useDashboardAIInsights();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  /* ---- loading ---- */
  if (replaySessionsQuery.isLoading && insightsQuery.isLoading && !replaySessionsQuery.data && !insightsQuery.data) {
    return <Skeleton className="h-[880px] rounded-2xl" />;
  }

  /* ---- error ---- */
  if (replaySessionsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h3 className="text-[14px] font-semibold text-text-primary">Errors unavailable</h3>
        <p className="mt-1 text-[12px] text-text-secondary">{replaySessionsQuery.error.message}</p>
      </div>
    );
  }

  /* ---- derive session issues ---- */
  const sessionIssues = (replaySessionsQuery.data?.sessions ?? []).flatMap((session) => {
    const issues = [];
    if (session.consoleErrorCount > 0) {
      issues.push({
        id: `console-${session.sessionId}`,
        severity: "critical",
        title: "Console errors",
        description: `${session.consoleErrorCount} console errors observed in replay sampling.`,
        path: session.entryPath || "/",
        count: session.consoleErrorCount,
        updatedAt: session.updatedAt,
        href: `/session-replay?session=${encodeURIComponent(session.sessionId)}`,
      });
    }
    if (session.networkFailureCount > 0) {
      issues.push({
        id: `network-${session.sessionId}`,
        severity: "warning",
        title: "Network failures",
        description: `${session.networkFailureCount} failed requests observed in replay sampling.`,
        path: session.entryPath || "/",
        count: session.networkFailureCount,
        updatedAt: session.updatedAt,
        href: `/session-replay?session=${encodeURIComponent(session.sessionId)}`,
      });
    }
    if (session.rageClickCount > 0 || session.deadClickCount > 0) {
      issues.push({
        id: `friction-${session.sessionId}`,
        severity: session.rageClickCount > 0 ? "warning" : "info",
        title: "Interaction friction",
        description: `${session.rageClickCount} rage clicks and ${session.deadClickCount} dead clicks surfaced in the session.`,
        path: session.entryPath || "/",
        count: session.rageClickCount + session.deadClickCount,
        updatedAt: session.updatedAt,
        href: `/session-replay?session=${encodeURIComponent(session.sessionId)}`,
      });
    }
    return issues;
  });

  /* ---- derive insight issues ---- */
  const insightIssues = (insightsQuery.data?.items ?? [])
    .filter((item) => item.severity === "critical" || item.severity === "warning")
    .map((item, index) => ({
      id: `insight-${index}-${item.path}`,
      severity: item.severity,
      title: item.title,
      description: item.problem ?? item.finding,
      path: item.path,
      count: item.score,
      updatedAt: insightsQuery.data?.generatedAt ?? new Date().toISOString(),
      href: "/ai-insight",
    }));

  /* ---- filter ---- */
  const issues = [...sessionIssues, ...insightIssues].filter((issue) =>
    `${issue.title} ${issue.description} ${issue.path}`
      .toLowerCase()
      .includes(deferredSearch.toLowerCase()),
  );

  const criticalCount = issues.filter((issue) => issue.severity === "critical").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const pathsAffected = new Set(issues.map((issue) => issue.path)).size;
  const maxCount = Math.max(...issues.map((i) => i.count), 1);

  /* ---- group by severity for ranked clusters ---- */
  const criticalIssues = issues.filter((i) => i.severity === "critical");
  const warningIssues = issues.filter((i) => i.severity === "warning");
  const infoIssues = issues.filter((i) => i.severity !== "critical" && i.severity !== "warning");

  return (
    <div className="ov-root">
      {/* ---- page header ---- */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-text-muted">
          Issue Triage
        </p>
        <h2 className="mt-1 text-[20px] font-semibold leading-snug tracking-tight text-text-primary sm:text-[22px]">
          Error Board
        </h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-text-secondary">
          Replay-derived failures and AI-detected issues in one triage surface.
          Move from symptom to replay quickly.
        </p>
      </div>

      {/* ---- KPI strip ---- */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Open issues</span>
          <span className="ov-kpi-number">{formatCompact(issues.length)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Critical</span>
          <span className="ov-kpi-number" style={{ color: criticalCount > 0 ? "#DC2626" : undefined }}>
            {formatCompact(criticalCount)}
          </span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Warnings</span>
          <span className="ov-kpi-number">{formatCompact(warningCount)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">Replay-linked</span>
          <span className="ov-kpi-number">{formatCompact(sessionIssues.length)}</span>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <span className="ov-kpi-label">AI findings</span>
          <span className="ov-kpi-number">{formatCompact(insightIssues.length)}</span>
        </div>
        <div className="ov-kpi-cell">
          <span className="ov-kpi-label">Paths affected</span>
          <span className="ov-kpi-number">{formatCompact(pathsAffected)}</span>
        </div>
      </div>

      {/* ---- search ---- */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search issue title, path, or description..."
          className="pl-9"
        />
      </div>

      {/* ---- severity clusters ---- */}
      {issues.length === 0 ? (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <p className="text-[13px] font-medium text-text-primary">No visible error pressure yet.</p>
          <p className="mt-1 text-[12px] text-text-secondary">
            When replay sampling or AI analysis surfaces failures, this board will centralize them.
          </p>
        </div>
      ) : (
        <>
          {criticalIssues.length > 0 && (
            <IssueCluster label="Critical" issues={criticalIssues} maxCount={maxCount} />
          )}
          {warningIssues.length > 0 && (
            <IssueCluster label="Warnings" issues={warningIssues} maxCount={maxCount} />
          )}
          {infoIssues.length > 0 && (
            <IssueCluster label="Other" issues={infoIssues} maxCount={maxCount} />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Issue cluster (severity-grouped section with ov-list)               */
/* ------------------------------------------------------------------ */

interface Issue {
  id: string;
  severity: string;
  title: string;
  description: string;
  path: string;
  count: number;
  updatedAt: string;
  href: string;
}

function IssueCluster({
  label,
  issues,
  maxCount,
}: {
  label: string;
  issues: Issue[];
  maxCount: number;
}) {
  return (
    <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
      <div className="ov-section-header mb-2" style={{ padding: 0, borderBottom: "none" }}>
        <h3 className="ov-section-title">{label}</h3>
        <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
          {issues.length} {issues.length === 1 ? "issue" : "issues"}
        </span>
      </div>

      <div className="ov-list">
        <div className="ov-list-header">
          <span>Issue</span>
          <span>Count</span>
        </div>

        {issues.map((issue) => (
          <Link
            key={issue.id}
            href={issue.href}
            className="ov-list-row group"
            style={{ textDecoration: "none" }}
          >
            {/* bar background */}
            <div className="ov-list-bar-bg">
              <div
                className="ov-list-bar-fill"
                style={{
                  width: `${Math.round((issue.count / maxCount) * 100)}%`,
                  backgroundColor:
                    issue.severity === "critical"
                      ? "#FCA5A5"
                      : issue.severity === "warning"
                        ? "#FDE68A"
                        : "#99F6E4",
                }}
              />
            </div>

            {/* left: title + meta */}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className="ov-list-label" style={{ flex: "none" }}>
                  {issue.title}
                </span>
                {severitySpan(issue.severity)}
              </div>
              <span className="truncate text-[11px] text-text-muted">
                {issue.path}
                <span className="mx-1.5 text-border-default">/</span>
                {timeAgo(issue.updatedAt)}
              </span>
            </div>

            {/* right: count + link hint */}
            <div className="flex shrink-0 items-center gap-3">
              <span className="ov-list-value">{formatCompact(issue.count)}</span>
              <span className="text-[11px] text-text-muted opacity-0 transition-opacity group-hover:opacity-100">
                {issue.href.startsWith("/session-replay") ? "Replay" : "Insight"} &rarr;
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
