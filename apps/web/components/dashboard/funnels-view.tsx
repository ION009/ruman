"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  ChartNoAxesColumnIncreasing,
  Clock3,
  Copy,
  Download,
  GitBranchPlus,
  MousePointerClick,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useState } from "react";

import { useDashboardFunnels, useDashboardReplaySessions } from "@/hooks/use-dashboard";
import {
  createDashboardFunnel,
  dashboardKeys,
  deleteDashboardFunnel,
  fetchDashboardFunnelEntities,
  fetchDashboardFunnelReport,
  updateDashboardFunnel,
} from "@/lib/dashboard/client";
import type {
  FunnelDefinition,
  FunnelDefinitionInput,
  FunnelEntityStatus,
  FunnelReport,
  FunnelStepDefinition,
  FunnelStepKind,
  FunnelStepMatchType,
} from "@/lib/dashboard/types";
import { formatNumber, formatPercent, timeAgo } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/* -------------------------------------------------------------------------- */
/*  Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PAGE_DATALIST_ID = "dashboard-funnel-page-suggestions";
const EVENT_DATALIST_ID = "dashboard-funnel-event-suggestions";

/* -------------------------------------------------------------------------- */
/*  Helper functions (all preserved)                                           */
/* -------------------------------------------------------------------------- */

function defaultStep(kind: FunnelStepKind = "page", value = ""): FunnelStepDefinition {
  return {
    label: kind === "page" ? "Page step" : "Event step",
    kind,
    matchType: "exact",
    value,
  };
}

function normalizePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }

  let normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/{2,}/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized || "/";
}

function normalizePageFieldValue(value: string) {
  return value.trim() ? normalizePath(value) : "";
}

function sanitizeDefinition(input: FunnelDefinitionInput): FunnelDefinitionInput {
  return {
    name: input.name.trim(),
    countMode: input.countMode === "sessions" ? "sessions" : "visitors",
    windowMinutes: Math.min(1440, Math.max(1, Math.round(Number(input.windowMinutes) || 30))),
    steps: input.steps.map((step, index) => ({
      label: step.label.trim() || `Step ${index + 1}`,
      kind: step.kind === "event" ? "event" : "page",
      matchType: step.matchType === "prefix" ? "prefix" : "exact",
      value:
        step.kind === "event"
          ? step.value.trim()
          : normalizePageFieldValue(step.value).trim(),
    })),
  };
}

function serializeDefinition(input: FunnelDefinitionInput) {
  return JSON.stringify(sanitizeDefinition(input));
}

function definitionFromSaved(definition: FunnelDefinition): FunnelDefinitionInput {
  return {
    name: definition.name,
    countMode: definition.countMode,
    windowMinutes: definition.windowMinutes,
    steps: definition.steps.map((step) => ({ ...step })),
  };
}

function cloneDefinitionInput(definition: FunnelDefinitionInput): FunnelDefinitionInput {
  const baseName = definition.name.trim() || "Funnel";
  return {
    ...definition,
    name: `${baseName} copy`,
    steps: definition.steps.map((step) => ({ ...step })),
  };
}

function entityLabel(entityId: string, countMode: FunnelDefinitionInput["countMode"]) {
  if (countMode === "sessions") {
    return entityId;
  }
  if (entityId.length <= 12) {
    return entityId;
  }
  return `visitor ${entityId.slice(-10)}`;
}

function buildStarterDefinition(suggestedPages: string[]): FunnelDefinitionInput {
  const uniquePages = [...new Set(suggestedPages.filter(Boolean))];
  return {
    name: "Revenue journey",
    countMode: "visitors",
    windowMinutes: 30,
    steps: [
      defaultStep("page", uniquePages[0] ?? "/"),
      defaultStep("page", uniquePages[1] ?? "/pricing"),
      defaultStep("page", uniquePages[2] ?? "/contact"),
    ].map((step, index) => ({
      ...step,
      label:
        index === 0
          ? "Entry"
          : index === 1
            ? "Consideration"
            : "Conversion",
    })),
  };
}

function isDefinitionReady(input: FunnelDefinitionInput | null) {
  if (!input) {
    return false;
  }
  const normalized = sanitizeDefinition(input);
  if (!normalized.name || normalized.steps.length < 2) {
    return false;
  }
  return normalized.steps.every((step) => Boolean(step.value));
}

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-[280px] rounded-2xl" />
      <Skeleton className="h-[420px] rounded-2xl" />
    </div>
  );
}

