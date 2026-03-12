"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Mail, Pause, Plus, Save, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useDashboardReports } from "@/hooks/use-dashboard";
import {
  createDashboardReport,
  dashboardKeys,
  deleteDashboardReport,
  updateDashboardReport,
} from "@/lib/dashboard/client";
import type { DashboardReportConfigInput, DashboardReportSection } from "@/lib/dashboard/types";
import { formatCompact, timeAgo } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

const SECTION_OPTIONS: DashboardReportSection[] = [
  "overview",
  "realtime",
  "goals",
  "replays",
  "heatmaps",
  "insights",
  "errors",
];

const EMPTY_REPORT: DashboardReportConfigInput = {
  name: "",
  frequency: "weekly",
  deliveryTime: "08:00",
  timezone: "UTC",
  recipients: [],
  includeSections: ["overview", "goals", "insights"],
  compareEnabled: true,
  enabled: true,
  note: "",
};

function parseRecipients(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function recipientsToField(value: string[]) {
  return value.join("\n");
}

/* ---------- status helpers ---------- */

function statusLabel(enabled: boolean) {
  return enabled ? "Scheduled" : "Paused";
}

function statusColor(enabled: boolean) {
  return enabled
    ? "bg-accent-teal/10 text-accent-teal"
    : "bg-accent-amber/10 text-accent-amber";
}

/* ---------- component ---------- */

export function ReportsView() {
  const queryClient = useQueryClient();
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const reportsQuery = useDashboardReports();
  const [selectedReportId, setSelectedReportId] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draft, setDraft] = useState<DashboardReportConfigInput>(EMPTY_REPORT);
  const [recipientsField, setRecipientsField] = useState("");

  const reports = reportsQuery.data ?? [];
  const selectedReport = reports.find((report) => report.id === selectedReportId) ?? null;

  useEffect(() => {
    if (selectedReport) {
      setIsCreating(false);
      setDraft({
        name: selectedReport.name,
        frequency: selectedReport.frequency,
        deliveryTime: selectedReport.deliveryTime,
        timezone: selectedReport.timezone,
        recipients: selectedReport.recipients,
        includeSections: selectedReport.includeSections,
        compareEnabled: selectedReport.compareEnabled,
        enabled: selectedReport.enabled,
        note: selectedReport.note ?? "",
      });
      setRecipientsField(recipientsToField(selectedReport.recipients));
      return;
    }

    if (!selectedReportId && !isCreating && reports[0]) {
      setSelectedReportId(reports[0].id);
    }
  }, [isCreating, reports, selectedReport, selectedReportId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: DashboardReportConfigInput = {
        ...draft,
        recipients: parseRecipients(recipientsField),
      };
      if (selectedReport) {
        return updateDashboardReport(selectedSiteId, selectedReport.id, payload);
      }
      return createDashboardReport(selectedSiteId, payload);
    },
    onSuccess: async (report) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.reports(selectedSiteId) });
      setIsCreating(false);
      setSelectedReportId(report.id);
      setSheetOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedReport) {
        throw new Error("Choose a report first.");
      }
      await deleteDashboardReport(selectedSiteId, selectedReport.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.reports(selectedSiteId) });
      setIsCreating(false);
      setSelectedReportId("");
      setDraft(EMPTY_REPORT);
      setRecipientsField("");
      setSheetOpen(false);
    },
  });

  /* ---------- open helpers ---------- */

  function openCreate() {
    setIsCreating(true);
    setSelectedReportId("");
    setDraft({ ...EMPTY_REPORT });
    setRecipientsField("");
    setSheetOpen(true);
  }

  function openEdit(reportId: string) {
    setIsCreating(false);
    setSelectedReportId(reportId);
    setSheetOpen(true);
  }

  /* ---------- loading / error ---------- */

  if (reportsQuery.isLoading && !reports.length) {
    return <Skeleton className="h-[860px] rounded-2xl" />;
  }

  if (reportsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-text-primary">Reports unavailable</p>
        <p className="mt-1 text-xs text-text-secondary">{reportsQuery.error.message}</p>
      </div>
    );
  }

  /* ---------- derived metrics ---------- */

  const scheduledCount = reports.filter((report) => report.enabled).length;
  const pausedCount = reports.length - scheduledCount;
  const recipientCount = reports.reduce((sum, report) => sum + report.recipients.length, 0);
  const sectionCoverage = new Set(reports.flatMap((report) => report.includeSections)).size;

  /* ---------- render ---------- */

  return (
    <div className="space-y-5">
      {/* ---- page header ---- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-text-muted">
            Report Scheduling
          </p>
          <h2 className="mt-1 text-lg font-semibold text-text-primary">Reports</h2>
          <p className="mt-0.5 max-w-xl text-sm text-text-secondary">
            Define recurring email reports and manage distribution settings.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="size-3.5" />
          New report
        </Button>
      </div>

      {/* ---- KPI strip ---- */}
      <div className="ov-kpi-strip grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 bg-border/40 sm:grid-cols-4">
        <div className="ov-kpi-cell flex items-center gap-3 bg-surface-primary px-4 py-3">
          <CalendarClock className="size-4 shrink-0 text-accent-teal" />
          <div>
            <p className="ov-kpi-number text-base font-semibold text-text-primary">
              {formatCompact(scheduledCount)}
            </p>
            <p className="ov-kpi-label text-[11px] text-text-secondary">Scheduled</p>
          </div>
        </div>
        <div className="ov-kpi-cell flex items-center gap-3 bg-surface-primary px-4 py-3">
          <Pause className="size-4 shrink-0 text-accent-amber" />
          <div>
            <p className="ov-kpi-number text-base font-semibold text-text-primary">
              {formatCompact(pausedCount)}
            </p>
            <p className="ov-kpi-label text-[11px] text-text-secondary">Paused</p>
          </div>
        </div>
        <div className="ov-kpi-cell flex items-center gap-3 bg-surface-primary px-4 py-3">
          <Users className="size-4 shrink-0 text-text-secondary" />
          <div>
            <p className="ov-kpi-number text-base font-semibold text-text-primary">
              {formatCompact(recipientCount)}
            </p>
            <p className="ov-kpi-label text-[11px] text-text-secondary">Recipients</p>
          </div>
        </div>
        <div className="ov-kpi-cell flex items-center gap-3 bg-surface-primary px-4 py-3">
          <Mail className="size-4 shrink-0 text-text-secondary" />
          <div>
            <p className="ov-kpi-number text-base font-semibold text-text-primary">
              {formatCompact(sectionCoverage)}
            </p>
            <p className="ov-kpi-label text-[11px] text-text-secondary">Section coverage</p>
          </div>
        </div>
      </div>

      {/* ---- saved schedules list ---- */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-text-primary">Saved schedules</p>
          <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            {reports.length} {reports.length === 1 ? "config" : "configs"}
          </span>
        </div>

        {reports.length === 0 ? (
          <div className="mt-4 rounded-xl border border-border/40 bg-white/60 px-4 py-6 text-center">
            <p className="text-sm font-medium text-text-primary">No scheduled reports yet</p>
            <p className="mt-1 text-xs text-text-muted">
              Create the first schedule to lock the report surface before delivery is connected.
            </p>
          </div>
        ) : (
          <div className="ov-list mt-3 space-y-1">
            {reports.map((report) => (
              <button
                key={report.id}
                type="button"
                onClick={() => openEdit(report.id)}
                className="ov-list-row group flex w-full items-start justify-between gap-4 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface-secondary/70"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {report.name}
                    </p>
                    <span
                      className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusColor(report.enabled)}`}
                    >
                      {statusLabel(report.enabled)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {report.frequency} at {report.deliveryTime} {report.timezone}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {report.includeSections.map((section) => (
                      <span
                        key={section}
                        className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                      >
                        {section}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs tabular-nums text-text-secondary">
                    {report.recipients.length} {report.recipients.length === 1 ? "recipient" : "recipients"}
                  </p>
                  <p className="mt-0.5 text-[10px] text-text-muted">
                    Updated {timeAgo(report.updatedAt)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ---- delivery health placeholder ---- */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <p className="text-sm font-semibold text-text-primary">Delivery health</p>
        <p className="mt-1 text-xs text-text-muted">
          Delivery execution and health monitoring will appear here once the backend wiring is connected.
        </p>
      </div>

      {/* ---- create / edit sheet ---- */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>
              {selectedReport && !isCreating ? "Edit schedule" : "Create schedule"}
            </SheetTitle>
            <SheetDescription>
              Recipients, cadence, sections, and compare settings.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-2 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="report-name">Report name</Label>
              <Input
                id="report-name"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Weekly launch pulse"
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="report-frequency">Frequency</Label>
                <Select
                  value={draft.frequency}
                  onValueChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      frequency:
                        value === "daily" || value === "monthly" ? value : "weekly",
                    }))
                  }
                >
                  <SelectTrigger id="report-frequency">
                    <SelectValue placeholder="Select cadence" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="report-time">Delivery time</Label>
                <Input
                  id="report-time"
                  type="time"
                  value={draft.deliveryTime}
                  onChange={(event) => setDraft((current) => ({ ...current, deliveryTime: event.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-timezone">Timezone</Label>
              <Input
                id="report-timezone"
                value={draft.timezone}
                onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))}
                placeholder="America/Los_Angeles"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-recipients">Recipients</Label>
              <Textarea
                id="report-recipients"
                value={recipientsField}
                onChange={(event) => setRecipientsField(event.target.value)}
                className="min-h-24"
                placeholder={"ops@company.com\nfounder@company.com"}
              />
            </div>

            <div className="space-y-2">
              <Label>Included sections</Label>
              <div className="flex flex-wrap gap-1.5">
                {SECTION_OPTIONS.map((section) => {
                  const active = draft.includeSections.includes(section);
                  return (
                    <button
                      key={section}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          includeSections: active
                            ? current.includeSections.filter((entry) => entry !== section)
                            : [...current.includeSections, section],
                        }))
                      }
                      className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                        active
                          ? "bg-foreground text-white"
                          : "bg-surface-secondary text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      {section}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="report-note">Operator note</Label>
              <Textarea
                id="report-note"
                value={draft.note ?? ""}
                onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))}
                className="min-h-20"
                placeholder="Send this to the launch room after Monday traffic settles."
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={draft.compareEnabled ?? true}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, compareEnabled: event.target.checked }))
                  }
                />
                Include compare mode
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={draft.enabled ?? true}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, enabled: event.target.checked }))
                  }
                />
                Schedule this report
              </label>
            </div>

            {saveMutation.error ? (
              <p className="text-sm text-destructive">{saveMutation.error.message}</p>
            ) : null}
            {deleteMutation.error ? (
              <p className="text-sm text-destructive">{deleteMutation.error.message}</p>
            ) : null}
          </div>

          <SheetFooter className="mt-6">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                <Save className="size-3.5" />
                {selectedReport && !isCreating ? "Save schedule" : "Create schedule"}
              </Button>
              {selectedReport && !isCreating ? (
                <Button
                  variant="outline"
                  onClick={() => deleteMutation.mutate()}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              ) : null}
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
