import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import {
  createFunnelDefinition,
  listFunnelDefinitions,
} from "@/lib/control-plane/funnels";
import { listSitePages } from "@/lib/control-plane/site-pages";
import type { SitePageRecord } from "@/lib/control-plane/site-pages";
import type {
  EventNameMetric,
  FunnelCatalogResponse,
  FunnelDefinition,
  FunnelDefinitionInput,
  FunnelStepDefinition,
  FunnelSuggestion,
  FunnelTemplate,
  PageOption,
  RangeKey,
} from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardEventNamesData,
  getDashboardSummaryData,
  readDashboardToken,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizeRange(value: string): RangeKey {
  if (value.startsWith("custom:")) {
    return value as RangeKey;
  }
  if (value === "24h" || value === "30d") {
    return value;
  }
  return "7d";
}

type AnalyticsCatalog = {
  pages: PageOption[];
  events: EventNameMetric[];
};

type SuggestionAccumulator = {
  kind: "page" | "event";
  matchType: "exact";
  value: string;
  label: string;
  count: number;
  score: number;
  sources: Set<string>;
  reasons: Set<string>;
};

async function loadAnalyticsCatalog(
  siteId: string,
  options?: {
    range?: RangeKey;
    token?: string;
  },
) {
  if (!analyticsProxyEnabled() || !options?.token) {
    return { pages: [], events: [] };
  }

  try {
    const [summary, events] = await Promise.all([
      getDashboardSummaryData(siteId, options.range ?? "30d", options.token),
      getDashboardEventNamesData(siteId, options.range ?? "30d", options.token),
    ]);
    return {
      pages: summary.pages.filter((page) => Boolean(page.path)),
      events: events.filter((event) => Boolean(event.name)),
    };
  } catch {
    return { pages: [], events: [] };
  }
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

function humanizeSegment(value: string) {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}
  decoded = decoded
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!decoded) return "";
  return decoded.replace(/\b\w/g, (character) => character.toUpperCase());
}

function pageLabel(path: string) {
  const normalized = normalizePath(path).split("?")[0].split("#")[0] || "/";
  if (normalized === "/") return "Landing";
  const segments = normalized.split("/").filter(Boolean);
  return humanizeSegment(segments[segments.length - 1] ?? normalized) || normalized;
}

function eventLabel(name: string) {
  return humanizeSegment(name) || name.trim();
}

function countOccurrences(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return counts;
}

function pageIntentBonus(path: string) {
  const normalized = normalizePath(path).toLowerCase();
  let score = 0;
  if (normalized === "/") score += 220;
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) score += 40;
  if (segments.length === 2) score += 20;
  if (/(pricing|plans|plan|product|products|shop|store|services|features)/.test(normalized)) score += 90;
  if (/(cart|checkout|payment|billing|subscribe)/.test(normalized)) score += 110;
  if (/(signup|sign-up|register|get-started|trial|demo|contact|quote)/.test(normalized)) score += 85;
  if (/(blog|docs|guides|learn|resources|case-studies)/.test(normalized)) score += 55;
  if (/(onboarding|welcome|dashboard|app)/.test(normalized)) score += 50;
  return score;
}

function eventIntentBonus(name: string) {
  const normalized = name.trim().toLowerCase();
  let score = 0;
  if (/(purchase|checkout|payment|order|subscribe)/.test(normalized)) score += 120;
  if (/(add_to_cart|cart|begin_checkout)/.test(normalized)) score += 100;
  if (/(sign[_-]?up|register|create_account|start_trial|trial|activate)/.test(normalized)) score += 95;
  if (/(demo|contact|lead|quote|book|meeting|schedule)/.test(normalized)) score += 85;
  if (/(onboarding|workspace|project_created|invited|verified)/.test(normalized)) score += 60;
  return score;
}