function downloadReportCSV(report: FunnelReport) {
  if (!report) {
    return;
  }

  const lines = [
    ["index", "label", "kind", "matchType", "value", "count", "conversionRate", "stepConversionRate", "dropOffCount", "dropOffRate", "avgSecondsFromPrevious", "avgSecondsFromStart"].join(","),
    ...report.steps.map((step) =>
      [
        step.index,
        JSON.stringify(step.label),
        step.kind,
        step.matchType,
        JSON.stringify(step.value),
        step.count,
        step.conversionRate,
        step.stepConversionRate,
        step.dropOffCount,
        step.dropOffRate,
        step.avgSecondsFromPrevious,
        step.avgSecondsFromStart,
      ].join(","),
    ),
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `funnel-${report.range}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/*  Funnel builder Sheet (modal)                                               */
/* -------------------------------------------------------------------------- */

function FunnelBuilderSheet({
  open,
  onOpenChange,
  draft,
  normalizedDraft,
  isReady,
  isDirty,
  canPersist,
  selectedDefinition,
  suggestedPages,
  suggestedEvents,
  reportIsFetching,
  saveMutationIsPending,
  deleteMutationIsPending,
  onUpdateField,
  onUpdateStep,
  onAddStep,
  onRemoveStep,
  onRunAnalysis,
  onClone,
  onSave,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: FunnelDefinitionInput;
  normalizedDraft: FunnelDefinitionInput;
  isReady: boolean;
  isDirty: boolean;
  canPersist: boolean;
  selectedDefinition: FunnelDefinition | null;
  suggestedPages: string[];
  suggestedEvents: string[];
  reportIsFetching: boolean;
  saveMutationIsPending: boolean;
  deleteMutationIsPending: boolean;
  onUpdateField: <K extends keyof FunnelDefinitionInput>(field: K, value: FunnelDefinitionInput[K]) => void;
  onUpdateStep: (index: number, patch: Partial<FunnelStepDefinition>) => void;
  onAddStep: (kind: FunnelStepKind, value?: string) => void;
  onRemoveStep: (index: number) => void;
  onRunAnalysis: () => void;
  onClone: () => void;
  onSave: () => void;
  onDelete: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[92vw] max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{selectedDefinition ? "Edit funnel" : "Create funnel"}</SheetTitle>
          <SheetDescription>
            Define the sequence you expect visitors to complete, then measure the
            exact step where momentum breaks.
          </SheetDescription>
        </SheetHeader>

        {!canPersist ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-white/55 px-4 py-3 text-sm text-text-secondary">
            Token mode can still analyze funnels, but saved definitions require the
            control plane database.
          </div>
        ) : null}

        <div className="mt-4 space-y-5">
          {/* Meta fields */}
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="space-y-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-secondary">Funnel name</span>
              <Input
                value={normalizedDraft.name}
                onChange={(event) => onUpdateField("name", event.target.value)}
                placeholder="Checkout conversion"
              />
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-secondary">Counting mode</span>
              <Select
                value={normalizedDraft.countMode}
                onValueChange={(value) => onUpdateField("countMode", value as FunnelDefinitionInput["countMode"])}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="visitors">Visitors</SelectItem>
                  <SelectItem value="sessions">Sessions</SelectItem>
                </SelectContent>
              </Select>
            </label>

            <label className="space-y-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-text-secondary">Window (minutes)</span>
              <Input
                type="number"
                min={1}
                max={1440}
                value={normalizedDraft.windowMinutes}
                onChange={(event) => onUpdateField("windowMinutes", Number(event.target.value) || 30)}
              />
            </label>
          </div>

          {/* Steps */}
          <div className="space-y-3">
            {normalizedDraft.steps.map((step, index) => (
              <div key={`${index}-${step.label}`} className="rounded-xl border border-border/50 bg-white/58 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="flex size-5 items-center justify-center rounded-full bg-accent-teal/10 text-[10px] font-semibold text-accent-teal">
                      {index + 1}
                    </span>
                    <span className="text-[13px] font-medium text-text-primary">
                      {step.label || `Step ${index + 1}`}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveStep(index)}
                    disabled={normalizedDraft.steps.length <= 2}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="text-[11px] text-text-secondary">Label</span>
                    <Input
                      value={step.label}
                      onChange={(event) => onUpdateStep(index, { label: event.target.value })}
                      placeholder={`Step ${index + 1}`}
                    />
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] text-text-secondary">Kind</span>
                    <Select
                      value={step.kind}
                      onValueChange={(value) =>
                        onUpdateStep(index, {
                          kind: value as FunnelStepKind,
                          value:
                            value === "page"
                              ? normalizePageFieldValue(step.value || "/")
                              : step.value.replace(/^\//, ""),
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select step type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="page">Page view</SelectItem>
                        <SelectItem value="event">Custom event</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] text-text-secondary">Match</span>
                    <Select
                      value={step.matchType}
                      onValueChange={(value) =>
                        onUpdateStep(index, { matchType: value as FunnelStepMatchType })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select match" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="exact">Exact</SelectItem>
                        <SelectItem value="prefix">Starts with</SelectItem>
                      </SelectContent>
                    </Select>
                  </label>

                  <label className="space-y-1.5">
                    <span className="text-[11px] text-text-secondary">
                      {step.kind === "page" ? "Path" : "Event name"}
                    </span>
                    <Input
                      value={step.value}
                      list={step.kind === "page" ? PAGE_DATALIST_ID : EVENT_DATALIST_ID}
                      onChange={(event) => onUpdateStep(index, { value: event.target.value })}
                      placeholder={step.kind === "page" ? "/checkout" : "purchase_completed"}
                    />
                  </label>
                </div>
              </div>
            ))}

            <datalist id={PAGE_DATALIST_ID}>
              {suggestedPages.map((path) => (
                <option key={path} value={path} />
              ))}
            </datalist>
            <datalist id={EVENT_DATALIST_ID}>
              {suggestedEvents.map((eventName) => (
                <option key={eventName} value={eventName} />
              ))}
            </datalist>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => onAddStep("page")} disabled={normalizedDraft.steps.length >= 8}>
                <Plus className="size-3.5" />
                Add page step
              </Button>
              <Button variant="outline" size="sm" onClick={() => onAddStep("event")} disabled={normalizedDraft.steps.length >= 8}>
                <MousePointerClick className="size-3.5" />
                Add event step
              </Button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
            <Button
              onClick={onRunAnalysis}
              disabled={!isReady || reportIsFetching}
            >
              <ChartNoAxesColumnIncreasing className="size-4" />
              {reportIsFetching ? "Running..." : "Run analysis"}
            </Button>
            <Button
              variant="outline"
              onClick={onClone}
              disabled={!isReady}
            >
              <Copy className="size-4" />
              Clone
            </Button>
            <Button
              variant="outline"
              onClick={onSave}
              disabled={!canPersist || !isReady || saveMutationIsPending || !isDirty}
            >
              <Save className="size-4" />
              {selectedDefinition ? "Save changes" : "Save funnel"}
            </Button>
            {selectedDefinition ? (
              <Button
                variant="ghost"
                onClick={onDelete}
                disabled={deleteMutationIsPending}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Horizontal funnel visualization                                            */
/* -------------------------------------------------------------------------- */

function FunnelVisualization({
  report,
  onInspectStep,
  activeStepIndex,
}: {
  report: FunnelReport;
  onInspectStep: (stepIndex: number) => void;
  activeStepIndex: number | null;
}) {
  const entrants = report.entrants || 1;

  return (
    <div className="space-y-3">
      {/* Horizontal funnel bar visualization */}
      <div className="flex items-end gap-0">
        {report.steps.map((step, index) => {
          const widthPercent = Math.max(8, (step.count / entrants) * 100);
          const opacityValue = 1 - index * (0.6 / Math.max(1, report.steps.length - 1));
          const isActive = activeStepIndex === step.index;

          return (
            <div key={`${step.index}-${step.label}`} className="flex items-end">
              {/* Step block */}
              <button
                type="button"
                onClick={() => onInspectStep(step.index)}
                className={`group relative flex flex-col justify-end transition-all ${
                  isActive ? "ring-2 ring-[#0D9488] ring-offset-2" : ""
                }`}
                style={{ width: `${widthPercent}px`, minWidth: "72px" }}
              >
                {/* Bar */}
                <div
                  className="w-full rounded-t-lg transition-colors group-hover:brightness-95"
                  style={{
                    height: `${Math.max(32, widthPercent * 1.6)}px`,
                    backgroundColor: `rgba(13, 148, 136, ${opacityValue})`,
                  }}
                />

                {/* Step label below */}
                <div className="mt-2 w-full text-center">
                  <p className="truncate text-[11px] font-semibold text-text-primary">{step.label}</p>
                  <p className="text-[11px] font-semibold text-accent-teal">{formatNumber(step.count)}</p>
                  <p className="text-[10px] text-text-secondary">{formatPercent(step.conversionRate)}</p>
                </div>
              </button>

              {/* Arrow + drop-off between steps */}
              {index < report.steps.length - 1 ? (
                <div className="flex flex-col items-center px-1.5 pb-8">
                  <ArrowRight className="size-3.5 text-text-muted" />
                  <p className="mt-0.5 whitespace-nowrap text-[10px] font-medium text-status-error">
                    -{formatNumber(report.steps[index + 1].dropOffCount)}
                  </p>
                  <p className="whitespace-nowrap text-[9px] text-text-secondary">
                    {formatPercent(report.steps[index + 1].dropOffRate)}
                  </p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Timing row */}
      <div className="flex items-center gap-3 overflow-x-auto pt-1">
        {report.steps.map((step, index) => (
          <div key={`timing-${step.index}`} className="flex items-center gap-1 whitespace-nowrap text-[10px] text-text-muted">
            <Clock3 className="size-3" />
            {index === 0
              ? "Entry"
              : `${formatNumber(step.avgSecondsFromPrevious)}s from prior`}
          </div>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function FunnelsView() {
  const queryClient = useQueryClient();
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);
  const catalogQuery = useDashboardFunnels();
  const replaySessionsQuery = useDashboardReplaySessions();
  const [selectedDefinitionId, setSelectedDefinitionId] = useState("");
  const [draft, setDraft] = useState<FunnelDefinitionInput | null>(null);
  const [baseline, setBaseline] = useState("");
  const [analysisInput, setAnalysisInput] = useState<FunnelDefinitionInput | null>(null);
  const [inspection, setInspection] = useState<{
    stepIndex: number;
    status: FunnelEntityStatus;
    page: number;
  } | null>(null);
  const [builderOpen, setBuilderOpen] = useState(false);

  const catalog = catalogQuery.data;
  const canPersist = catalog?.canPersist ?? false;
  const definitions = catalog?.definitions ?? [];
  const suggestedPages = catalog?.suggestedPages ?? [];
  const suggestedEvents = catalog?.suggestedEvents ?? [];
  const selectedDefinition =
    definitions.find((definition) => definition.id === selectedDefinitionId) ?? null;

  useEffect(() => {
    if (!catalog) {
      return;
    }

    if (selectedDefinition) {
      const next = definitionFromSaved(selectedDefinition);
      const nextSerialized = serializeDefinition(next);
      if (baseline !== nextSerialized) {
        setDraft(next);
        setBaseline(nextSerialized);
        setAnalysisInput(next);
      }
      return;
    }

    if (!draft) {
      const seed = definitions[0]
        ? definitionFromSaved(definitions[0])
        : buildStarterDefinition(suggestedPages);
      const seedId = definitions[0]?.id ?? "";
      setSelectedDefinitionId(seedId);
      setDraft(seed);
      setBaseline(seedId ? serializeDefinition(seed) : "");
      setAnalysisInput(seed);
    }
  }, [baseline, catalog, definitions, draft, selectedDefinition, suggestedPages]);

  const analysisKey = analysisInput ? serializeDefinition(analysisInput) : "";
  const reportQuery = useQuery({
    queryKey: dashboardKeys.funnelReport(selectedSiteId, selectedRange, analysisKey),
    queryFn: () => fetchDashboardFunnelReport(selectedSiteId, selectedRange, sanitizeDefinition(analysisInput!)),
    enabled: Boolean(selectedSiteId && analysisInput && isDefinitionReady(analysisInput)),
    refetchOnWindowFocus: true,
  });
  const inspectionKey = inspection
    ? dashboardKeys.funnelEntities(
        selectedSiteId,
        selectedRange,
        analysisKey,
        inspection.stepIndex,
        inspection.status,
        inspection.page,
      )
    : (["dashboard", "funnel-entities", "idle"] as const);
  const entitiesQuery = useQuery({
    queryKey: inspectionKey,
    queryFn: () =>
      fetchDashboardFunnelEntities(
        selectedSiteId,
        selectedRange,
        inspection!.stepIndex,
        inspection!.status,
        inspection!.page,
        sanitizeDefinition(analysisInput!),
      ),
    enabled: Boolean(selectedSiteId && analysisInput && inspection && isDefinitionReady(analysisInput)),
    refetchOnWindowFocus: true,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) {
        throw new Error("Build a funnel first.");
      }

      const next = sanitizeDefinition(draft);
      if (selectedDefinition) {
        return updateDashboardFunnel(selectedSiteId, selectedDefinition.id, next);
      }
      return createDashboardFunnel(selectedSiteId, next);
    },
    onSuccess: async (definition) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.funnels(selectedSiteId) });
      const next = definitionFromSaved(definition);
      setSelectedDefinitionId(definition.id);
      setDraft(next);
      setBaseline(serializeDefinition(next));
      setAnalysisInput(next);
      setInspection(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDefinition) {
        throw new Error("Choose a saved funnel first.");
      }
      await deleteDashboardFunnel(selectedSiteId, selectedDefinition.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.funnels(selectedSiteId) });
      setSelectedDefinitionId("");
      setDraft(null);
      setBaseline("");
      setAnalysisInput(null);
      setInspection(null);
    },
  });

  /* Error state */
  if (catalogQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="ov-section-title text-[14px] font-semibold text-text-primary">Funnels unavailable</h2>
        <p className="mt-2 text-sm text-status-error">{catalogQuery.error.message}</p>
      </div>
    );
  }

  /* Loading state */
  if ((catalogQuery.isLoading && !catalog) || !draft) {
    return <ReportSkeleton />;
  }

  const normalizedDraft = sanitizeDefinition(draft);
  const isReady = isDefinitionReady(normalizedDraft);
  const isDirty = serializeDefinition(normalizedDraft) !== baseline;
  const report = reportQuery.data;
  const loudestDropOff = report?.steps.slice(1).sort((left, right) => right.dropOffCount - left.dropOffCount)[0];
  const completionStep = report?.steps.at(-1);
  const replaySessions = replaySessionsQuery.data?.sessions ?? [];
  const replaySessionsById = new Map(replaySessions.map((session) => [session.sessionId, session]));
  const inspectedEntities = entitiesQuery.data;

  function applyDraft(next: FunnelDefinitionInput, definitionId = "") {
    setSelectedDefinitionId(definitionId);
    setDraft(next);
    setBaseline(definitionId ? serializeDefinition(next) : "");
    setAnalysisInput(next);
    setInspection(null);
  }

  function updateField<K extends keyof FunnelDefinitionInput>(field: K, value: FunnelDefinitionInput[K]) {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateStep(index: number, patch: Partial<FunnelStepDefinition>) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const steps = current.steps.map((step, stepIndex) => {
        if (stepIndex !== index) {
          return step;
        }
        const nextKind = (patch.kind ?? step.kind) as FunnelStepKind;
        const nextMatchType = (patch.matchType ?? step.matchType) as FunnelStepMatchType;
        const nextValue = patch.value ?? step.value;
        return {
          ...step,
          ...patch,
          kind: nextKind,
          matchType: nextMatchType,
          value: nextKind === "page" ? normalizePageFieldValue(nextValue) : nextValue,
        };
      });

      return { ...current, steps };
    });
  }

  function addStep(kind: FunnelStepKind = "page", value = "") {
    setDraft((current) => {
      if (!current || current.steps.length >= 8) {
        return current;
      }
      return {
        ...current,
        steps: [
          ...current.steps,
          {
            ...defaultStep(kind, value),
            label: `Step ${current.steps.length + 1}`,
          },
        ],
      };
    });
  }

  function cloneCurrentDefinition() {
    applyDraft(cloneDefinitionInput(normalizedDraft));
  }

  function inspectStep(stepIndex: number, status: FunnelEntityStatus) {
    setInspection((current) => {
      if (current?.stepIndex === stepIndex && current.status === status) {
        return null;
      }
      return { stepIndex, status, page: 1 };
    });
  }

  function changeInspectionPage(direction: "next" | "prev") {
    setInspection((current) => {
      if (!current) {
        return current;
      }
      const nextPage = direction === "next" ? current.page + 1 : Math.max(1, current.page - 1);
      return { ...current, page: nextPage };
    });
  }

  function removeStep(index: number) {
    setDraft((current) => {
      if (!current || current.steps.length <= 2) {
        return current;
      }
      return {
        ...current,
        steps: current.steps.filter((_, stepIndex) => stepIndex !== index).map((step, stepIndex) => ({
          ...step,
          label: step.label || `Step ${stepIndex + 1}`,
        })),
      };
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr),360px]">
      {/* ----------------------------------------------------------- */}
      {/*  Main column                                                  */}
      {/* ----------------------------------------------------------- */}
      <div className="space-y-6">
        {/* Top bar: funnel name + actions */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h2 className="ov-section-title text-[14px] font-semibold text-text-primary">
                {normalizedDraft.name || "Untitled funnel"}
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {normalizedDraft.steps.length} steps
                </span>
                <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {normalizedDraft.countMode}
                </span>
                <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                  {normalizedDraft.windowMinutes}m window
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setBuilderOpen(true)}>
                <Pencil className="size-4" />
                {selectedDefinition ? "Edit funnel" : "Create funnel"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setInspection(null);
                  setAnalysisInput(sanitizeDefinition(normalizedDraft));
                }}
                disabled={!isReady || reportQuery.isFetching}
              >
                <ChartNoAxesColumnIncreasing className="size-4" />
                {reportQuery.isFetching ? "Running..." : "Run analysis"}
              </Button>
              {report ? (
                <Button variant="outline" size="sm" onClick={() => downloadReportCSV(report)}>
                  <Download className="size-4" />
                  Export CSV
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        {/* KPI strip */}
        {report ? (
          <div className="ov-kpi-strip section-frame grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 md:grid-cols-4">
            <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
              <div className="ov-kpi-label flex items-center gap-1.5 text-[11px] text-text-secondary">
                <Users className="size-3.5 text-accent-teal" />
                Entrants
              </div>
              <p className="ov-kpi-number text-2xl font-semibold text-text-primary">{formatNumber(report.entrants)}</p>
            </div>

            <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
              <div className="ov-kpi-label flex items-center gap-1.5 text-[11px] text-text-secondary">
                <ChartNoAxesColumnIncreasing className="size-3.5 text-accent-teal" />
                Completion rate
              </div>
              <p className="ov-kpi-number text-2xl font-semibold text-text-primary">
                {formatPercent(report.overallConversionRate)}
              </p>
              <p className="text-[11px] text-text-muted">{formatNumber(report.completions)} completed</p>
            </div>

            <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
              <div className="ov-kpi-label flex items-center gap-1.5 text-[11px] text-text-secondary">
                <ArrowRight className="size-3.5 text-accent-amber" />
                Biggest loss
              </div>
              <p className="ov-kpi-number truncate text-lg font-semibold text-text-primary">
                {loudestDropOff?.label ?? "\u2014"}
              </p>
              <p className="text-[11px] text-text-muted">
                {loudestDropOff ? `${formatNumber(loudestDropOff.dropOffCount)} dropped` : "Waiting for step transitions"}
              </p>
            </div>

            <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
              <div className="ov-kpi-label flex items-center gap-1.5 text-[11px] text-text-secondary">
                <Clock3 className="size-3.5 text-accent-amber" />
                Final pace
              </div>
              <p className="ov-kpi-number text-lg font-semibold text-text-primary">
                {completionStep ? `${formatNumber(completionStep.avgSecondsFromStart)}s` : "0s"}
              </p>
              <p className="text-[11px] text-text-muted">Average from entry to final step</p>
            </div>
          </div>
        ) : null}

        {/* Funnel visualization (hero surface) */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <h3 className="ov-section-title mb-4 text-[14px] font-semibold text-text-primary">Funnel visualization</h3>

          {reportQuery.error ? (
            <div className="rounded-xl border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
              {reportQuery.error.message}
            </div>
          ) : null}

          {!report ? (
            <div className="rounded-2xl border border-dashed border-border/70 bg-white/52 px-6 py-10 text-center">
              <GitBranchPlus className="mx-auto size-8 text-accent-teal" />
              <p className="mt-3 text-[14px] font-semibold text-text-primary">Run the funnel to see loss points</p>
              <p className="mt-2 text-sm text-text-secondary">
                Define at least two valid steps and run analysis to surface conversion, drop-off, and pace between steps.
              </p>
            </div>
          ) : (
            <FunnelVisualization
              report={report}
              onInspectStep={(stepIndex) => inspectStep(stepIndex, "reached")}
              activeStepIndex={inspection?.stepIndex ?? null}
            />
          )}
        </div>

        {/* Step drill-down / inspection section */}
        {report ? (
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="ov-section-title mb-4 text-[14px] font-semibold text-text-primary">Step drill-down</h3>
            <p className="mb-4 text-[12px] text-text-secondary">Click a step in the visualization above, or use the buttons below to inspect reached / dropped entities.</p>

            <div className="ov-list space-y-2">
              {/* List header */}
              <div className="ov-list-header grid grid-cols-[minmax(0,1.2fr),80px,80px,80px,100px] gap-3 px-3 py-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                <span>Step</span>
                <span className="text-right">Reached</span>
                <span className="text-right">Conversion</span>
                <span className="text-right">Drop-off</span>
                <span className="text-right">Actions</span>
              </div>

              {report.steps.map((step, index) => {
                const barWidth = report.entrants > 0 ? (step.count / report.entrants) * 100 : 0;
                const isInspecting = inspection?.stepIndex === step.index;

                return (
                  <div key={`${step.index}-${step.label}`}>
                    <div
                      className={`ov-list-row relative grid grid-cols-[minmax(0,1.2fr),80px,80px,80px,100px] items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                        isInspecting ? "bg-accent-teal/5 ring-1 ring-[#0D9488]/20" : "hover:bg-surface-secondary/60"
                      }`}
                    >
                      {/* Bar background */}
                      <div className="ov-list-bar-bg absolute inset-0 overflow-hidden rounded-lg">
                        <div
                          className="ov-list-bar-fill h-full bg-accent-teal/[0.06]"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>

                      <div className="ov-list-label relative z-10 flex items-center gap-2 min-w-0">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent-teal/10 text-[10px] font-semibold text-accent-teal">
                          {index + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[13px] font-medium text-text-primary">{step.label}</p>
                          <p className="truncate text-[10px] text-text-muted">
                            {step.kind} {step.matchType} {step.value}
                          </p>
                        </div>
                      </div>

                      <span className="ov-list-value relative z-10 text-right text-[13px] font-semibold text-text-primary">
                        {formatNumber(step.count)}
                      </span>
                      <span className="ov-list-value relative z-10 text-right text-[13px] text-accent-teal">
                        {formatPercent(step.conversionRate)}
                      </span>
                      <span className="ov-list-value relative z-10 text-right text-[13px] text-text-secondary">
                        {index > 0 ? `${formatNumber(step.dropOffCount)} (${formatPercent(step.dropOffRate)})` : "\u2014"}
                      </span>

                      <div className="relative z-10 flex justify-end gap-1">
                        <Button
                          variant={isInspecting && inspection?.status === "reached" ? "default" : "ghost"}
                          size="sm"
                          className="h-7 px-2 text-[11px]"
                          onClick={() => inspectStep(step.index, "reached")}
                        >
                          Reached
                        </Button>
                        {index > 0 ? (
                          <Button
                            variant={isInspecting && inspection?.status === "dropped" ? "default" : "ghost"}
                            size="sm"
                            className="h-7 px-2 text-[11px]"
                            onClick={() => inspectStep(step.index, "dropped")}
                          >
                            Dropped
                          </Button>
                        ) : null}
                      </div>
                    </div>

                    {/* Inline inspection panel */}
                    {isInspecting ? (
                      <div className="mt-2 rounded-xl border border-border/50 bg-surface-primary p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-[13px] font-semibold text-text-primary">
                              {inspection.status === "reached"
                                ? `${formatNumber(step.count)} reached this step`
                                : `${formatNumber(step.dropOffCount)} dropped before this step`}
                            </p>
                            <p className="mt-1 text-[11px] text-text-secondary">
                              {inspection.status === "reached"
                                ? `Entities that completed step ${step.index + 1}.`
                                : `Entities that completed step ${step.index} but never reached step ${step.index + 1}.`}
                            </p>
                          </div>
                          {inspectedEntities ? (
                            <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                              {formatNumber(inspectedEntities.total)} total
                            </span>
                          ) : null}
                        </div>

                        {entitiesQuery.isLoading ? (
                          <div className="mt-4 space-y-3">
                            <Skeleton className="h-20 rounded-xl" />
                            <Skeleton className="h-20 rounded-xl" />
                          </div>
                        ) : entitiesQuery.error ? (
                          <div className="mt-4 rounded-xl border border-status-error/20 bg-status-error/5 px-4 py-3 text-sm text-status-error">
                            {entitiesQuery.error.message}
                          </div>
                        ) : inspectedEntities && inspectedEntities.entities.length === 0 ? (
                          <div className="mt-4 rounded-xl border border-dashed border-border/70 bg-white/55 px-4 py-6 text-sm text-text-secondary">
                            {inspection.status === "reached"
                              ? "No entities matched this step in the current range."
                              : "No drop-off entities matched this handoff in the current range."}
                          </div>
                        ) : inspectedEntities ? (
                          <div className="mt-4 space-y-3">
                            {inspectedEntities.entities.map((entity) => {
                              const replaySession = inspectedEntities.countMode === "sessions"
                                ? replaySessionsById.get(entity.entityId)
                                : null;
                              return (
                                <div
                                  key={entity.entityId}
                                  className="rounded-xl border border-border/50 bg-surface-secondary/40 p-4"
                                >
                                  <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate text-[13px] font-semibold text-text-primary">
                                        {entity.entryPath || "/"}
                                      </p>
                                      <p className="mt-1 truncate text-[11px] text-text-secondary">
                                        {entityLabel(entity.entityId, inspectedEntities.countMode)} · updated {timeAgo(entity.updatedAt)}
                                      </p>
                                    </div>
                                    {replaySession ? (
                                      <Button asChild size="sm" variant="outline">
                                        <a href={`/session-replay?session=${encodeURIComponent(replaySession.sessionId)}`}>
                                          Open replay
                                        </a>
                                      </Button>
                                    ) : null}
                                  </div>

                                  <div className="mt-3 grid gap-2 text-[11px] text-text-secondary sm:grid-cols-3">
                                    <div className="rounded-lg border border-border/50 bg-surface-primary px-3 py-2">
                                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Path spread</p>
                                      <p className="mt-1 truncate">
                                        {entity.paths.slice(0, 3).join(" · ") || entity.exitPath || "/"}
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-border/50 bg-surface-primary px-3 py-2">
                                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Activity</p>
                                      <p className="mt-1">
                                        {formatNumber(entity.pageviews)} pageviews · {formatNumber(entity.eventCount)} events
                                      </p>
                                    </div>
                                    <div className="rounded-lg border border-border/50 bg-surface-primary px-3 py-2">
                                      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Context</p>
                                      <p className="mt-1 truncate">
                                        {entity.deviceType || "device"} · {entity.browser || "browser"} · {entity.os || "os"}
                                        {inspectedEntities.countMode === "visitors"
                                          ? ` · ${formatNumber(entity.sessionCount)} sessions`
                                          : ""}
                                      </p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}

                            <div className="flex items-center justify-between gap-3 pt-1">
                              <p className="text-[11px] text-text-secondary">
                                Page {inspectedEntities.page} · {formatNumber(inspectedEntities.total)} total entities
                              </p>
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => changeInspectionPage("prev")}
                                  disabled={inspectedEntities.page <= 1}
                                >
                                  Previous
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => changeInspectionPage("next")}
                                  disabled={!inspectedEntities.hasMore}
                                >
                                  Next
                                </Button>
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* ----------------------------------------------------------- */}
      {/*  Side panel                                                    */}
      {/* ----------------------------------------------------------- */}
      <div className="space-y-6">
        {/* Saved funnels */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="ov-section-title text-[14px] font-semibold text-text-primary">Saved funnels</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                applyDraft(buildStarterDefinition(suggestedPages));
                setBuilderOpen(true);
              }}
            >
              <Plus className="size-3.5" />
              New
            </Button>
          </div>
          <p className="mt-1.5 text-[11px] text-text-secondary">
            Keep canonical journeys for each site and switch between them without rebuilding the steps.
          </p>

          <div className="mt-4 space-y-2">
            {definitions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-white/52 px-4 py-6 text-[12px] text-text-secondary">
                {canPersist
                  ? "No saved funnels yet. Start with the builder, then save the journey you want to track."
                  : "Saved funnels are unavailable in token mode, but you can still run analysis from the builder."}
              </div>
            ) : (
              definitions.map((definition) => {
                const active = definition.id === selectedDefinitionId;
                return (
                  <button
                    key={definition.id}
                    type="button"
                    onClick={() => applyDraft(definitionFromSaved(definition), definition.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-accent-teal/40 bg-accent-teal/5"
                        : "border-border/50 bg-surface-primary hover:bg-surface-secondary/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[13px] font-medium text-text-primary">{definition.name}</p>
                      <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                        {definition.steps.length} steps
                      </span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-text-secondary">
                      {definition.countMode} · {definition.windowMinutes}m window
                    </p>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Page library */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <h3 className="ov-section-title text-[14px] font-semibold text-text-primary">Page library</h3>
          <p className="mt-1.5 text-[11px] text-text-secondary">
            Click a path to append it as the next page step in the current funnel.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestedPages.length === 0 ? (
              <div className="w-full rounded-xl border border-dashed border-border/70 bg-white/52 px-4 py-6 text-[12px] text-text-secondary">
                No page suggestions yet. Tracked pages will appear here once traffic arrives.
              </div>
            ) : (
              suggestedPages.map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => addStep("page", path)}
                  className="rounded-md border border-border/50 bg-surface-primary px-2.5 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent-teal/5 hover:text-accent-teal"
                >
                  {path}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Event library */}
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <h3 className="ov-section-title text-[14px] font-semibold text-text-primary">Event library</h3>
          <p className="mt-1.5 text-[11px] text-text-secondary">
            Reuse tracked custom events as funnel steps instead of typing them from memory.
          </p>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {suggestedEvents.length === 0 ? (
              <div className="w-full rounded-xl border border-dashed border-border/70 bg-white/52 px-4 py-6 text-[12px] text-text-secondary">
                No custom event suggestions yet. Once tracked events arrive, they will appear here automatically.
              </div>
            ) : (
              suggestedEvents.map((eventName) => (
                <button
                  key={eventName}
                  type="button"
                  onClick={() => addStep("event", eventName)}
                  className="rounded-md border border-border/50 bg-surface-primary px-2.5 py-1 text-[11px] text-text-primary transition-colors hover:bg-accent-teal/5 hover:text-accent-teal"
                >
                  {eventName}
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Funnel builder Sheet (modal) */}
      <FunnelBuilderSheet
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        draft={draft}
        normalizedDraft={normalizedDraft}
        isReady={isReady}
        isDirty={isDirty}
        canPersist={canPersist}
        selectedDefinition={selectedDefinition}
        suggestedPages={suggestedPages}
        suggestedEvents={suggestedEvents}
        reportIsFetching={reportQuery.isFetching}
        saveMutationIsPending={saveMutation.isPending}
        deleteMutationIsPending={deleteMutation.isPending}
        onUpdateField={updateField}
        onUpdateStep={updateStep}
        onAddStep={addStep}
        onRemoveStep={removeStep}
        onRunAnalysis={() => {
          setInspection(null);
          setAnalysisInput(sanitizeDefinition(normalizedDraft));
        }}
        onClone={cloneCurrentDefinition}
        onSave={() => saveMutation.mutate()}
        onDelete={() => deleteMutation.mutate()}
      />
    </div>
  );
}
