"use client";

import {
    AlertTriangle,
    BarChart3,
    Info,
    ScanSearch,
    Siren,
    Sparkles,
    TrendingDown,
    TrendingUp,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useDashboardAIInsights, useDashboardSummary } from "@/hooks/use-dashboard";
import type { InsightItem, OverviewMetrics } from "@/lib/dashboard/types";
import { cn, formatCompact, formatPercent } from "@/lib/utils";

const severityConfig: Record<string, { label: string; color: string; bg: string; icon: typeof Siren }> = {
    critical: { label: "Critical", color: "text-red-600", bg: "bg-red-50", icon: Siren },
    warning: { label: "Warning", color: "text-amber-600", bg: "bg-amber-50", icon: AlertTriangle },
    info: { label: "Info", color: "text-blue-600", bg: "bg-blue-50", icon: Info },
};

function MetricDelta({ current, label }: { current: number; label: string }) {
    return (
        <div className="section-frame rounded-xl p-3 text-center">
            <p className="text-lg font-semibold tracking-tight">{formatCompact(current)}</p>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
        </div>
    );
}

function AnomalyCard({ item }: { item: InsightItem }) {
    const [expanded, setExpanded] = useState(false);
    const config = severityConfig[item.severity] ?? severityConfig.info;
    const Icon = config.icon;

    return (
        <div
            className="section-frame rounded-xl p-4 transition-shadow hover:shadow-md cursor-pointer"
            onClick={() => setExpanded(!expanded)}
        >
            <div className="flex items-start gap-3">
                <div className={cn("mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg", config.bg)}>
                    <Icon className={cn("size-3.5", config.color)} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={cn("px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase", config.bg, config.color)}>
                            {config.label}
                        </span>
                        {item.category && (
                            <span className="text-[10px] text-muted-foreground">{item.category}</span>
                        )}
                        {item.source === "ai" && (
                            <span className="flex items-center gap-0.5 text-[9px] text-primary font-medium">
                                <Sparkles className="size-2.5" />
                                AI
                            </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground font-medium">
                            Score: {item.score}
                        </span>
                    </div>
                    <p className="text-sm font-medium">{item.title || item.finding}</p>
                    {item.path && item.path !== "/" && (
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">{item.path}</p>
                    )}

                    {expanded && (
                        <div className="mt-3 space-y-2 text-xs text-muted-foreground border-t border-border/30 pt-3">
                            {item.problem && (
                                <div>
                                    <span className="font-semibold text-foreground">Problem:</span> {item.problem}
                                </div>
                            )}
                            {item.impact && (
                                <div>
                                    <span className="font-semibold text-foreground">Impact:</span> {item.impact}
                                </div>
                            )}
                            {item.fix && (
                                <div>
                                    <span className="font-semibold text-foreground">Recommendation:</span> {item.fix}
                                </div>
                            )}
                            {item.evidence && (
                                <div>
                                    <span className="font-semibold text-foreground">Evidence:</span> {item.evidence}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export function AIAnalysisView() {
    const insightsQuery = useDashboardAIInsights();
    const summaryQuery = useDashboardSummary();
    const [severityFilter, setSeverityFilter] = useState<string>("all");

    if (insightsQuery.isLoading || summaryQuery.isLoading) {
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
                <Skeleton className="h-40 rounded-xl" />
            </div>
        );
    }

    const insights = insightsQuery.data;
    const summary = summaryQuery.data;
    const overview = summary?.overview;

    if (!insights) {
        return (
            <div className="section-frame rounded-2xl p-8 text-center">
                <ScanSearch className="mx-auto size-7 text-muted-foreground/40" />
                <h3 className="mt-3 text-sm font-semibold">No analysis data</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                    Select a site and wait for data to accumulate before running analysis.
                </p>
            </div>
        );
    }

    const allItems = insights.items ?? [];
    const filteredItems = severityFilter === "all"
        ? allItems
        : allItems.filter((i) => i.severity === severityFilter);

    const engineMode = insights.engine?.mode === "ai_plus_rules" ? "AI + Rules" : "Rules Only";

    return (
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10">
                        <ScanSearch className="size-4 text-primary" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold">AI Analysis & Anomalies</h2>
                        <p className="text-[11px] text-muted-foreground">
                            {allItems.length} finding{allItems.length !== 1 ? "s" : ""} · Engine: {engineMode}
                        </p>
                    </div>
                </div>
            </div>

            {/* Overview KPIs */}
            {overview && (
                <div className="grid gap-3 sm:grid-cols-4">
                    <MetricDelta current={overview.uniqueVisitors} label="Unique Visitors" />
                    <MetricDelta current={overview.pageviews} label="Pageviews" />
                    <MetricDelta current={overview.bounceRate} label="Bounce Rate %" />
                    <MetricDelta current={overview.rageClicks} label="Rage Clicks" />
                </div>
            )}

            {/* Severity summary bar */}
            <div className="section-frame rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold">Severity Breakdown</p>
                    <Select value={severityFilter} onValueChange={setSeverityFilter}>
                        <SelectTrigger className="h-7 w-[100px] rounded-lg text-[11px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All</SelectItem>
                            <SelectItem value="critical">Critical</SelectItem>
                            <SelectItem value="warning">Warning</SelectItem>
                            <SelectItem value="info">Info</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                        <div className="size-2.5 rounded-full bg-red-500" />
                        <span className="text-xs">{insights.summary.critical} Critical</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="size-2.5 rounded-full bg-amber-500" />
                        <span className="text-xs">{insights.summary.warning} Warning</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <div className="size-2.5 rounded-full bg-blue-500" />
                        <span className="text-xs">{insights.summary.info} Info</span>
                    </div>
                    <div className="ml-auto text-[10px] text-muted-foreground">
                        Generated {insights.generatedAt ? new Date(insights.generatedAt).toLocaleTimeString() : "—"}
                    </div>
                </div>

                {/* Severity bar */}
                {insights.summary.total > 0 && (
                    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted/30">
                        {insights.summary.critical > 0 && (
                            <div
                                className="bg-red-500"
                                style={{ width: `${(insights.summary.critical / insights.summary.total) * 100}%` }}
                            />
                        )}
                        {insights.summary.warning > 0 && (
                            <div
                                className="bg-amber-500"
                                style={{ width: `${(insights.summary.warning / insights.summary.total) * 100}%` }}
                            />
                        )}
                        {insights.summary.info > 0 && (
                            <div
                                className="bg-blue-500"
                                style={{ width: `${(insights.summary.info / insights.summary.total) * 100}%` }}
                            />
                        )}
                    </div>
                )}
            </div>

            {/* Items list */}
            {filteredItems.length === 0 ? (
                <div className="section-frame rounded-xl p-6 text-center">
                    <p className="text-xs text-muted-foreground">No findings match the selected filter.</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {filteredItems.map((item, i) => (
                        <AnomalyCard key={`${item.path}-${item.category}-${i}`} item={item} />
                    ))}
                </div>
            )}

            {/* Audit info */}
            {insights.audit && (
                <div className="section-frame rounded-xl p-4">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audit Trail</p>
                    <div className="grid gap-2 sm:grid-cols-3 text-[11px] text-muted-foreground">
                        <div>Provider: <span className="text-foreground font-medium">{insights.audit.provider}</span></div>
                        <div>Model: <span className="text-foreground font-medium">{insights.audit.model || "N/A"}</span></div>
                        <div>Duration: <span className="text-foreground font-medium">{insights.audit.durationMs ? `${insights.audit.durationMs}ms` : "N/A"}</span></div>
                    </div>
                    {insights.audit.fieldsExcluded && insights.audit.fieldsExcluded.length > 0 && (
                        <p className="mt-2 text-[10px] text-muted-foreground/70">
                            Privacy: Fields excluded from AI — {insights.audit.fieldsExcluded.join(", ")}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