function addSuggestion(
  suggestions: Map<string, SuggestionAccumulator>,
  input: {
    kind: "page" | "event";
    value: string;
    label: string;
    count?: number;
    score: number;
    source: string;
    reason: string;
  },
) {
  const value = input.value.trim();
  if (!value) return;

  const current = suggestions.get(value) ?? {
    kind: input.kind,
    matchType: "exact" as const,
    value,
    label: input.label,
    count: 0,
    score: 0,
    sources: new Set<string>(),
    reasons: new Set<string>(),
  };
  current.label = current.label || input.label;
  current.count = Math.max(current.count, Math.max(0, input.count ?? 0));
  current.score += input.score;
  current.sources.add(input.source);
  current.reasons.add(input.reason);
  suggestions.set(value, current);
}

function rankSuggestions(
  suggestions: Map<string, SuggestionAccumulator>,
  limit: number,
): FunnelSuggestion[] {
  return [...suggestions.values()]
    .sort((left, right) => {
      if (left.kind === "page" && left.value === "/") return -1;
      if (right.kind === "page" && right.value === "/") return 1;
      if (right.score !== left.score) return right.score - left.score;
      if (right.count !== left.count) return right.count - left.count;
      if (left.value.length !== right.value.length) return left.value.length - right.value.length;
      return left.value.localeCompare(right.value);
    })
    .slice(0, limit)
    .map((item) => ({
      kind: item.kind,
      matchType: item.matchType,
      value: item.value,
      label: item.label,
      score: Number(item.score.toFixed(1)),
      count: item.count,
      source: [...item.sources].join(", "),
      reason: [...item.reasons].join(" · "),
    }));
}

function pickPage(
  suggestions: FunnelSuggestion[],
  matcher: (path: string) => boolean,
  exclude: Set<string>,
) {
  return suggestions.find((suggestion) => !exclude.has(suggestion.value) && matcher(suggestion.value));
}

function pickEvent(
  suggestions: FunnelSuggestion[],
  matcher: (name: string) => boolean,
  exclude: Set<string>,
) {
  return suggestions.find((suggestion) => !exclude.has(suggestion.value) && matcher(suggestion.value));
}

function maybePushStep(
  steps: FunnelStepDefinition[],
  seen: Set<string>,
  step: FunnelStepDefinition | null | undefined,
) {
  if (!step) return;
  const key = `${step.kind}:${step.value}`;
  if (seen.has(key)) return;
  seen.add(key);
  steps.push(step);
}

