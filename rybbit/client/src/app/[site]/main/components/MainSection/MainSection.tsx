"use client";
import { Card, CardContent, CardLoader } from "@/components/ui/card";
import { useExtracted } from "next-intl";
import Link from "next/link";
import { useGetOverview } from "../../../../../api/analytics/hooks/useGetOverview";
import { useGetOverviewBucketed } from "../../../../../api/analytics/hooks/useGetOverviewBucketed";
import { BucketSelection } from "../../../../../components/BucketSelection";
import { RybbitTextLogo } from "../../../../../components/RybbitLogo";
import { useWhiteLabel } from "../../../../../hooks/useIsWhiteLabel";
import { authClient } from "../../../../../lib/auth";
import { useStore } from "../../../../../lib/store";
import { Chart } from "./Chart";
import { Overview } from "./Overview";
import { PreviousChart } from "./PreviousChart";

export function MainSection() {
  const { isWhiteLabel } = useWhiteLabel();
  const session = authClient.useSession();
  const t = useExtracted();

  const { selectedStat, time, site, bucket } = useStore();

  const getSelectedStatLabel = () => {
    switch (selectedStat) {
      case "pageviews": return t("Pageviews");
      case "sessions": return t("Sessions");
      case "pages_per_session": return t("Pages per Session");
      case "bounce_rate": return t("Bounce Rate");
      case "session_duration": return t("Session Duration");
      case "users": return t("Users");
      default: return selectedStat;
    }
  };

  // Current period data
  const { data, isFetching, error } = useGetOverviewBucketed({
    site,
    bucket,
  });

  // Previous period data
  const {
    data: previousData,
    isFetching: isPreviousFetching,
    error: previousError,
  } = useGetOverviewBucketed({
    periodTime: "previous",
    site,
    bucket,
  });

  const { isFetching: isOverviewFetching } = useGetOverview({ site });
  const { isFetching: isOverviewFetchingPrevious } = useGetOverview({
    site,
    periodTime: "previous",
  });

  const maxOfDataAndPreviousData = Math.max(
    Math.max(...(data?.data?.map((d: any) => d[selectedStat]) ?? [])),
    Math.max(...(previousData?.data?.map((d: any) => d[selectedStat]) ?? []))
  );

  return (
    <div className="space-y-3">
      {/* Chart on top */}
      <Card>
        {(isFetching || isPreviousFetching) && <CardLoader />}
        <CardContent className="p-2 md:p-4 py-3 w-full">
          <div className="flex items-center justify-between px-2 md:px-0">
            <div className="flex items-center space-x-4">
              {!isWhiteLabel && (
                <Link
                  href={session.data ? "/" : "https://rybbit.com"}
                  className="opacity-75"
                >
                  <RybbitTextLogo width={80} height={0} />
                </Link>
              )}
            </div>
            <span className="text-sm text-neutral-700 dark:text-neutral-200">{getSelectedStatLabel()}</span>
            <BucketSelection />
          </div>
          <div className="h-[200px] md:h-[290px] relative">
            <div className="absolute top-0 left-0 w-full h-full">
              <PreviousChart data={previousData} max={maxOfDataAndPreviousData} />
            </div>
            <div className="absolute top-0 left-0 w-full h-full">
              <Chart
                data={data}
                max={maxOfDataAndPreviousData}
                previousData={time.mode === "all-time" ? undefined : previousData}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stat cards below in a unified bordered container */}
      <div className="rounded-lg border border-neutral-100 dark:border-neutral-850 bg-white dark:bg-neutral-900 overflow-hidden relative">
        {(isOverviewFetching || isOverviewFetchingPrevious) && <CardLoader />}
        <Overview />
      </div>
    </div>
  );
}
