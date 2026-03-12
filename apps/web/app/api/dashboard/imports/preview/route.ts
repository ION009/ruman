import { requireCurrentSession, requireSiteMutationAccess } from "@/lib/control-plane/auth";
import { validateRequestCSRF } from "@/lib/csrf/server";
import {
  analyticsProxyEnabled,
  previewDashboardImport,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

import { readDashboardImportPayload } from "../_payload";

export async function POST(request: Request) {
  if (!isControlPlaneEnabled()) {
    return Response.json({ error: "Imports require the control plane database." }, { status: 404 });
  }

  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  try {
    const session = await requireCurrentSession();
    const url = new URL(request.url);
    const siteId = url.searchParams.get("site") ?? "";
    await requireSiteMutationAccess(session.user.id, siteId);

    if (!analyticsProxyEnabled()) {
      return Response.json({ error: "Analytics proxy is not configured." }, { status: 503 });
    }

    const payload = await readDashboardImportPayload(request);
    const preview = await withAnalyticsTokenFallback((token) => previewDashboardImport(siteId, payload, token));
    return Response.json(preview);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to preview import file." },
      { status: 400 },
    );
  }
}
