import { NextResponse } from "next/server";

import { deleteCurrentSession } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { AUTH_SESSION_COOKIE, DASHBOARD_TOKEN_COOKIE, isControlPlaneEnabled } from "@/lib/session";
import { cookies } from "next/headers";

export async function POST() {
  if (isControlPlaneEnabled()) {
    try {
      await deleteCurrentSession();
      return NextResponse.json({ ok: true });
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        throw error;
      }
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete(DASHBOARD_TOKEN_COOKIE);
  cookieStore.delete(AUTH_SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
