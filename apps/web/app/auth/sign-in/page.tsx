import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import { getCurrentSession } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { readDashboardToken } from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

function sanitizeNextPath(value: string | undefined) {
  const trimmed = (value ?? "").trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "/dashboard";
  }
  return trimmed || "/dashboard";
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = sanitizeNextPath(params.next);

  if (isControlPlaneEnabled()) {
    try {
      const session = await getCurrentSession();
      if (session) {
        redirect(nextPath);
      }
      return <SignInForm nextPath={nextPath} authMode="account" />;
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        throw error;
      }
      return <SignInForm nextPath={nextPath} authMode="account" />;
    }
  }

  const token = await readDashboardToken();
  if (token) {
    redirect(nextPath);
  }

  return <SignInForm nextPath={nextPath} authMode="token" />;
}
