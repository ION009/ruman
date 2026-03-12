"use client";

import {
  Bell,
  Edit2,
  Loader2,
  Mail,
  Plus,
  Power,
  Save,
  Trash2,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

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
import { useDashboardAlerts } from "@/hooks/use-dashboard";
import {
  createDashboardAlert,
  updateDashboardAlert,
  deleteDashboardAlert,
  dashboardKeys,
} from "@/lib/dashboard/client";
import type {
  AlertCondition,
  AlertMetric,
  AlertPeriod,
  DashboardAlert,
  DashboardAlertInput,
} from "@/lib/dashboard/types";
import { useDashboardStore } from "@/stores/dashboard-store";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Metric display helpers                                             */
/* ------------------------------------------------------------------ */

const metricLabels: Record<AlertMetric, string> = {
  pageviews: "Pageviews",
  visitors: "Visitors",
  bounce_rate: "Bounce Rate",
  rage_clicks: "Rage Clicks",
};
const conditionLabels: Record<AlertCondition, string> = {
  above: "goes above",
  below: "drops below",
};
const periodLabels: Record<AlertPeriod, string> = {
  "1h": "per hour",
  "24h": "per day",
};

const EMPTY_DRAFT: DashboardAlertInput = {
  name: "",
  metric: "pageviews",
  condition: "above",
  threshold: 100,
  period: "24h",
  webhookUrl: "",
  enabled: true,
};

/* ------------------------------------------------------------------ */
/*  Alert Form Sheet (modal)                                           */
/* ------------------------------------------------------------------ */

function AlertFormSheet({
  open,
  onOpenChange,
  editingAlert,
  siteId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingAlert: DashboardAlert | null;
  siteId: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<DashboardAlertInput>({ ...EMPTY_DRAFT });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && editingAlert) {
      setDraft({
        name: editingAlert.name,
        metric: editingAlert.metric,
        condition: editingAlert.condition,
        threshold: editingAlert.threshold,
        period: editingAlert.period,
        webhookUrl: editingAlert.webhookUrl,
        enabled: editingAlert.enabled,
      });
    } else if (open) {
      setDraft({ ...EMPTY_DRAFT });
    }
    setError(null);
  }, [open, editingAlert]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (editingAlert) {
        await updateDashboardAlert(siteId, editingAlert.id, draft);
      } else {
        await createDashboardAlert(siteId, draft);
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save alert");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editingAlert) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteDashboardAlert(siteId, editingAlert.id);
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete alert");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{editingAlert ? "Edit Alert" : "New Alert"}</SheetTitle>
          <SheetDescription>
            {editingAlert
              ? "Update the alert configuration below."
              : "Configure a new metric alert with a delivery webhook."}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Alert name</Label>
            <Input
              id="alert-name"
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="e.g. Traffic spike"
            />
          </div>

          {/* Metric + Condition */}
          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="alert-metric">Metric</Label>
              <Select
                value={draft.metric}
                onValueChange={(v) => setDraft((d) => ({ ...d, metric: v as AlertMetric }))}
              >
                <SelectTrigger id="alert-metric">
                  <SelectValue placeholder="Select metric" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(metricLabels) as AlertMetric[]).map((m) => (
                    <SelectItem key={m} value={m}>{metricLabels[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alert-condition">Condition</Label>
              <Select
                value={draft.condition}
                onValueChange={(v) => setDraft((d) => ({ ...d, condition: v as AlertCondition }))}
              >
                <SelectTrigger id="alert-condition">
                  <SelectValue placeholder="Select condition" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="above">Goes above</SelectItem>
                  <SelectItem value="below">Drops below</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Threshold + Period */}
          <div className="grid gap-4 grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="alert-threshold">Threshold</Label>
              <Input
                id="alert-threshold"
                type="number"
                value={String(draft.threshold)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, threshold: Number(e.target.value) }))
                }
                placeholder="100"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="alert-period">Period</Label>
              <Select
                value={draft.period}
                onValueChange={(v) => setDraft((d) => ({ ...d, period: v as AlertPeriod }))}
              >
                <SelectTrigger id="alert-period">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1h">Per hour</SelectItem>
                  <SelectItem value="24h">Per day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Webhook URL */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-webhook">Webhook URL</Label>
            <Input
              id="alert-webhook"
              value={draft.webhookUrl}
              onChange={(e) => setDraft((d) => ({ ...d, webhookUrl: e.target.value }))}
              placeholder="https://hooks.slack.com/services/..."
            />
            <p className="text-[11px] text-text-muted">
              Supports Slack, Discord, or any endpoint that accepts POST JSON payloads.
            </p>
          </div>

          {/* Channel hints */}
          <div className="section-frame rounded-2xl border border-border/50 p-3">
            <p className="text-[11px] font-medium text-text-secondary mb-2">Delivery channels</p>
            <div className="flex flex-wrap gap-3">
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-primary">
                <Webhook className="size-3.5 text-accent-teal" />
                Webhook
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <Mail className="size-3.5" />
                Email
                <span className="text-[10px] text-text-muted">(coming soon)</span>
              </span>
              <span className="inline-flex items-center gap-1.5 text-[12px] text-text-muted">
                <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
                Slack
                <span className="text-[10px] text-text-muted">(coming soon)</span>
              </span>
            </div>
          </div>

          {/* Errors */}
          {error && (
            <p className="text-[13px] text-status-error">{error}</p>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || !draft.name.trim() || !draft.webhookUrl.trim()}
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Save className="size-3.5" />
              )}
              {editingAlert ? "Save Changes" : "Create Alert"}
            </Button>
            {editingAlert && (
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={deleting}
                className="gap-1.5 text-status-error hover:bg-status-error-bg hover:text-status-error"
              >
                {deleting ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Trash2 className="size-3.5" />
                )}
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
/*  Alert Row                                                          */
/* ------------------------------------------------------------------ */

function AlertRow({
  alert,
  onEdit,
  onToggle,
}: {
  alert: DashboardAlert;
  onEdit: () => void;
  onToggle: () => void;
}) {
  return (
    <div className="ov-list-row">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-lg",
            alert.enabled ? "bg-accent-teal/10" : "bg-surface-secondary"
          )}
        >
          <Webhook
            className={cn(
              "size-3.5",
              alert.enabled ? "text-accent-teal" : "text-text-muted"
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-[13px] font-semibold text-text-primary", !alert.enabled && "text-text-muted")}>
            {alert.name}
          </p>
          <p className="text-[11px] text-text-secondary">
            {metricLabels[alert.metric]}{" "}
            {conditionLabels[alert.condition]}{" "}
            <span className="font-semibold text-text-primary">{alert.threshold}</span>{" "}
            {periodLabels[alert.period]}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {alert.lastFiredAt && (
          <span className="text-[11px] text-text-muted hidden sm:block">
            Fired {new Date(alert.lastFiredAt).toLocaleDateString()}
          </span>
        )}
        <span
          className={cn(
            "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium",
            alert.enabled
              ? "bg-accent-teal/10 text-accent-teal"
              : "bg-surface-secondary text-text-muted"
          )}
        >
          {alert.enabled ? "Active" : "Paused"}
        </span>
        <button
          type="button"
          onClick={onToggle}
          className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary"
          title={alert.enabled ? "Disable" : "Enable"}
        >
          <Power className={cn("size-3.5", alert.enabled && "text-accent-teal")} />
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="flex size-7 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary"
        >
          <Edit2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main AlertsView                                                    */
/* ------------------------------------------------------------------ */

export function AlertsView() {
  const queryClient = useQueryClient();
  const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
  const alertsQuery = useDashboardAlerts();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingAlert, setEditingAlert] = useState<DashboardAlert | null>(null);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: dashboardKeys.alerts(selectedSiteId) });
  }, [queryClient, selectedSiteId]);

  async function handleToggle(alert: DashboardAlert) {
    try {
      await updateDashboardAlert(selectedSiteId, alert.id, {
        name: alert.name,
        metric: alert.metric,
        condition: alert.condition,
        threshold: alert.threshold,
        period: alert.period,
        webhookUrl: alert.webhookUrl,
        enabled: !alert.enabled,
      });
      invalidate();
    } catch {
      /* silent */
    }
  }

  /* Loading state */
  if (alertsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[80px] rounded-2xl" />
        <Skeleton className="h-[200px] rounded-2xl" />
      </div>
    );
  }

  const alerts = alertsQuery.data ?? [];
  const activeCount = alerts.filter((a) => a.enabled).length;
  const pausedCount = alerts.length - activeCount;
  const lastFired = alerts
    .filter((a) => a.lastFiredAt)
    .sort((a, b) => new Date(b.lastFiredAt!).getTime() - new Date(a.lastFiredAt!).getTime())[0];

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Total Alerts</p>
          <p className="ov-kpi-number">{alerts.length}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Active</p>
          <p className="ov-kpi-number" style={{ color: "#0D9488" }}>{activeCount}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Paused</p>
          <p className="ov-kpi-number">{pausedCount}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Last Fired</p>
          <p className="mt-1 truncate text-[14px] font-semibold text-text-primary">
            {lastFired?.lastFiredAt
              ? new Date(lastFired.lastFiredAt).toLocaleDateString()
              : "\u2014"}
          </p>
          {lastFired && (
            <p className="text-[11px] text-text-secondary truncate">{lastFired.name}</p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-secondary">
          {alerts.length} alert{alerts.length !== 1 ? "s" : ""} configured
        </p>
        <Button
          size="sm"
          onClick={() => {
            setEditingAlert(null);
            setSheetOpen(true);
          }}
          className="gap-1.5"
        >
          <Plus className="size-3.5" />
          New Alert
        </Button>
      </div>

      {/* Alert list */}
      {alerts.length ? (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <div className="ov-list">
            {alerts.map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                onEdit={() => {
                  setEditingAlert(alert);
                  setSheetOpen(true);
                }}
                onToggle={() => handleToggle(alert)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="section-frame flex flex-col items-center justify-center rounded-2xl border border-border/50 py-16 text-center">
          <Bell className="size-10 text-text-muted" />
          <h3 className="mt-4 text-[15px] font-semibold text-text-primary">No alerts configured yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-secondary">
            Create metric alerts to get notified via webhook when pageviews, visitors, bounce rate, or rage clicks cross a threshold.
          </p>
          <Button
            size="sm"
            className="mt-4 gap-1.5"
            onClick={() => {
              setEditingAlert(null);
              setSheetOpen(true);
            }}
          >
            <Plus className="size-3.5" />
            Create your first alert
          </Button>
        </div>
      )}

      {/* Channel overview */}
      {alerts.length > 0 && (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <h3 className="text-[13px] font-semibold text-text-primary mb-3">Delivery Channels</h3>
          <div className="ov-list">
            <div className="ov-list-row">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Webhook className="size-4 text-accent-teal shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">Webhook</p>
                  <p className="text-[11px] text-text-secondary">POST JSON payloads to any URL</p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-md bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">
                Available
              </span>
            </div>
            <div className="ov-list-row">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <Mail className="size-4 text-text-muted shrink-0" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">Email</p>
                  <p className="text-[11px] text-text-secondary">Deliver alerts to recipient addresses</p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                Coming soon
              </span>
            </div>
            <div className="ov-list-row">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <svg className="size-4 text-text-muted shrink-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm10.122 2.521a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.268 0a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 10.122a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.268a2.527 2.527 0 0 1-2.52-2.523 2.527 2.527 0 0 1 2.52-2.52h6.313A2.528 2.528 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
                </svg>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-text-primary">Slack</p>
                  <p className="text-[11px] text-text-secondary">Connect workspace and select channels</p>
                </div>
              </div>
              <span className="inline-flex items-center rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-muted">
                Coming soon
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Alert Form Sheet (modal) */}
      <AlertFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editingAlert={editingAlert}
        siteId={selectedSiteId}
        onSaved={invalidate}
      />
    </div>
  );
}
