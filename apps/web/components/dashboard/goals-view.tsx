"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Goal,
  Pencil,
  Plus,
  Save,
  Target,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardGoalReport, useDashboardGoals } from "@/hooks/use-dashboard";
import {
  createDashboardGoal,
  dashboardKeys,
  deleteDashboardGoal,
  updateDashboardGoal,
} from "@/lib/dashboard/client";
import type { GoalDefinitionInput, RangeKey } from "@/lib/dashboard/types";
import { cn, formatCompact, formatPercent } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EMPTY_GOAL: GoalDefinitionInput = {
  name: "",
  type: "pageview",
  match: "exact",
  value: "",
  currency: "",
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function miniSparkline(data: number[], color: string) {
  if (!data.length) return null;
  const max = Math.max(...data, 1);
  const w = 80;
  const h = 24;
  const points = data
    .map((v, i) => `${(i / Math.max(data.length - 1, 1)) * w},${h - (v / max) * h}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/*  Goal Form Sheet (modal)                                            */
/* ------------------------------------------------------------------ */

function GoalFormSheet({
  open,
  onOpenChange,
  editingGoal,
  siteId,
  range,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingGoal: { id: string; name: string; type: string; match: string; value: string; currency?: string | null } | null;
  siteId: string;
  range: RangeKey;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<GoalDefinitionInput>(EMPTY_GOAL);

  useEffect(() => {
    if (open && editingGoal) {
      setDraft({
        name: editingGoal.name,
        type: editingGoal.type as "pageview" | "event",
        match: editingGoal.match as "exact" | "prefix" | "contains",
        value: editingGoal.value,
        currency: editingGoal.currency ?? "",
      });
    } else if (open) {
      setDraft({ ...EMPTY_GOAL });
    }
  }, [open, editingGoal]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingGoal) {
        return updateDashboardGoal(siteId, editingGoal.id, draft);
      }
      return createDashboardGoal(siteId, draft);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardKeys.goals(siteId) }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.goalReport(siteId, range) }),
      ]);
      onOpenChange(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editingGoal) throw new Error("No goal selected.");
      await deleteDashboardGoal(siteId, editingGoal.id);
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: dashboardKeys.goals(siteId) }),
        queryClient.invalidateQueries({ queryKey: dashboardKeys.goalReport(siteId, range) }),
      ]);
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editingGoal ? "Edit Goal" : "New Goal"}</SheetTitle>
          <SheetDescription>
            {editingGoal
              ? "Update the goal configuration below."
              : "Define a new conversion goal for your site."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Goal name</Label>
            <Input
              id="goal-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Newsletter signup"
            />
          </div>

          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goal-type">Type</Label>
              <Select
                value={draft.type}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    type: v === "event" ? "event" : "pageview",
                  }))
                }
              >
                <SelectTrigger id="goal-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pageview">Pageview</SelectItem>
                  <SelectItem value="event">Event</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="goal-match">Match</Label>
              <Select
                value={draft.match}
                onValueChange={(v) =>
                  setDraft((d) => ({
                    ...d,
                    match: v === "prefix" || v === "contains" ? v : "exact",
                  }))
                }
              >
                <SelectTrigger id="goal-match">
                  <SelectValue placeholder="Select match" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="exact">Exact</SelectItem>
                  <SelectItem value="prefix">Prefix</SelectItem>
                  <SelectItem value="contains">Contains</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-value">
              {draft.type === "event" ? "Event name" : "Path or URL pattern"}
            </Label>
            <Input
              id="goal-value"
              value={draft.value}
              onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
              placeholder={draft.type === "event" ? "signup_completed" : "/pricing"}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="goal-currency">Currency (optional)</Label>
            <Input
              id="goal-currency"
              value={draft.currency ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, currency: e.target.value }))}
              placeholder="USD"
            />
          </div>

          {saveMutation.error && (
            <p className="text-[13px] text-status-error">{saveMutation.error.message}</p>
          )}
          {deleteMutation.error && (
            <p className="text-[13px] text-status-error">{deleteMutation.error.message}</p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !draft.name.trim()}
              className="gap-1.5"
            >
              <Save className="size-3.5" />
              {editingGoal ? "Save" : "Create"}
            </Button>
            {editingGoal && (
              <Button
                variant="outline"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="gap-1.5 text-status-error hover:bg-status-error-bg hover:text-status-error"
              >
                <Trash2 className="size-3.5" />
                Delete
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Goal Card                                                          */
/* ------------------------------------------------------------------ */

function GoalCard({
  goal,
  onEdit,
}: {
  goal: {
    id: string;
    name: string;
    type: string;
    match: string;
    value: string;
    currency?: string | null;
    conversions: number;
    conversionRate: number;
    sparkline?: number[];
  };
  onEdit: () => void;
}) {
  return (
    <div className="section-frame rounded-2xl border border-border/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-text-primary">{goal.name}</p>
          <p className="mt-0.5 text-[12px] text-text-secondary">
            {goal.type} · {goal.match} · <span className="font-mono text-[11px]">{goal.value}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[11px] font-medium text-text-secondary">Conversions</p>
            <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-text-primary">
              {formatCompact(goal.conversions)}
            </p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-text-secondary">CVR</p>
            <p className="mt-0.5 text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-accent-teal">
              {formatPercent(goal.conversionRate, 1)}
            </p>
          </div>
          {goal.currency && (
            <div>
              <p className="text-[11px] font-medium text-text-secondary">Currency</p>
              <p className="mt-0.5 text-[14px] font-semibold text-text-primary">{goal.currency}</p>
            </div>
          )}
        </div>
        {goal.sparkline && miniSparkline(goal.sparkline, "#0D9488")}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main GoalsView                                                     */
/* ------------------------------------------------------------------ */

export function GoalsView() {
  const queryClient = useQueryClient();
  const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
  const selectedRange = useDashboardStore((s) => s.selectedRange);
  const goalsQuery = useDashboardGoals();
  const goalReportQuery = useDashboardGoalReport();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<{
    id: string;
    name: string;
    type: string;
    match: string;
    value: string;
    currency?: string | null;
  } | null>(null);

  const goals = goalReportQuery.data?.goals ?? (goalsQuery.data ?? []).map((goal) => ({
    ...goal,
    conversions: 0,
    conversionRate: 0,
  }));

  if (goalsQuery.isLoading && goalReportQuery.isLoading && !goals.length) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[100px] rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
          <Skeleton className="h-[140px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (goalsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-status-error">Goals unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{goalsQuery.error.message}</p>
      </div>
    );
  }

  const totalConversions = goals.reduce((s, g) => s + g.conversions, 0);
  const averageRate = goals.length
    ? goals.reduce((s, g) => s + g.conversionRate, 0) / goals.length
    : 0;
  const topGoal = [...goals].sort((a, b) => b.conversions - a.conversions)[0];

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Tracked Goals</p>
          <p className="ov-kpi-number">{goals.length}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Total Conversions</p>
          <p className="ov-kpi-number">{formatCompact(totalConversions)}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Average CVR</p>
          <p className="ov-kpi-number">{formatPercent(averageRate, 1)}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Top Goal</p>
          <p className="mt-1 truncate text-[14px] font-semibold text-text-primary">
            {topGoal ? topGoal.name : "—"}
          </p>
          {topGoal && (
            <p className="text-[11px] tabular-nums text-text-secondary">
              {formatCompact(topGoal.conversions)} conversions
            </p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-secondary">
          {goals.length} goal{goals.length !== 1 ? "s" : ""} configured for {selectedRange.toUpperCase()}
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditingGoal(null);
            setSheetOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          New Goal
        </Button>
      </div>

      {/* Goal Cards Grid */}
      {goals.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {goals.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              onEdit={() => {
                setEditingGoal({
                  id: goal.id,
                  name: goal.name,
                  type: goal.type,
                  match: goal.match,
                  value: goal.value,
                  currency: goal.currency,
                });
                setSheetOpen(true);
              }}
            />
          ))}
        </div>
      ) : (
        <div className="section-frame flex flex-col items-center justify-center rounded-2xl border border-border/50 py-16 text-center">
          <Target className="size-10 text-text-muted" />
          <h3 className="mt-4 text-[15px] font-semibold text-text-primary">No goals defined yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
            Create pageview or event goals to start tracking conversions. Conversion counts populate as analytics events match your configured goals.
          </p>
          <Button
            size="sm"
            className="mt-4 gap-1.5"
            onClick={() => {
              setEditingGoal(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Create your first goal
          </Button>
        </div>
      )}

      {/* Goal Form Sheet (modal) */}
      <GoalFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editingGoal={editingGoal}
        siteId={selectedSiteId}
        range={selectedRange}
      />
    </div>
  );
}
