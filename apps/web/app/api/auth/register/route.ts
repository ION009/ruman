import { NextRequest, NextResponse } from "next/server";

import { registerAccount } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { isControlPlaneEnabled } from "@/lib/session";

function sanitizeNextPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/dashboard";
  }
  return trimmed || "/dashboard";
}

export async function POST(request: NextRequest) {
  if (!isControlPlaneEnabled()) {
    return NextResponse.json({ error: "Account registration is not enabled in this environment." }, { status: 404 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let email = "";
  let password = "";
  let fullName = "";
  let siteName = "";
  let origin = "";
  let domain = "";
  let next = "/dashboard";

  if (contentType.includes("application/json")) {
    const payload = (await request.json().catch(() => ({}))) as {
      email?: string;
      password?: string;
      fullName?: string;
      siteName?: string;
      origin?: string;
      domain?: string;
      next?: string;
    };
    email = payload.email ?? "";
    password = payload.password ?? "";
    fullName = payload.fullName ?? "";
    siteName = payload.siteName ?? "";
    origin = payload.origin ?? payload.domain ?? "";
    domain = payload.domain ?? "";
    next = sanitizeNextPath(payload.next ?? "");
  } else {
    const form = await request.formData().catch(() => new FormData());
    email = form.get("email")?.toString() ?? "";
    password = form.get("password")?.toString() ?? "";
    fullName = form.get("fullName")?.toString() ?? "";
    siteName = form.get("siteName")?.toString() ?? "";
    origin = form.get("origin")?.toString() ?? form.get("domain")?.toString() ?? "";
    domain = form.get("domain")?.toString() ?? "";
    next = sanitizeNextPath(form.get("next")?.toString() ?? "");
  }

  try {
    const result = await registerAccount({
      email,
      password,
      fullName,
      site: {
        name: siteName,
        origin,
        domain,
      },
      requestOrigin: new URL(request.url).origin,
    });

    return NextResponse.json({ ok: true, next, ...result });
  } catch (error) {
    if (isControlPlaneConnectionError(error)) {
      return NextResponse.json(
        { error: "Account registration is temporarily unavailable because the control plane database is unreachable." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to register account." },
      { status: 400 },
    );
  }
}
