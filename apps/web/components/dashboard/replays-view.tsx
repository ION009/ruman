"use client";

import { AlertTriangle, Clapperboard, Lock, Search, Shield, Zap } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useState } from "react";

import { ReplayPlayer } from "@/components/charts/replay-player";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardReplaySession, useDashboardReplaySessions } from "@/hooks/use-dashboard";
import { cn, formatCompact, formatDateTime, timeAgo } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function issueTagsForSession(session: {
  consoleErrorCount: number;
  networkFailureCount: number;
  rageClickCount: number;
  deadClickCount: number;
  durationMs: number;
  pageCount: number;
}) {
  const tags: { label: string; tone: "error" | "warning" | "info" }[] = [];
  if (session.consoleErrorCount > 0) tags.push({ label: "Console errors", tone: "error" });
  if (session.networkFailureCount > 0) tags.push({ label: "Network failures", tone: "error" });
  if (session.rageClickCount > 0) tags.push({ label: "Rage clicks", tone: "warning" });
  if (session.deadClickCount > 0) tags.push({ label: "Dead clicks", tone: "warning" });
  if (session.durationMs < 15_000 && session.pageCount <= 1) tags.push({ label: "Short bounce", tone: "info" });
  return tags.slice(0, 4);
}

const TRIAGE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "errors", label: "Errors" },
  { value: "friction", label: "Friction" },
  { value: "dropoff", label: "Drop-off" },
] as const;

/* ------------------------------------------------------------------ */
/*  Main ReplaysView                                                   */
/* ------------------------------------------------------------------ */

