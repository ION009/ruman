import { neon } from "@neondatabase/serverless";

function databaseUrl() {
  return process.env.ANLTICSHEAT_NEON_DATABASE_URL || process.env.DATABASE_URL || "";
}

export function getControlPlaneSql() {
  const connectionString = databaseUrl();
  if (!connectionString) {
    throw new Error("Control plane database is not configured.");
  }

  return neon(connectionString);
}

export function isControlPlaneConnectionError(error: unknown, depth = 0): boolean {
  if (depth > 4 || error == null || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
    cause?: unknown;
    sourceError?: unknown;
  };

  const name = String(candidate.name ?? "").toLowerCase();
  const code = String(candidate.code ?? "").toUpperCase();
  const message = String(candidate.message ?? "").toLowerCase();

  if (name.includes("neondberror")) {
    return true;
  }
  if (["ENOTFOUND", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT"].includes(code)) {
    return true;
  }
  if (
    message.includes("error connecting to database") ||
    message.includes("fetch failed") ||
    message.includes("getaddrinfo") ||
    message.includes("enotfound") ||
    message.includes("connection refused") ||
    message.includes("timed out")
  ) {
    return true;
  }

  return (
    isControlPlaneConnectionError(candidate.cause, depth + 1) ||
    isControlPlaneConnectionError(candidate.sourceError, depth + 1)
  );
}
