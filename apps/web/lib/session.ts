export const DASHBOARD_TOKEN_COOKIE = "anlticsheat-dashboard-token";
export const AUTH_SESSION_COOKIE = "anlticsheat-session";
export const DEFAULT_DASHBOARD_TOKEN =
  process.env.ANLTICSHEAT_DASHBOARD_TOKEN ??
  process.env.ANLTICSHEAT_ANALYTICS_SERVICE_TOKEN ??
  "demo-dashboard-token";
export const PROTECTED_ROUTES = ["/dashboard", "/funnels", "/heatmaps", "/session-replay", "/ai-insight", "/settings"];

export function isControlPlaneEnabled() {
  return Boolean(process.env.ANLTICSHEAT_NEON_DATABASE_URL || process.env.DATABASE_URL);
}
