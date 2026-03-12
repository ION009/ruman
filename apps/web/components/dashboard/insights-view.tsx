"use client";

import {
  AlertTriangle,
  ArrowUpDown,
  Info,
  RefreshCcw,
  Search,
  Siren,
  Sparkles,
} from "lucide-react";
import { useDeferredValue, useState } from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDashboardAIInsights } from "@/hooks/use-dashboard";
import type { InsightItem } from "@/lib/dashboard/types";
import { formatPercent } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Severity helpers                                                           */
/* -------------------------------------------------------------------------- */

const severityConfig: Record<
  InsightItem["severity"],
  { label: string; color: string; bg: string; icon: typeof Siren }
> = {
  critical: { label: "Critical", color: "text-status-error", bg: "bg-status-error/10", icon: Siren },
  warning: { label: "Warning", color: "text-accent-amber", bg: "bg-accent-amber/10", icon: AlertTriangle },
  info: { label: "Info", color: "text-accent-teal", bg: "bg-accent-teal/10", icon: Info },
};

const severityBarFill: Record<InsightItem["severity"], string> = {
  critical: "bg-status-error/[0.06]",
  warning: "bg-accent-amber/[0.06]",
  info: "bg-accent-teal/[0.06]",
};

/* -------------------------------------------------------------------------- */
/*  Inline severity span (replaces Badge)                                      */
/* -------------------------------------------------------------------------- */

