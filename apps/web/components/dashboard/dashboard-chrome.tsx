"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Clapperboard,
  Flame,
  GitBranchPlus,
  Globe,
  Goal,
  LayoutDashboard,
  LogOut,
  Menu,
  Plug,
  Radio,
  RefreshCcw,
  Repeat,
  Route,
  ScanSearch,
  Settings2,
  Sparkles,
  UserCircle,
  Users2,
  Waves,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useEffect } from "react";

import { DateRangePicker } from "@/components/dashboard/date-range-picker";
import { NeoPanel } from "@/components/dashboard/neo-panel";
import { ThemeToggle } from "@/components/dashboard/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardContext } from "@/hooks/use-dashboard";
import type { DashboardSite, RangeKey } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ------------------------------------------------------------------ */
/*  Navigation — flat list, subtle group spacing                       */
/* ------------------------------------------------------------------ */

type NavItem = {
  href: string;
  label: string;
  title?: string;
  icon: React.ComponentType<{ className?: string }>;
  group: number;
};

const navigation: NavItem[] = [
  { href: "/dashboard", label: "Main", title: "Main", icon: LayoutDashboard, group: 0 },
  { href: "/map", label: "Realtime", title: "Realtime Geo", icon: Globe, group: 0 },
  { href: "/events", label: "Events", title: "Events", icon: ScanSearch, group: 1 },
  { href: "/goals", label: "Goals", icon: Goal, group: 1 },
  { href: "/heatmaps", label: "Heatmaps", icon: Flame, group: 1 },
  { href: "/session-replay", label: "Replay", title: "Replay", icon: Clapperboard, group: 1 },
  { href: "/funnels", label: "Funnels", icon: GitBranchPlus, group: 2 },
  { href: "/journeys", label: "Journeys", icon: Route, group: 2 },
  { href: "/retention", label: "Retention", icon: Repeat, group: 2 },
  { href: "/ai-insight", label: "Insights", title: "AI Insights", icon: Sparkles, group: 3 },
  { href: "/users", label: "Users", icon: Users2, group: 4 },
  { href: "/cohorts", label: "Segments", title: "Segments", icon: Radio, group: 4 },
  { href: "/alerts", label: "Alerts", icon: AlertTriangle, group: 5 },
  { href: "/integrations", label: "Integrations", title: "Integrations", icon: Plug, group: 5 },
  { href: "/settings", label: "Site Settings", title: "Site Settings", icon: Settings2, group: 5 },
];

const pageTitles: Record<string, string> = Object.fromEntries([
  ...navigation.map((i) => [i.href, i.title ?? i.label]),
  ["/ai-analysis", "AI Analysis"],
  ["/errors", "Errors"],
  ["/performance", "Performance"],
  ["/sites", "Sites"],
  ["/reports", "Reports"],
]);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatSyncTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp || Date.now());
}

