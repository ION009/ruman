import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

import { createEmailPasswordSession } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { verifyDashboardToken } from "@/lib/dashboard/server";
import {
  AUTH_SESSION_COOKIE,
  DASHBOARD_TOKEN_COOKIE,
  isControlPlaneEnabled,
} from "@/lib/session";

function sanitizeNextPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/dashboard";
  }
  return trimmed || "/dashboard";
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  let email = "";
  let password = "";
  let token = "";
  let next = "/dashboard";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as {
      token?: string;
      email?: string;
      password?: string;
      next?: string;
    };
    email = (payload.email ?? "").trim();
    password = payload.password ?? "";
    token = (payload.token ?? "").trim();
    next = sanitizeNextPath(payload.next ?? "");
  } else {
    const form = await request.formData().catch(() => new FormData());
    email = form.get("email")?.toString().trim() ?? "";
    password = form.get("password")?.toString() ?? "";
    token = form.get("token")?.toString().trim() ?? "";
    next = sanitizeNextPath(form.get("next")?.toString() ?? "");
  }

  if (isControlPlaneEnabled() && (email || password)) {
    try {
      const viewer = await createEmailPasswordSession({
        email,
        password,
      });

      const cookieStore = await cookies();
      cookieStore.delete(DASHBOARD_TOKEN_COOKIE);

      return NextResponse.json({ ok: true, viewer, next });
    } catch (error) {
      if (isControlPlaneConnectionError(error) && token) {
        // Fall through to token mode when control-plane connectivity is down.
      } else {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : "Failed to create session." },
          { status: 401 },
        );
      }
    }
  }

  if (!token) {
    if (isControlPlaneEnabled() && (email || password)) {
      return NextResponse.json(
        { error: "Account sign-in is temporarily unavailable because the control plane database is unreachable." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Enter your dashboard token." }, { status: 400 });
  }

  const valid = await verifyDashboardToken(token.trim());
  if (!valid) {
    return NextResponse.json({ error: "Dashboard token rejected." }, { status: 401 });
  }

  const cookieStore = await cookies();
  cookieStore.delete(AUTH_SESSION_COOKIE);
  cookieStore.set(DASHBOARD_TOKEN_COOKIE, token.trim(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 14,
  });

  return NextResponse.json({ ok: true, next });
}