function SeveritySpan({ severity }: { severity: InsightItem["severity"] }) {
  const cfg = severityConfig[severity];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
      <Icon className="size-3" />
      {cfg.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/*  Table columns (kept from original, Badge replaced with inline span)        */
/* -------------------------------------------------------------------------- */

const columns: ColumnDef<InsightItem>[] = [
  {
    accessorKey: "severity",
    header: "Severity",
    cell: ({ row }) => <SeveritySpan severity={row.original.severity} />,
  },
  {
    accessorKey: "category",
    header: "Category",
  },
  {
    accessorKey: "title",
    header: ({ column }) => (
      <button className="inline-flex items-center gap-2" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Title
        <ArrowUpDown className="size-4" />
      </button>
    ),
  },
  {
    accessorKey: "path",
    header: "Path",
  },
  {
    accessorKey: "score",
    header: ({ column }) => (
      <button className="inline-flex items-center gap-2" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
        Score
        <ArrowUpDown className="size-4" />
      </button>
    ),
  },
];

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function InsightsView() {
  const insightsQuery = useDashboardAIInsights();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sorting, setSorting] = useState<SortingState>([{ id: "score", desc: true }]);
  const data = insightsQuery.data;
  const insightItems = data?.items ?? [];

  const filteredItems = insightItems.filter((item) => {
    const target =
      `${item.severity} ${item.category} ${item.path} ${item.title} ${item.problem ?? ""} ${item.impact ?? ""} ${item.fix ?? ""} ${item.finding}`
        .toLowerCase();
    return target.includes(deferredSearch.toLowerCase());
  });

  const table = useReactTable({
    data: filteredItems,
    columns,
    state: {
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const leadItem = filteredItems[0];
  const averageScore = filteredItems.length
    ? Math.round(filteredItems.reduce((sum, item) => sum + item.score, 0) / filteredItems.length)
    : 0;
  const pagePressure = Object.entries(
    filteredItems.reduce<Record<string, number>>((accumulator, item) => {
      accumulator[item.path] = (accumulator[item.path] ?? 0) + 1;
      return accumulator;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const filteredSummary = {
    critical: filteredItems.filter((item) => item.severity === "critical").length,
    warning: filteredItems.filter((item) => item.severity === "warning").length,
    info: filteredItems.filter((item) => item.severity === "info").length,
  };

  const severityMix = [
    { label: "Critical", severity: "critical" as const, value: filteredSummary.critical, barColor: "bg-status-error" },
    { label: "Warning", severity: "warning" as const, value: filteredSummary.warning, barColor: "bg-accent-amber" },
    { label: "Info", severity: "info" as const, value: filteredSummary.info, barColor: "bg-accent-teal" },
  ];
  const engineMode = data?.engine?.mode === "ai_plus_rules" ? "AI + rules" : "Rules only";
  const audit = data?.audit;

  /* ----- Error state ----- */
  if (insightsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="ov-section-title text-[14px] font-semibold text-text-primary">AI Insight unavailable</h2>
        <p className="mt-2 text-sm text-status-error">{insightsQuery.error.message}</p>
      </div>
    );
  }

  /* ----- Loading state ----- */
  if (insightsQuery.isLoading && !data) {
    return <Skeleton className="h-[760px] rounded-2xl" />;
  }

  /* ----- No data state ----- */
  if (!data) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="ov-section-title text-[14px] font-semibold text-text-primary">AI Insight unavailable</h2>
        <p className="mt-2 text-sm text-text-secondary">The AI insight payload did not include any findings.</p>
      </div>
    );
  }

  /* ----- Empty state: teach the next step ----- */
  if (insightItems.length === 0 && data.summary.total === 0) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6 sm:p-8">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-accent-teal/10">
            <Sparkles className="size-6 text-accent-teal" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">No AI insights yet</h2>
          <p className="mt-2 text-sm text-text-secondary">
            AI insights are generated from anonymized aggregates once enough analytics data has been collected.
            Install the tracker, let traffic accumulate, then click <strong>Generate Insights</strong> to surface actionable findings.
          </p>
          <Button
            size="sm"
            className="mt-5 h-9"
            onClick={() => void insightsQuery.refetch()}
            disabled={insightsQuery.isFetching}
          >
            <RefreshCcw className={`mr-1.5 size-3.5 ${insightsQuery.isFetching ? "animate-spin" : ""}`} />
            Generate Insights
          </Button>
        </div>
      </div>
    );
  }

  /* ----- Main view ----- */
  return (
    <div className="space-y-5">
      {/* ── Header: search + action ── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input className="h-9 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter findings..." />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="h-9"
            onClick={() => void insightsQuery.refetch()}
            disabled={insightsQuery.isFetching}
          >
            <RefreshCcw className={`mr-1.5 size-3.5 ${insightsQuery.isFetching ? "animate-spin" : ""}`} />
            Generate Insights
          </Button>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="ov-kpi-strip section-frame grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 sm:grid-cols-5">
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{filteredItems.length}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Findings</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{averageScore}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Avg score</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-status-error">{filteredSummary.critical}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Critical</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-amber">{filteredSummary.warning}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Warning</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-teal">{filteredSummary.info}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Info</span>
        </div>
      </div>

      {/* ── Metadata row ── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-secondary">
        <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">{engineMode}</span>
        {audit?.zeroRetention && (
          <span className="rounded-md bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">zero retention</span>
        )}
      </div>

      {/* ── Lead finding + severity breakdown ── */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr),280px]">
        {leadItem ? (
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <SeveritySpan severity={leadItem.severity} />
              <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                score {leadItem.score}
              </span>
              <span className="text-[11px] text-text-secondary">{leadItem.category}</span>
              <span className="ml-auto text-[11px] font-mono text-text-muted">{leadItem.path}</span>
            </div>
            <h3 className="mt-3 text-base font-semibold tracking-tight text-text-primary">{leadItem.title}</h3>
            <p className="mt-2 text-sm text-text-secondary">{leadItem.problem ?? leadItem.finding}</p>

            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Impact</p>
                <p className="mt-1.5 text-sm text-text-primary">{leadItem.impact ?? leadItem.finding}</p>
              </div>
              <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Fix</p>
                <p className="mt-1.5 text-sm text-text-primary">{leadItem.fix ?? leadItem.recommendation}</p>
              </div>
            </div>
            {leadItem.evidence && (
              <p className="mt-3 text-[11px] text-text-muted">{leadItem.evidence}</p>
            )}
          </div>
        ) : (
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5 text-center text-sm text-text-secondary">
            No findings match that filter.
          </div>
        )}

        {/* Severity breakdown sidebar */}
        <div className="space-y-2">
          {severityMix.map((item) => {
            const share = filteredItems.length ? (item.value / filteredItems.length) * 100 : 0;
            return (
              <div key={item.label} className="section-frame rounded-2xl border border-border/50 p-3.5">
                <div className="mb-2 flex items-center justify-between">
                  <SeveritySpan severity={item.severity} />
                  <span className="text-sm font-semibold text-text-primary">{item.value}</span>
                </div>
                <div className="relative h-1.5 overflow-hidden rounded-full bg-surface-secondary">
                  <div className={`h-full rounded-full ${item.barColor}`} style={{ width: `${share}%` }} />
                </div>
                <p className="mt-2 text-[10px] text-text-muted">{formatPercent(share)} of queue</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Action board / table tabs ── */}
      <Tabs defaultValue="board">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="board">Action board</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>

        {/* --- Board view --- */}
        <TabsContent value="board" className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr),280px]">
            {/* Findings list */}
            <div className="ov-list space-y-2">
              {/* List header */}
              <div className="ov-list-header grid grid-cols-[minmax(0,1.2fr),80px,80px] gap-3 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                <span>Finding</span>
                <span className="text-right">Score</span>
                <span className="text-right">Severity</span>
              </div>

              {filteredItems.length ? (
                filteredItems.map((item) => {
                  const barWidth = averageScore > 0 ? Math.min(100, (item.score / (averageScore * 2)) * 100) : 50;
                  return (
                    <FindingRow key={`${item.path}-${item.title}`} item={item} barWidth={barWidth} />
                  );
                })
              ) : (
                <div className="rounded-xl px-3 py-6 text-center text-sm text-text-secondary">
                  No AI insights match that filter.
                </div>
              )}
            </div>

            {/* Pages under pressure sidebar */}
            <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5 h-fit">
              <h3 className="ov-section-title mb-3 text-[14px] font-semibold text-text-primary">Pages under pressure</h3>
              <div className="ov-list space-y-1.5">
                {pagePressure.length ? (
                  pagePressure.map(([path, count]) => {
                    const share = filteredItems.length ? (count / filteredItems.length) * 100 : 0;
                    return (
                      <div key={path} className="ov-list-row relative flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-surface-secondary/60">
                        <div className="ov-list-bar-bg absolute inset-0 overflow-hidden rounded-lg">
                          <div className="ov-list-bar-fill h-full bg-accent-teal/[0.06]" style={{ width: `${share}%` }} />
                        </div>
                        <span className="ov-list-label relative z-10 truncate text-sm font-medium text-text-primary">{path}</span>
                        <span className="ov-list-value relative z-10 shrink-0 text-sm tabular-nums text-text-secondary">{count}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="py-3 text-center text-sm text-text-secondary">No page pressure data yet. Generate insights to see which pages need attention.</p>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* --- Table view --- */}
        <TabsContent value="table">
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="ov-section-title mb-3 text-[14px] font-semibold text-text-primary">AI insight table</h3>
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <TableHead key={header.id}>
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((row) => (
                    <TableRow key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={columns.length} className="h-24 text-center text-text-secondary">
                      No AI insights match that filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  FindingRow — expandable row for board view (replaces Card-based cards)     */
/* -------------------------------------------------------------------------- */

function FindingRow({ item, barWidth }: { item: InsightItem; barWidth: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg">
      <div
        className="ov-list-row relative grid cursor-pointer grid-cols-[minmax(0,1.2fr),80px,80px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-surface-secondary/60"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Bar background */}
        <div className="ov-list-bar-bg absolute inset-0 overflow-hidden rounded-lg">
          <div className={`ov-list-bar-fill h-full ${severityBarFill[item.severity]}`} style={{ width: `${barWidth}%` }} />
        </div>

        {/* Title + path */}
        <div className="relative z-10 min-w-0">
          <p className="ov-list-label truncate text-sm font-medium text-text-primary">{item.title}</p>
          <div className="mt-0.5 flex items-center gap-1.5">
            <span className="truncate text-[11px] font-mono text-text-muted">{item.path}</span>
            {item.category && (
              <span className="text-[10px] text-text-muted">{item.category}</span>
            )}
          </div>
        </div>

        {/* Score */}
        <span className="ov-list-value relative z-10 text-right text-sm font-semibold tabular-nums text-text-primary">{item.score}</span>

        {/* Severity */}
        <span className="relative z-10 text-right">
          <SeveritySpan severity={item.severity} />
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="mx-3 mb-2 mt-1 space-y-3 rounded-xl border border-border/40 bg-surface-secondary/30 p-4">
          {item.problem && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Problem</p>
              <p className="mt-1 text-sm text-text-secondary">{item.problem}</p>
            </div>
          )}
          {item.impact && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Impact</p>
              <p className="mt-1 text-sm text-text-primary">{item.impact}</p>
            </div>
          )}
          {item.fix && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Recommendation</p>
              <p className="mt-1 text-sm text-text-secondary">{item.fix}</p>
            </div>
          )}
          {item.evidence && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Evidence</p>
              <p className="mt-1 text-[11px] text-text-muted">{item.evidence}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