function deriveTemplates(
  pageSuggestions: FunnelSuggestion[],
  eventSuggestions: FunnelSuggestion[],
): FunnelTemplate[] {
  const templates: FunnelTemplate[] = [];
  const landing = pageSuggestions.find((suggestion) => suggestion.value === "/") ?? pageSuggestions[0];

  {
    const used = new Set<string>();
    const steps: FunnelStepDefinition[] = [];
    const highIntentPage =
      pickPage(pageSuggestions, (path) => /(pricing|plans|product|products|shop|store|services)/i.test(path), used) ??
      pickPage(pageSuggestions, (path) => path !== "/", used);
    const checkoutPage = pickPage(pageSuggestions, (path) => /(cart|checkout|payment|billing|subscribe)/i.test(path), used);
    const purchaseEvent = pickEvent(eventSuggestions, (name) => /(purchase|checkout|payment|order|subscribe)/i.test(name), used);

    maybePushStep(steps, used, landing ? { label: landing.label, kind: "page", matchType: "exact", value: landing.value } : null);
    maybePushStep(steps, used, highIntentPage ? { label: highIntentPage.label, kind: "page", matchType: "exact", value: highIntentPage.value } : null);
    maybePushStep(steps, used, checkoutPage ? { label: checkoutPage.label, kind: "page", matchType: "exact", value: checkoutPage.value } : null);
    maybePushStep(steps, used, purchaseEvent ? { label: purchaseEvent.label, kind: "event", matchType: "exact", value: purchaseEvent.value } : null);

    if (steps.length >= 3) {
      templates.push({
        id: "checkout-journey",
        name: "Checkout Journey",
        countMode: "visitors",
        windowMinutes: 60,
        score: 94,
        reason: "Built from pricing, checkout, and purchase signals in your site structure and event catalog.",
        steps,
      });
    }
  }

  {
    const used = new Set<string>();
    const steps: FunnelStepDefinition[] = [];
    const signupPage = pickPage(pageSuggestions, (path) => /(signup|sign-up|register|get-started|trial|pricing)/i.test(path), used);
    const signupEvent = pickEvent(eventSuggestions, (name) => /(sign[_-]?up|register|create_account|start_trial|trial)/i.test(name), used);
    const activationPage = pickPage(pageSuggestions, (path) => /(onboarding|welcome|dashboard|app)/i.test(path), used);
    const activationEvent = pickEvent(eventSuggestions, (name) => /(onboarding|activate|workspace|project_created|verified)/i.test(name), used);

    maybePushStep(steps, used, landing ? { label: landing.label, kind: "page", matchType: "exact", value: landing.value } : null);
    maybePushStep(steps, used, signupPage ? { label: signupPage.label, kind: "page", matchType: "exact", value: signupPage.value } : null);
    maybePushStep(steps, used, signupEvent ? { label: signupEvent.label, kind: "event", matchType: "exact", value: signupEvent.value } : null);
    maybePushStep(steps, used, activationEvent ? { label: activationEvent.label, kind: "event", matchType: "exact", value: activationEvent.value } : null);
    maybePushStep(steps, used, activationPage ? { label: activationPage.label, kind: "page", matchType: "exact", value: activationPage.value } : null);

    if (steps.length >= 3) {
      templates.push({
        id: "signup-activation",
        name: "Signup to Activation",
        countMode: "visitors",
        windowMinutes: 120,
        score: 91,
        reason: "Built from signup and onboarding signals so you can inspect first-value conversion, not just registrations.",
        steps,
      });
    }
  }

  {
    const used = new Set<string>();
    const steps: FunnelStepDefinition[] = [];
    const contentPage = pickPage(pageSuggestions, (path) => /(blog|docs|guides|learn|resources|case-studies)/i.test(path), used);
    const decisionPage = pickPage(pageSuggestions, (path) => /(pricing|demo|contact|quote)/i.test(path), used);
    const leadEvent = pickEvent(eventSuggestions, (name) => /(demo|contact|lead|quote|book|meeting|schedule)/i.test(name), used);

    maybePushStep(steps, used, contentPage ? { label: contentPage.label, kind: "page", matchType: "exact", value: contentPage.value } : null);
    maybePushStep(steps, used, decisionPage ? { label: decisionPage.label, kind: "page", matchType: "exact", value: decisionPage.value } : null);
    maybePushStep(steps, used, leadEvent ? { label: leadEvent.label, kind: "event", matchType: "exact", value: leadEvent.value } : null);

    if (steps.length >= 3) {
      templates.push({
        id: "content-to-lead",
        name: "Content to Lead",
        countMode: "visitors",
        windowMinutes: 1440,
        score: 84,
        reason: "Built from content and contact intent signals to inspect research-to-conversion journeys.",
        steps,
      });
    }
  }

  return templates.sort((left, right) => right.score - left.score);
}

