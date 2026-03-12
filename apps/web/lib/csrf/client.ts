import { CSRF_HEADER_NAME } from "@/lib/csrf/shared";

let currentCSRFToken = "";

function mergeHeaders(input?: HeadersInit) {
  const headers = new Headers(input ?? {});
  if (currentCSRFToken) {
    headers.set(CSRF_HEADER_NAME, currentCSRFToken);
  }
  return headers;
}

export function setClientCSRFToken(token: string | null | undefined) {
  currentCSRFToken = (token ?? "").trim();
}

export function getClientCSRFToken() {
  return currentCSRFToken;
}

export function withClientCSRFHeaders(input?: HeadersInit) {
  return mergeHeaders(input);
}
