import { requireCurrentSession, requireUserSite } from "@/lib/control-plane/auth";
import { listNeoThread, rollbackNeoThreadToMessage } from "@/lib/control-plane/neo-chat";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { validateRequestCSRF } from "@/lib/csrf/server";
import { readDashboardToken } from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const requestedSiteId = searchParams.get("site") ?? "";

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      return Response.json(await listNeoThread(site.id, session.user.id));
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Failed to load Neo history." },
          { status: 400 },
        );
      }
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  return Response.json({
    threadId: null,
    canPersist: false,
    messages: [],
  });
}

export async function POST(request: Request) {
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return Response.json({ error: csrf.error }, { status: 403 });
  }

  const payload = (await request.json().catch(() => ({}))) as {
    siteId?: string;
    messageId?: string;
  };
  const requestedSiteId = (payload.siteId ?? "").trim();
  const messageId = (payload.messageId ?? "").trim();

  if (!requestedSiteId || !messageId) {
    return Response.json({ error: "Site and message are required." }, { status: 400 });
  }

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const site = await requireUserSite(session.user.id, requestedSiteId);
      return Response.json(await rollbackNeoThreadToMessage(site.id, session.user.id, messageId));
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        return Response.json(
          { error: error instanceof Error ? error.message : "Failed to roll back Neo history." },
          { status: 400 },
        );
      }
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    return Response.json({ error: "Dashboard session required." }, { status: 401 });
  }

  return Response.json({ error: "Neo history rollback is unavailable in this session." }, { status: 400 });
}
