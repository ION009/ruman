import type {
  DashboardExportEvent,
  GoalDefinition,
  GoalReportItem,
  GoalReportResponse,
  GoalState,
  GoalType,
  RangeKey,
} from "@/lib/dashboard/types";

type GoalBucketConfig = {
  count: number;
  stepMs: number;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function buildGoalReport(
  goals: GoalDefinition[],
  events: DashboardExportEvent[],
  range: RangeKey,
  now = new Date(),
): GoalReportResponse {
  if (!goals.length) {
    return { range, goals: [] };
  }

  const orderedEvents = [...events]
    .map(normalizeExportEvent)
    .filter((event): event is NormalizedExportEvent => event !== null)
    .sort((left, right) => left.timestampMs - right.timestampMs);

  const sessionIds = new Set<string>();
  for (const event of orderedEvents) {
    if (event.name === "pageview" || sessionIds.size === 0) {
      sessionIds.add(event.sessionId);
    }
  }

  const bucketConfig = goalBucketConfig(range, now);
  const bucketStarts = goalBucketStarts(range, now, bucketConfig);

  return {
    range,
    goals: goals.map((goal) => {
      const matchedSessions = new Map<string, number>();
      let lastConvertedAt: string | null = null;

      for (const event of orderedEvents) {
        if (!matchesGoal(goal, event)) {
          continue;
        }
        if (!matchedSessions.has(event.sessionId)) {
          matchedSessions.set(event.sessionId, event.timestampMs);
        }
        lastConvertedAt = event.timestamp;
      }

      const sparkline = bucketStarts.map((start) => ({
        timestamp: new Date(start).toISOString(),
        conversions: 0,
      }));
      for (const convertedAt of matchedSessions.values()) {
        const bucketIndex = Math.floor((convertedAt - bucketStarts[0]) / bucketConfig.stepMs);
        if (bucketIndex >= 0 && bucketIndex < sparkline.length) {
          sparkline[bucketIndex].conversions += 1;
        }
      }

      const conversions = matchedSessions.size;
      return {
        ...goal,
        conversions,
        conversionRate: percentage(conversions, sessionIds.size),
        state: goalState(conversions),
        sparkline,
        lastConvertedAt,
      } satisfies GoalReportItem;
    }),
  };
}

type NormalizedExportEvent = {
  timestamp: string;
  timestampMs: number;
  name: string;
  path: string;
  sessionId: string;
};

function normalizeExportEvent(event: DashboardExportEvent): NormalizedExportEvent | null {
  const timestampMs = Date.parse(event.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  const sessionId = String(event.sessionId ?? "").trim();
  if (!sessionId) {
    return null;
  }

  return {
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    name: normalizeEventName(event.name),
    path: normalizePath(event.path),
    sessionId,
  };
}

function matchesGoal(goal: GoalDefinition, event: NormalizedExportEvent) {
  if (goal.type === "pageview") {
    if (event.name !== "pageview") {
      return false;
    }
    return matchesValue(goal.value, event.path, goal.match);
  }

  if (event.name === "pageview") {
    return false;
  }
  return matchesValue(goal.value, event.name, goal.match, goal.type);
}

function matchesValue(expected: string, actual: string, match: GoalDefinition["match"], type: GoalType = "pageview") {
  const normalizedExpected = type === "pageview" ? normalizePath(expected) : normalizeEventName(expected);
  const normalizedActual = type === "pageview" ? normalizePath(actual) : normalizeEventName(actual);
  switch (match) {
    case "prefix":
      return normalizedActual.startsWith(normalizedExpected);
    case "contains":
      return normalizedActual.includes(normalizedExpected);
    default:
      return normalizedActual === normalizedExpected;
  }
}

function normalizeEventName(value: string) {
  let normalized = String(value ?? "").trim().toLowerCase();
  normalized = normalized.replace(/[\s\-/:]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  switch (normalized) {
    case "page_view":
    case "screen_view":
      return "pageview";
    case "routechange":
    case "route_change_complete":
      return "route_change";
    case "deadclick":
      return "dead_click";
    case "rageclick":
      return "rage_click";
    default:
      return normalized;
  }
}

function normalizePath(value: string) {
  const trimmed = String(value ?? "").trim();
  return trimmed || "/";
}

function goalState(conversions: number): GoalState {
  if (conversions <= 0) {
    return "stale";
  }
  if (conversions < 3) {
    return "low-volume";
  }
  return "active";
}

function percentage(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((numerator / denominator) * 1000) / 10;
}

function goalBucketConfig(range: RangeKey, now: Date): GoalBucketConfig {
  if (range === "24h") {
    return { count: 24, stepMs: HOUR_MS };
  }
  if (range.startsWith("custom:")) {
    const [from, to] = parseCustomRange(range);
    if (from && to && to.getTime()-from.getTime() <= 48 * HOUR_MS) {
      return { count: Math.max(1, Math.ceil((to.getTime() - from.getTime() + 1) / HOUR_MS)), stepMs: HOUR_MS };
    }
    if (from && to) {
      return { count: Math.max(1, Math.ceil((to.getTime() - from.getTime() + 1) / DAY_MS)), stepMs: DAY_MS };
    }
  }
  if (range === "30d") {
    return { count: 30, stepMs: DAY_MS };
  }
  void now;
  return { count: 7, stepMs: DAY_MS };
}

function goalBucketStarts(range: RangeKey, now: Date, config: GoalBucketConfig) {
  if (range === "24h") {
    const end = floorToHour(now);
    const start = end.getTime() - (config.count - 1) * config.stepMs;
    return Array.from({ length: config.count }, (_, index) => start + index * config.stepMs);
  }
  if (range.startsWith("custom:")) {
    const [from] = parseCustomRange(range);
    if (from) {
      const start = config.stepMs === HOUR_MS ? floorToHour(from).getTime() : floorToDay(from).getTime();
      return Array.from({ length: config.count }, (_, index) => start + index * config.stepMs);
    }
  }

  const end = floorToDay(now);
  const start = end.getTime() - (config.count - 1) * config.stepMs;
  return Array.from({ length: config.count }, (_, index) => start + index * config.stepMs);
}

function parseCustomRange(range: RangeKey): [Date | null, Date | null] {
  if (!range.startsWith("custom:")) {
    return [null, null];
  }
  const [, fromRaw, toRaw] = range.split(":");
  if (!fromRaw || !toRaw) {
    return [null, null];
  }
  const from = new Date(`${fromRaw}T00:00:00.000Z`);
  const to = new Date(`${toRaw}T23:59:59.999Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return [null, null];
  }
  return [from, to];
}

function floorToHour(date: Date) {
  return new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0,
  ));
}

function floorToDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}
