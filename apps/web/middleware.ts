import { NextResponse, type NextRequest } from "next/server";

import { AUTH_SESSION_COOKIE, DASHBOARD_TOKEN_COOKIE, PROTECTED_ROUTES } from "@/lib/session";

function isProtectedPath(pathname: string) {
  return PROTECTED_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasControlPlaneSession = Boolean(request.cookies.get(AUTH_SESSION_COOKIE)?.value);
  const hasDashboardToken = Boolean(request.cookies.get(DASHBOARD_TOKEN_COOKIE)?.value);
  const hasSession = hasControlPlaneSession || hasDashboardToken;

  if (pathname.startsWith("/auth") && hasDashboardToken) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  if (isProtectedPath(pathname) && !hasSession) {
    const redirectUrl = new URL("/auth/sign-in", request.url);
    redirectUrl.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/auth/:path*", "/dashboard/:path*", "/funnels/:path*", "/heatmaps/:path*", "/session-replay/:path*", "/ai-insight/:path*", "/settings/:path*"],
};
