import { SharedDashboardClient } from "./shared-dashboard-client";

export default async function SharedDashboardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <SharedDashboardClient slug={slug} />;
}
