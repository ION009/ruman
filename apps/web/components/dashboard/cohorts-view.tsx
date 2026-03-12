"use client";

import { ArrowRight, Filter, Loader2, Radio, Search, Users2 } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardReplaySessions, useDashboardSummary } from "@/hooks/use-dashboard";
import { cn, formatCompact, timeAgo } from "@/lib/utils";
import type { ReplaySessionSummary } from "@/lib/dashboard/types";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type CohortSegment = {
    id: string;
    name: string;
    description: string;
    filter: (session: ReplaySessionSummary) => boolean;
};

/* ------------------------------------------------------------------ */
/*  Built-in cohorts                                                   */
/* ------------------------------------------------------------------ */

const builtInCohorts: CohortSegment[] = [
    {
        id: "all",
        name: "All Users",
        description: "Every tracked user session",
        filter: () => true,
    },
    {
        id: "mobile",
        name: "Mobile Users",
        description: "Users on mobile devices",
        filter: (s) => s.deviceType === "mobile",
    },
    {
        id: "desktop",
        name: "Desktop Users",
        description: "Users on desktop devices",
        filter: (s) => s.deviceType === "desktop",
    },
    {
        id: "rage-clickers",
        name: "Frustrated Users",
        description: "Had rage clicks or dead clicks",
        filter: (s) => s.rageClickCount > 0 || s.deadClickCount > 0,
    },
    {
        id: "errors",
        name: "Error Encounters",
        description: "Sessions with console errors",
        filter: (s) => s.errorCount > 0 || s.consoleErrorCount > 0,
    },
    {
        id: "power-users",
        name: "Power Users",
        description: "Visited 5+ pages per session",
        filter: (s) => s.pageCount >= 5,
    },
    {
        id: "single-page",
        name: "Single-Page Visitors",
        description: "Viewed only one page (bounced)",
        filter: (s) => s.pageCount <= 1,
    },
    {
        id: "long-sessions",
        name: "Long Sessions",
        description: "Sessions longer than 3 minutes",
        filter: (s) => s.durationMs > 180_000,
    },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const COHORT_COLORS: Record<string, string> = {
    mobile: "#0D9488",
    desktop: "#0D9488",
    "rage-clickers": "#DC2626",
    errors: "#F59E0B",
    "power-users": "#0D9488",
    "single-page": "#78716C",
    "long-sessions": "#0D9488",
};

function cohortColor(id: string) {
    return COHORT_COLORS[id] ?? "#0D9488";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CohortsView() {
    const replaysQuery = useDashboardReplaySessions();
    const summaryQuery = useDashboardSummary();
    const [selectedCohortId, setSelectedCohortId] = useState("all");
    const [searchQuery, setSearchQuery] = useState("");
    const deferredSearch = useDeferredValue(searchQuery);

    const sessions = replaysQuery.data?.sessions ?? [];

    const cohortStats = useMemo(() => {
        return builtInCohorts.map((cohort) => {
            const matching = sessions.filter(cohort.filter);
            const avgDuration = matching.length > 0
                ? matching.reduce((sum, s) => sum + s.durationMs, 0) / matching.length
                : 0;
            const avgPages = matching.length > 0
                ? matching.reduce((sum, s) => sum + s.pageCount, 0) / matching.length
                : 0;
            const rageClicks = matching.reduce((sum, s) => sum + s.rageClickCount, 0);
            const errors = matching.reduce((sum, s) => sum + s.errorCount + s.consoleErrorCount, 0);
            return {
                ...cohort,
                count: matching.length,
                avgDuration,
                avgPages,
                rageClicks,
                errors,
                percentage: sessions.length > 0 ? (matching.length / sessions.length) * 100 : 0,
            };
        });
    }, [sessions]);

    const selectedCohort = builtInCohorts.find((c) => c.id === selectedCohortId) ?? builtInCohorts[0];
    const filteredSessions = useMemo(() => {
        let result = sessions.filter(selectedCohort.filter);
        if (deferredSearch) {
            const q = deferredSearch.toLowerCase();
            result = result.filter(
                (s) =>
                    s.entryPath.toLowerCase().includes(q) ||
                    s.exitPath.toLowerCase().includes(q) ||
                    s.browser.toLowerCase().includes(q) ||
                    s.os.toLowerCase().includes(q)
            );
        }
        return result;
    }, [sessions, selectedCohort, deferredSearch]);

    /* ---- Loading state ---- */

    if (replaysQuery.isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-14 rounded-2xl" />
                <div className="grid gap-3 sm:grid-cols-4">
                    <Skeleton className="h-20 rounded-xl" />
                    <Skeleton className="h-20 rounded-xl" />
                    <Skeleton className="h-20 rounded-xl" />
                    <Skeleton className="h-20 rounded-xl" />
                </div>
                <Skeleton className="h-40 rounded-xl" />
            </div>
        );
    }

    const selectedStats = cohortStats.find((c) => c.id === selectedCohortId);

    return (
        <div className="space-y-5">

            {/* ── Page header ─────────────────────────────── */}
            <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-teal/10">
                    <Users2 className="size-4 text-accent-teal" />
                </div>
                <div>
                    <h2 className="text-sm font-semibold text-text-primary">Segments &amp; Cohorts</h2>
                    <p className="text-[11px] text-text-secondary">
                        {sessions.length} session{sessions.length !== 1 ? "s" : ""} analyzed
                        <span className="mx-1 text-text-muted">/</span>
                        {builtInCohorts.length} segments
                    </p>
                </div>
            </div>

            {/* ── Top-level KPI strip ─────────────────────── */}
            <div className="ov-kpi-strip">
                <div className="ov-kpi-cell ov-kpi-cell--bordered">
                    <span className="ov-kpi-number">{sessions.length}</span>
                    <span className="ov-kpi-label">Total Sessions</span>
                </div>
                <div className="ov-kpi-cell ov-kpi-cell--bordered">
                    <span className="ov-kpi-number">
                        {sessions.length > 0
                            ? (sessions.reduce((s, r) => s + r.durationMs, 0) / sessions.length / 1000).toFixed(0) + "s"
                            : "0s"}
                    </span>
                    <span className="ov-kpi-label">Avg Duration</span>
                </div>
                <div className="ov-kpi-cell ov-kpi-cell--bordered">
                    <span className="ov-kpi-number">
                        {sessions.length > 0
                            ? (sessions.reduce((s, r) => s + r.pageCount, 0) / sessions.length).toFixed(1)
                            : "0"}
                    </span>
                    <span className="ov-kpi-label">Avg Pages</span>
                </div>
                <div className="ov-kpi-cell">
                    <span className="ov-kpi-number">
                        {sessions.reduce((s, r) => s + r.rageClickCount, 0)}
                    </span>
                    <span className="ov-kpi-label">Rage Clicks</span>
                </div>
            </div>

            {/* ── Segment selector grid ───────────────────── */}
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {cohortStats.filter((c) => c.id !== "all").map((cohort) => {
                    const active = selectedCohortId === cohort.id;
                    const color = cohortColor(cohort.id);
                    return (
                        <button
                            key={cohort.id}
                            onClick={() => setSelectedCohortId(cohort.id)}
                            className={cn(
                                "section-frame rounded-2xl border border-border/50 p-4 text-left transition-all",
                                active && "ring-2 ring-[#0D9488]/30"
                            )}
                        >
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[13px] font-semibold text-text-primary">{cohort.name}</span>
                                <span
                                    className="text-xs font-semibold tabular-nums"
                                    style={{ color }}
                                >
                                    {cohort.count}
                                </span>
                            </div>

                            {/* Progress bar */}
                            <div className="h-1 rounded-full bg-surface-secondary overflow-hidden mb-2">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${Math.max(cohort.percentage, 1)}%`,
                                        backgroundColor: color,
                                        opacity: 0.55,
                                    }}
                                />
                            </div>

                            <p className="text-[11px] text-text-muted leading-snug">{cohort.description}</p>

                            <div className="mt-2 flex gap-3 text-[10px] text-text-secondary">
                                <span>{(cohort.avgDuration / 1000).toFixed(0)}s avg</span>
                                <span>{cohort.avgPages.toFixed(1)} pages</span>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* ── Selected cohort detail panel ────────────── */}
            <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">

                {/* Panel header with search */}
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                    <div className="flex items-center gap-2">
                        <span
                            className="inline-flex size-2 rounded-full"
                            style={{ backgroundColor: cohortColor(selectedCohortId) }}
                        />
                        <span className="text-sm font-semibold text-text-primary">{selectedCohort.name}</span>
                        <span className="text-xs tabular-nums text-text-secondary">
                            {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
                        </span>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3 text-text-muted" />
                        <Input
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search paths, browser..."
                            className="h-8 w-[200px] pl-7 rounded-lg text-xs border-border/50"
                        />
                    </div>
                </div>

                {/* Cohort KPI strip */}
                {selectedStats && (
                    <div className="ov-kpi-strip mb-4">
                        <div className="ov-kpi-cell ov-kpi-cell--bordered">
                            <span className="ov-kpi-number text-base">{selectedStats.count}</span>
                            <span className="ov-kpi-label">Sessions</span>
                        </div>
                        <div className="ov-kpi-cell ov-kpi-cell--bordered">
                            <span className="ov-kpi-number text-base">{(selectedStats.avgDuration / 1000).toFixed(0)}s</span>
                            <span className="ov-kpi-label">Avg Duration</span>
                        </div>
                        <div className="ov-kpi-cell ov-kpi-cell--bordered">
                            <span className="ov-kpi-number text-base">{selectedStats.avgPages.toFixed(1)}</span>
                            <span className="ov-kpi-label">Avg Pages</span>
                        </div>
                        <div className="ov-kpi-cell ov-kpi-cell--bordered">
                            <span className="ov-kpi-number text-base" style={{ color: selectedStats.rageClicks > 0 ? "#DC2626" : undefined }}>
                                {selectedStats.rageClicks}
                            </span>
                            <span className="ov-kpi-label">Rage Clicks</span>
                        </div>
                        <div className="ov-kpi-cell">
                            <span className="ov-kpi-number text-base" style={{ color: selectedStats.errors > 0 ? "#F59E0B" : undefined }}>
                                {selectedStats.errors}
                            </span>
                            <span className="ov-kpi-label">Errors</span>
                        </div>
                    </div>
                )}

                {/* Session list */}
                {filteredSessions.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10">
                        <Filter className="size-5 text-text-muted" />
                        <p className="mt-2 text-xs text-text-secondary">No sessions match this cohort.</p>
                    </div>
                ) : (
                    <div className="ov-list">
                        {/* List header */}
                        <div className="ov-list-header">
                            <span>Session</span>
                            <span>Details</span>
                        </div>

                        {/* List rows */}
                        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
                            {filteredSessions.slice(0, 50).map((session) => {
                                const totalMax = sessions.length > 0
                                    ? Math.max(...sessions.map((s) => s.pageCount), 1)
                                    : 1;
                                const barPct = Math.max((session.pageCount / totalMax) * 100, 2);
                                return (
                                    <div
                                        key={session.sessionId}
                                        className="ov-list-row"
                                    >
                                        {/* Bar bg */}
                                        <div className="ov-list-bar-bg">
                                            <div
                                                className="ov-list-bar-fill"
                                                style={{
                                                    width: `${barPct}%`,
                                                    backgroundColor: cohortColor(selectedCohortId),
                                                    opacity: 0.25,
                                                }}
                                            />
                                        </div>

                                        {/* Device icon */}
                                        <span
                                            className="relative z-10 flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-text-secondary"
                                            style={{ backgroundColor: `${cohortColor(selectedCohortId)}12` }}
                                        >
                                            {session.deviceType === "mobile" ? "M" : session.deviceType === "tablet" ? "T" : "D"}
                                        </span>

                                        {/* Path info */}
                                        <div className="relative z-10 min-w-0 flex-1">
                                            <div className="flex items-center gap-1.5">
                                                <span className="ov-list-label truncate font-mono text-xs font-medium">{session.entryPath}</span>
                                                {session.entryPath !== session.exitPath && (
                                                    <>
                                                        <ArrowRight className="size-2.5 shrink-0 text-text-muted" />
                                                        <span className="truncate font-mono text-xs text-text-secondary">{session.exitPath}</span>
                                                    </>
                                                )}
                                            </div>
                                            <p className="mt-0.5 text-[10px] text-text-muted">
                                                {session.browser} / {session.os}
                                                <span className="mx-1">/</span>
                                                {session.pageCount} page{session.pageCount !== 1 ? "s" : ""}
                                                <span className="mx-1">/</span>
                                                {(session.durationMs / 1000).toFixed(0)}s
                                            </p>
                                        </div>

                                        {/* Indicators */}
                                        <div className="relative z-10 flex items-center gap-2 shrink-0">
                                            {session.rageClickCount > 0 && (
                                                <span className="text-[10px] font-medium text-status-error">
                                                    {session.rageClickCount} rage
                                                </span>
                                            )}
                                            {(session.errorCount > 0 || session.consoleErrorCount > 0) && (
                                                <span className="text-[10px] font-medium text-accent-amber">
                                                    {session.errorCount + session.consoleErrorCount} err
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Overflow notice */}
                        {filteredSessions.length > 50 && (
                            <p className="py-3 text-center text-[11px] text-text-muted">
                                Showing 50 of {filteredSessions.length} sessions
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
