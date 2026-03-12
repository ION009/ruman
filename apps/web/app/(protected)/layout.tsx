import { redirect } from "next/navigation";

import { DashboardChrome } from "@/components/dashboard/dashboard-chrome";
import { getCurrentSession } from "@/lib/control-plane/auth";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { readDashboardToken } from "@/lib/dashboard/server";
import { isControlPlaneEnabled } from "@/lib/session";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  if (isControlPlaneEnabled()) {
    try {
      const session = await getCurrentSession();
      if (session) {
        return <DashboardChrome>{children}</DashboardChrome>;
      }
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        throw error;
      }
    }

    const token = await readDashboardToken();
    if (!token) {
      redirect("/auth/sign-in");
    }
  } else {
    const token = await readDashboardToken();
    if (!token) {
      redirect("/auth/sign-in");
    }
  }

  return <DashboardChrome>{children}</DashboardChrome>;
}