function labelForSite(site: DashboardSite) {
  if (site.name && site.name.trim() && site.name !== site.id) {
    return site.name;
  }
  const origin = site.origins?.[0] ?? "";
  if (origin) {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return origin;
    }
  }
  return site.name || site.id;
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function DashboardSkeleton() {
  return (
    <div className="flex h-screen">
      <div className="hidden w-[264px] border-r border-border/60 lg:block" />
      <div className="flex-1 p-6">
        <Skeleton className="h-14 rounded-2xl" />
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-28 rounded-2xl" />
        </div>
        <Skeleton className="mt-6 h-[380px] rounded-2xl" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const contextQuery = useDashboardContext();
  const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
  const setSelectedSiteId = useDashboardStore((s) => s.setSelectedSiteId);
  const viewer = contextQuery.data?.viewer;

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/sign-in");
    router.refresh();
  }

  return (
    <div className="flex h-full flex-col bg-surface-secondary">
      {/* Header: logo + site selector */}
      <div className="border-b border-border/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
            <Waves className="size-3.5" />
          </div>

          {contextQuery.data && contextQuery.data.sites.length > 0 ? (
            <div className="min-w-0 flex-1">
              <Select value={selectedSiteId} onValueChange={setSelectedSiteId}>
                <SelectTrigger className="h-8 w-full rounded-xl border-border/50 bg-surface-primary px-2.5 text-[12px] font-medium shadow-none">
                  <div className="flex items-center gap-2 truncate">
                    <Globe className="size-3 shrink-0 text-primary" />
                    <SelectValue placeholder="Select site" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  {contextQuery.data.sites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {labelForSite(site)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <p className="min-w-0 flex-1 truncate text-[12px] font-semibold tracking-tight text-foreground">
              AnlticsHeat
            </p>
          )}
        </div>
      </div>

      {/* Flat navigation */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3">
        <div className="space-y-0.5">
          {navigation.map((item, i) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            const prevGroup = i > 0 ? navigation[i - 1].group : item.group;
            const showSpacer = item.group !== prevGroup;
            return (
              <Fragment key={item.href}>
                {showSpacer && <div className="my-2" />}
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] font-medium transition-colors",
                    active
                      ? "bg-surface-sidebar-active text-foreground"
                      : "text-foreground/64 hover:bg-surface-sidebar-hover hover:text-foreground",
                  )}
                >
                  <Icon
                    className={cn(
                      "size-[15px] shrink-0",
                      active
                        ? "text-foreground/80"
                        : "text-foreground/44 group-hover:text-foreground/68",
                    )}
                  />
                  <span className="flex-1 truncate">{item.label}</span>
                </Link>
              </Fragment>
            );
          })}
        </div>
      </nav>

      {/* Utility panel */}
      <div className="border-t border-border/40 px-3 py-2.5">
        {viewer && (
          <div className="mb-1 flex items-center gap-2.5 rounded-xl px-3 py-1.5">
            <UserCircle className="size-[15px] shrink-0 text-foreground/40" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-medium text-foreground/68">
                {viewer.fullName || viewer.email}
              </p>
            </div>
          </div>
        )}
        <ThemeToggle />
        <button
          type="button"
          onClick={signOut}
          className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-1.5 text-[13px] font-medium text-foreground/52 transition-colors hover:bg-surface-sidebar-hover hover:text-foreground"
        >
          <LogOut className="size-[15px] shrink-0 text-foreground/36 group-hover:text-foreground/60" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top bar                                                            */
/* ------------------------------------------------------------------ */

function TopBar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const contextQuery = useDashboardContext();
  const selectedRange = useDashboardStore((s) => s.selectedRange);
  const setSelectedRange = useDashboardStore((s) => s.setSelectedRange);
  const toggleNav = useDashboardStore((s) => s.toggleNav);
  const isNeoOpen = useDashboardStore((s) => s.isNeoOpen);
  const toggleNeo = useDashboardStore((s) => s.toggleNeo);

  const title = pageTitles[pathname] ?? "Dashboard";
  const syncLabel = contextQuery.isFetching
    ? "Syncing..."
    : `Synced ${formatSyncTime(contextQuery.dataUpdatedAt)}`;

  return (
    <div className="section-frame sticky top-0 z-30 rounded-2xl border-border/50 px-4 py-3 sm:px-5">
      <div className="flex items-center justify-between gap-4">
        {/* Left: mobile menu + title */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl lg:hidden"
            onClick={toggleNav}
          >
            <Menu className="size-5" />
          </Button>

          <div>
            <h1 className="text-lg font-semibold tracking-tight sm:text-xl">
              {title}
            </h1>
            <p className="hidden text-[11px] text-muted-foreground sm:block">
              {syncLabel}
            </p>
          </div>
        </div>

        {/* Right: controls + Neo button */}
        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <Select
              value={selectedRange}
              onValueChange={(v) => setSelectedRange(v as RangeKey)}
            >
              <SelectTrigger className="h-9 w-[90px] rounded-xl text-xs">
                <SelectValue placeholder="Range" />
              </SelectTrigger>
              <SelectContent>
                {(contextQuery.data?.ranges ?? ["24h", "7d", "30d", "90d"]).map(
                  (range) => (
                    <SelectItem key={range} value={range}>
                      {range.toUpperCase()}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden md:block">
            <DateRangePicker />
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="rounded-xl"
            onClick={() =>
              queryClient.invalidateQueries({ queryKey: ["dashboard"] })
            }
          >
            <RefreshCcw className="size-4" />
          </Button>

          {/* Neo AI Button */}
          <button
            type="button"
            onClick={toggleNeo}
            className="neo-btn"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <circle cx="7" cy="1.5" r="1.4" fill="currentColor"/>
              <circle cx="1.5" cy="11" r="1.4" fill="currentColor"/>
              <circle cx="12.5" cy="11" r="1.4" fill="currentColor"/>
              <circle cx="7" cy="7" r="1.8" fill="currentColor" fillOpacity="0.55"/>
              <line x1="7" y1="2.9" x2="7" y2="5.3" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round"/>
              <line x1="2.6" y1="10.2" x2="5.4" y2="8" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round"/>
              <line x1="11.4" y1="10.2" x2="8.6" y2="8" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round"/>
              <line x1="2.9" y1="11" x2="11.1" y2="11" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" strokeOpacity="0.45"/>
            </svg>
            Ask Neo
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main shell                                                         */
/* ------------------------------------------------------------------ */

export function DashboardChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const contextQuery = useDashboardContext();
  const isNavOpen = useDashboardStore((s) => s.isNavOpen);
  const closeNav = useDashboardStore((s) => s.closeNav);
  const isNeoOpen = useDashboardStore((s) => s.isNeoOpen);
  const closeNeo = useDashboardStore((s) => s.closeNeo);

  useEffect(() => {
    closeNav();
  }, [pathname, closeNav]);

  if (contextQuery.isLoading && !contextQuery.data) {
    return <DashboardSkeleton />;
  }

  if (contextQuery.error || !contextQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="section-frame w-full max-w-md rounded-2xl p-8 text-center">
          <Waves className="mx-auto size-8 text-primary" />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">
            Dashboard unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {contextQuery.error instanceof Error
              ? contextQuery.error.message
              : "Could not load the dashboard context."}
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button size="sm" onClick={() => router.push("/auth/sign-in")}>
              Sign in
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                queryClient.invalidateQueries({ queryKey: ["dashboard"] })
              }
            >
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-[264px] shrink-0 border-r border-border/60 bg-surface-secondary lg:flex lg:flex-col">
        <Sidebar />
      </aside>

      {/* Mobile sidebar overlay */}
      {isNavOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-sm lg:hidden"
            onClick={closeNav}
          />
          <aside className="fixed inset-y-0 left-0 z-50 w-[284px] border-r border-border/60 bg-surface-secondary shadow-2xl lg:hidden">
            <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
              <span className="text-sm font-semibold">Menu</span>
              <Button variant="ghost" size="icon" className="rounded-xl" onClick={closeNav}>
                <X className="size-4" />
              </Button>
            </div>
            <div className="h-[calc(100%-52px)]">
              <Sidebar onNavigate={closeNav} />
            </div>
          </aside>
        </>
      )}

      {/* Main content area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
            <TopBar />
            <main className="mt-4 pb-8">{children}</main>
          </div>
        </div>
      </div>

      {/* Neo AI Panel */}
      <NeoPanel isOpen={isNeoOpen} onClose={closeNeo} />
    </div>
  );
}