export function ReplaysView() {
  const searchParams = useSearchParams();
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [triageMode, setTriageMode] = useState<"all" | "errors" | "friction" | "dropoff">("all");
  const replaySessionsQuery = useDashboardReplaySessions();
  const replaySessionQuery = useDashboardReplaySession(selectedSessionId);

  useEffect(() => {
    setSelectedSessionId("");
  }, [selectedSiteId]);

  useEffect(() => {
    const requestedSessionId = searchParams.get("session") ?? "";
    if (
      requestedSessionId &&
      replaySessionsQuery.data?.sessions.some((s) => s.sessionId === requestedSessionId)
    ) {
      setSelectedSessionId(requestedSessionId);
      return;
    }
    if (!selectedSessionId && replaySessionsQuery.data?.sessions[0]?.sessionId) {
      setSelectedSessionId(replaySessionsQuery.data.sessions[0].sessionId);
      return;
    }
    if (
      selectedSessionId &&
      replaySessionsQuery.data &&
      !replaySessionsQuery.data.sessions.some((s) => s.sessionId === selectedSessionId)
    ) {
      setSelectedSessionId(replaySessionsQuery.data.sessions[0]?.sessionId ?? "");
    }
  }, [replaySessionsQuery.data, searchParams, selectedSessionId]);

  /* ---- Error/Loading/Empty ---- */

  if (replaySessionsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-status-error">Session replay unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{replaySessionsQuery.error.message}</p>
      </div>
    );
  }

  if (replaySessionsQuery.isLoading && !replaySessionsQuery.data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[480px] rounded-2xl" />
        <Skeleton className="h-[100px] rounded-2xl" />
      </div>
    );
  }

  const sessions = replaySessionsQuery.data?.sessions ?? [];

  if (sessions.length === 0) {
    return (
      <div className="section-frame flex flex-col items-center justify-center rounded-2xl border border-border/50 py-16 text-center">
        <Clapperboard className="size-10 text-text-muted" />
        <h3 className="mt-4 text-[15px] font-semibold text-text-primary">No replay sessions yet</h3>
        <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
          Session replay stores a masked DOM baseline plus incremental events. Once the tracker is
          installed and sampled visitors arrive, replays will appear here.
        </p>
      </div>
    );
  }

  /* ---- Filtering ---- */

  const query = deferredSearch.trim().toLowerCase();
  const filteredSessions = sessions.filter((session) => {
    if (triageMode === "errors" && session.consoleErrorCount + session.networkFailureCount <= 0) return false;
    if (triageMode === "friction" && session.rageClickCount + session.deadClickCount <= 0) return false;
    if (triageMode === "dropoff" && !(session.durationMs < 15_000 || session.pageCount <= 1)) return false;
    if (issuesOnly && session.errorCount <= 0 && session.rageClickCount <= 0) return false;
    if (!query) return true;
    return [session.sessionId, session.entryPath, session.exitPath, session.browser, session.deviceType, ...session.paths]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  const selectedSession = filteredSessions.find((s) => s.sessionId === selectedSessionId)
    ?? sessions.find((s) => s.sessionId === selectedSessionId)
    ?? filteredSessions[0]
    ?? sessions[0];

  const issueHeavyCount = sessions.filter((s) => s.errorCount > 0 || s.rageClickCount > 0).length;
  const replayCoverage = Math.max(...sessions.map((s) => s.sampleRate || 0));

  return (
    <div className="space-y-5 overflow-x-hidden">
      {/* ---- 1. Replay Player (HERO — at the top) ---- */}
      <div className="section-frame overflow-hidden rounded-2xl border border-border/50">
        {selectedSession ? (
          replaySessionQuery.isLoading && !replaySessionQuery.data ? (
            <Skeleton className="h-[480px]" />
          ) : replaySessionQuery.error ? (
            <div className="p-6">
              <h3 className="text-[14px] font-semibold text-status-error">Replay unavailable</h3>
              <p className="mt-1 text-[13px] text-text-secondary">{replaySessionQuery.error.message}</p>
            </div>
          ) : replaySessionQuery.data ? (
            <ReplayPlayer detail={replaySessionQuery.data} />
          ) : (
            <div className="p-6">
              <h3 className="text-[14px] font-semibold text-text-primary">No replay data</h3>
              <p className="mt-1 text-[13px] text-text-secondary">The selected session did not return replay chunks.</p>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center py-20 text-[13px] text-text-secondary">
            Select a session below to load the replay.
          </div>
        )}
      </div>

      {/* ---- 2. Issue Markers (below player) ---- */}
      {selectedSession && (
        <div className="flex flex-wrap gap-2">
          {issueTagsForSession(selectedSession).map((tag) => (
            <span
              key={tag.label}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium",
                tag.tone === "error" && "bg-status-error-bg text-status-error",
                tag.tone === "warning" && "bg-status-warning-bg text-amber-800 dark:text-amber-400",
                tag.tone === "info" && "bg-surface-secondary text-text-secondary",
              )}
            >
              {tag.tone === "error" && <AlertTriangle className="size-3" />}
              {tag.tone === "warning" && <Zap className="size-3" />}
              {tag.label}
            </span>
          ))}
          {issueTagsForSession(selectedSession).length === 0 && (
            <span className="text-[12px] text-text-muted">No issues detected in this session.</span>
          )}
        </div>
      )}

      {/* ---- 3. Two Metric Cards ---- */}
      {selectedSession && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="section-frame rounded-2xl border border-border/50 p-4">
            <h3 className="ov-section-title mb-3">Session Details</h3>
            <div className="ov-kpi-strip">
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Started</p>
                <p className="mt-1 text-[13px] font-semibold text-text-primary">{formatDateTime(selectedSession.startedAt)}</p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Duration</p>
                <p className="mt-1 ov-kpi-number">{formatDuration(selectedSession.durationMs)}</p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Pages</p>
                <p className="mt-1 ov-kpi-number">{selectedSession.pageCount}</p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Events</p>
                <p className="mt-1 ov-kpi-number">{formatCompact(selectedSession.eventCount)}</p>
              </div>
            </div>
          </div>

          <div className="section-frame rounded-2xl border border-border/50 p-4">
            <h3 className="ov-section-title mb-3">Interaction Quality</h3>
            <div className="ov-kpi-strip">
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Errors</p>
                <p className={cn(
                  "mt-1 ov-kpi-number",
                  selectedSession.consoleErrorCount > 0 && "text-status-error"
                )}>
                  {selectedSession.consoleErrorCount}
                </p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Network</p>
                <p className={cn(
                  "mt-1 ov-kpi-number",
                  selectedSession.networkFailureCount > 0 && "text-status-error"
                )}>
                  {selectedSession.networkFailureCount}
                </p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Rage</p>
                <p className={cn(
                  "mt-1 ov-kpi-number",
                  selectedSession.rageClickCount > 0 && "text-accent-amber"
                )}>
                  {selectedSession.rageClickCount}
                </p>
              </div>
              <div className="ov-kpi-cell">
                <p className="ov-kpi-label">Dead</p>
                <p className={cn(
                  "mt-1 ov-kpi-number",
                  selectedSession.deadClickCount > 0 && "text-accent-amber"
                )}>
                  {selectedSession.deadClickCount}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- 4. Session List + Filters ---- */}
      <div className="grid gap-5 xl:grid-cols-[280px,minmax(0,1fr)]">
        {/* Filters sidebar */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search path, browser, device..."
              className="h-9 rounded-xl border-border-default pl-9 text-[12px]"
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            {TRIAGE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTriageMode(opt.value as typeof triageMode)}
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors",
                  triageMode === opt.value
                    ? "bg-foreground text-white"
                    : "bg-surface-secondary text-text-secondary hover:bg-surface-hover"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setIssuesOnly((v) => !v)}
            className={cn(
              "w-full rounded-xl border px-3 py-2 text-left text-[12px] font-medium transition-colors",
              issuesOnly
                ? "border-status-error/30 bg-status-error-bg text-status-error"
                : "border-border/60 bg-surface-primary text-text-secondary hover:bg-surface-tertiary"
            )}
          >
            {issuesOnly ? "Showing issues only" : "Show only issues"}
          </button>

          {/* Summary stats */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-secondary">Total sessions</span>
              <span className="font-semibold tabular-nums text-text-primary">{sessions.length}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-secondary">Issue-heavy</span>
              <span className="font-semibold tabular-nums text-status-error">{issueHeavyCount}</span>
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-text-secondary">Peak sample rate</span>
              <span className="font-semibold tabular-nums text-text-primary">{Math.round(replayCoverage * 100)}%</span>
            </div>
          </div>
        </div>

        {/* Session list */}
        <ScrollArea className="h-[480px]">
          <div className="space-y-1.5">
            {filteredSessions.map((session) => {
              const active = session.sessionId === selectedSession?.sessionId;
              const hasIssues = session.errorCount > 0 || session.rageClickCount > 0;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  onClick={() => setSelectedSessionId(session.sessionId)}
                  className={cn(
                    "w-full rounded-lg px-3 py-2.5 text-left transition-colors",
                    active
                      ? "bg-accent-teal/10"
                      : "hover:bg-surface-tertiary"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className={cn(
                        "truncate text-[13px] font-medium",
                        active ? "text-accent-teal" : "text-text-primary"
                      )}>
                        {session.entryPath || "/"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasIssues && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-status-error-bg px-1.5 py-0.5 text-[10px] font-medium text-status-error">
                          <AlertTriangle className="size-2.5" />
                          {session.errorCount + session.rageClickCount}
                        </span>
                      )}
                      <span className="text-[11px] tabular-nums text-text-muted">
                        {timeAgo(session.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                    <span>{session.deviceType}</span>
                    <span>{session.browser}</span>
                    <span>{formatDuration(session.durationMs)}</span>
                    <span>{formatCompact(session.eventCount)} events</span>
                  </div>
                </button>
              );
            })}
            {filteredSessions.length === 0 && (
              <p className="py-6 text-center text-[13px] text-text-muted">
                No sessions match the current filters.
              </p>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ---- 5. Privacy Section ---- */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <div className="ov-section-header mb-3">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-accent-teal" />
            <h3 className="ov-section-title">Privacy & Masking</h3>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-border-default p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-primary">
              <Lock className="size-3 text-accent-teal" />
              Selective text masking
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">
              Only sensitive fields are masked. Non-private content replays exactly as visitors see it.
            </p>
          </div>
          <div className="rounded-lg border border-border-default p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-primary">
              <Lock className="size-3 text-accent-teal" />
              Input & form blocking
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">
              Forms, passwords, payment fields, and <code className="text-[10px]">data-replay-block</code> regions are replaced before send.
            </p>
          </div>
          <div className="rounded-lg border border-border-default p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-medium text-text-primary">
              <Lock className="size-3 text-accent-teal" />
              Metadata-only requests
            </div>
            <p className="mt-1 text-[11px] text-text-secondary">
              Only method, status, and duration are kept. No request or response bodies are shipped.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
