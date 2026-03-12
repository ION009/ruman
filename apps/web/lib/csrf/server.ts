import { createHmac, timingSafeEqual } from "node:crypto";

import { DASHBOARD_TOKEN_COOKIE, AUTH_SESSION_COOKIE } from "@/lib/session";
import { CSRF_HEADER_NAME } from "@/lib/csrf/shared";

const CSRF_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

type CSRFCookieValues = {
  authSession?: string;
  dashboardToken?: string;
};

type ParsedCSRFToken = {
  issuedAtMs: number;
  signature: string;
};

function csrfSecret() {
  return (
    process.env.ANLTICSHEAT_CSRF_SECRET ||
    process.env.ANLTICSHEAT_ADMIN_TOKEN ||
    process.env.ANLTICSHEAT_ANALYTICS_SERVICE_TOKEN ||
    process.env.ANLTICSHEAT_DASHBOARD_TOKEN ||
    "anlticsheat-csrf-dev-secret"
  );
}

function normalizeCookieValue(value: string | undefined) {
  return (value ?? "").trim();
}

function csrfSeed(values: CSRFCookieValues) {
  return normalizeCookieValue(values.authSession) || normalizeCookieValue(values.dashboardToken);
}

function signCSRF(seed: string, issuedAtMs: number) {
  return createHmac("sha256", csrfSecret())
    .update(`${seed}:${issuedAtMs}`)
    .digest("base64url");
}

function parseCSRFCookies(cookieHeader: string | null): CSRFCookieValues {
  if (!cookieHeader) {
    return {};
  }

  const values: CSRFCookieValues = {};
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rest] = part.split("=");
    const name = rawName?.trim();
    if (!name) {
      continue;
    }

    const value = rest.join("=").trim();
    if (name === AUTH_SESSION_COOKIE) {
      values.authSession = value;
    } else if (name === DASHBOARD_TOKEN_COOKIE) {
      values.dashboardToken = value;
    }
  }

  return values;
}

function parseCSRFToken(value: string): ParsedCSRFToken | null {
  const [issuedAtRaw, signature = ""] = value.trim().split(".", 2);
  if (!issuedAtRaw || !signature) {
    return null;
  }

  const issuedAtMs = Number.parseInt(issuedAtRaw, 10);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }

  return { issuedAtMs, signature };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function requestOriginMatches(request: Request) {
  let targetOrigin = "";
  try {
    targetOrigin = new URL(request.url).origin;
  } catch {
    return false;
  }

  const originHeader = (request.headers.get("origin") ?? "").trim();
  if (originHeader) {
    return originHeader === targetOrigin;
  }

  const refererHeader = (request.headers.get("referer") ?? "").trim();
  if (refererHeader) {
    try {
      return new URL(refererHeader).origin === targetOrigin;
    } catch {
      return false;
    }
  }

  const fetchSite = (request.headers.get("sec-fetch-site") ?? "").trim().toLowerCase();
  return fetchSite === "same-origin" || fetchSite === "same-site";
}

export function issueCSRFToken(values: CSRFCookieValues) {
  const seed = csrfSeed(values);
  if (!seed) {
    return "";
  }

  const issuedAtMs = Date.now();
  return `${issuedAtMs}.${signCSRF(seed, issuedAtMs)}`;
}

export function validateRequestCSRF(request: Request) {
  const cookies = parseCSRFCookies(request.headers.get("cookie"));
  const seeds = [normalizeCookieValue(cookies.authSession), normalizeCookieValue(cookies.dashboardToken)].filter(Boolean);
  if (!seeds.length) {
    return { ok: false, error: "CSRF validation requires an authenticated cookie." } as const;
  }

  const providedToken = request.headers.get(CSRF_HEADER_NAME) ?? "";
  const parsed = parseCSRFToken(providedToken);
  if (parsed) {
    const ageMs = Math.abs(Date.now() - parsed.issuedAtMs);
    if (ageMs > CSRF_TOKEN_TTL_MS) {
      return { ok: false, error: "CSRF token expired." } as const;
    }

    for (const seed of seeds) {
      if (safeEqual(parsed.signature, signCSRF(seed, parsed.issuedAtMs))) {
        return { ok: true } as const;
      }
    }
  }

  if (requestOriginMatches(request)) {
    return { ok: true } as const;
  }

  if (!parsed) {
    return { ok: false, error: "Missing or invalid CSRF token." } as const;
  }

  return { ok: false, error: "CSRF token mismatch." } as const;
}
