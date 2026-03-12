import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { buildGoalReport } from "@/lib/control-plane/goal-report";
import { listGoals } from "@/lib/control-plane/goals";
import { analyticsProxyEnabled, getDashboardExportEventsData, withAnalyticsTokenFallback } from "@/lib/dashboard/server";
import type { GoalReportResponse, RangeKey } from "@/lib/dashboard/types";
import { isControlPlaneEnabled } from "@/lib/session";

function normalizeRange(value: string): RangeKey {
  return (value?.trim() || "7d") as RangeKey;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";
  const range = normalizeRange(searchParams.get("range") ?? "7d");

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      const goals = await listGoals(site.id);
      if (!goals.length) {
        return Response.json({ range, goals: [] satisfies GoalReportResponse["goals"] });
      }

      let report = buildGoalReport(goals, [], range);
      if (analyticsProxyEnabled()) {
        try {
          const events = await withAnalyticsTokenFallback((token) => getDashboardExportEventsData(site.id, range, token));
          report = buildGoalReport(goals, events, range);
        } catch {
          report = buildGoalReport(goals, [], range);
        }
      }

      return Response.json(report);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "Failed to load goal report." }, { status: 400 });
    }
  }

  void requestedSiteId;
  return Response.json({ range, goals: [] satisfies GoalReportResponse["goals"] });
}