function buildCatalog(
  definitions: FunnelDefinition[],
  sitePages: SitePageRecord[],
  analyticsCatalog: AnalyticsCatalog,
): FunnelCatalogResponse {
  const pageSuggestions = new Map<string, SuggestionAccumulator>();
  const eventSuggestions = new Map<string, SuggestionAccumulator>();
  const savedPageCounts = countOccurrences(
    definitions.flatMap((definition) => definition.steps.filter((step) => step.kind === "page").map((step) => normalizePath(step.value))),
  );
  const savedEventCounts = countOccurrences(
    definitions.flatMap((definition) => definition.steps.filter((step) => step.kind === "event").map((step) => step.value.trim())),
  );

  for (const page of sitePages) {
    const path = normalizePath(page.path);
    addSuggestion(pageSuggestions, {
      kind: "page",
      value: path,
      label: pageLabel(path),
      count: 0,
      score: 42 + pageIntentBonus(path) + (page.source === "tracker" ? 18 : page.source === "manual" ? 14 : 8),
      source: `site-pages:${page.source}`,
      reason: `Discovered in site structure (${page.source})`,
    });
  }

  for (const page of analyticsCatalog.pages) {
    const path = normalizePath(page.path);
    addSuggestion(pageSuggestions, {
      kind: "page",
      value: path,
      label: pageLabel(path),
      count: page.pageviews,
      score: Math.min(page.pageviews, 400) + pageIntentBonus(path) + 55,
      source: "analytics",
      reason: `Observed ${page.pageviews} pageviews in the selected range`,
    });
  }

  for (const [path, count] of savedPageCounts.entries()) {
    addSuggestion(pageSuggestions, {
      kind: "page",
      value: path,
      label: pageLabel(path),
      count,
      score: count * 24 + pageIntentBonus(path) + 18,
      source: "saved-funnels",
      reason: `Already used in ${count} saved funnel${count === 1 ? "" : "s"}`,
    });
  }

  for (const event of analyticsCatalog.events) {
    const name = event.name.trim();
    addSuggestion(eventSuggestions, {
      kind: "event",
      value: name,
      label: eventLabel(name),
      count: event.count,
      score: Math.min(event.count, 400) + eventIntentBonus(name) + 40,
      source: "analytics",
      reason: `Observed ${event.count} matching events in the selected range`,
    });
  }

  for (const [name, count] of savedEventCounts.entries()) {
    addSuggestion(eventSuggestions, {
      kind: "event",
      value: name,
      label: eventLabel(name),
      count,
      score: count * 26 + eventIntentBonus(name) + 16,
      source: "saved-funnels",
      reason: `Already used in ${count} saved funnel${count === 1 ? "" : "s"}`,
    });
  }

  const rankedPageSuggestions = rankSuggestions(pageSuggestions, 18);
  const rankedEventSuggestions = rankSuggestions(eventSuggestions, 18);

  return {
    canPersist: false,
    definitions,
    suggestedPages: rankedPageSuggestions.map((item) => item.value),
    suggestedEvents: rankedEventSuggestions.map((item) => item.value),
    pageSuggestions: rankedPageSuggestions,
    eventSuggestions: rankedEventSuggestions,
    templates: deriveTemplates(rankedPageSuggestions, rankedEventSuggestions),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const range = normalizeRange(searchParams.get("range") ?? "30d");

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      const [definitions, sitePages] = await Promise.all([
        listFunnelDefinitions(site.id),
        listSitePages(site.id),
      ]);
      let analyticsCatalog: AnalyticsCatalog = { pages: [], events: [] };
      if (analyticsProxyEnabled()) {
        try {
          analyticsCatalog = await withAnalyticsTokenFallback((token) => loadAnalyticsCatalog(site.id, { range, token }));
        } catch {
          analyticsCatalog = { pages: [], events: [] };
        }
      }

      const payload: FunnelCatalogResponse = {
        ...buildCatalog(definitions, sitePages, analyticsCatalog),
        canPersist: true,
      };

      return Response.json(payload);
    } catch (error) {
      const status =
        error instanceof Error && error.message === "Authentication required."
          ? 401
          : 400;
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to load funnels." },
        { status },
      );
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  const analyticsCatalog = await loadAnalyticsCatalog(requestedSiteId, { range, token });
  const payload: FunnelCatalogResponse = buildCatalog([], [], analyticsCatalog);
  return Response.json(payload);
}

export async function POST(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Saved funnels require the control plane database." }, { status: 404 });
  }
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  try {
    const session = await requireCurrentSession();
    const site = await requireUserSite(session.user.id, requestedSiteId);
    const payload = (await request.json().catch(() => ({}))) as Partial<FunnelDefinitionInput>;
    const definition = await createFunnelDefinition(site.id, {
      name: payload.name ?? "",
      countMode: payload.countMode === "sessions" ? "sessions" : "visitors",
      windowMinutes: Number(payload.windowMinutes ?? 30),
      steps: Array.isArray(payload.steps) ? payload.steps : [],
    });

    return Response.json(definition, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create funnel." },
      { status: 400 },
    );
  }
}
