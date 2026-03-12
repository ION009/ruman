"use client";

import { Search, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardReplaySessions } from "@/hooks/use-dashboard";
import { formatCompact, timeAgo } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Deterministic alias generator (privacy-safe fictional names)               */
/* -------------------------------------------------------------------------- */

const FIRST_NAMES = [
  "Xyy", "Zon", "Leein", "Mavu", "Tiko", "Suri", "Blix", "Quon", "Ryel",
  "Jael", "Nebi", "Kael", "Piru", "Zeph", "Orin", "Lyca", "Voss", "Wren",
  "Dael", "Fyra", "Helo", "Icar", "Juno", "Kova", "Lux", "Mira", "Nyx",
  "Orla", "Pax", "Rune", "Sage", "Tova", "Uma", "Vex", "Wynn", "Xara",
];

const LAST_NAMES = [
  "Starfell", "Ironmist", "Voidpine", "Ashbloom", "Dustveil", "Thornwick",
  "Flamecrest", "Mistwalker", "Gloomhaven", "Sunweaver", "Frostleaf",
  "Stormpeak", "Nighthollow", "Dawnridge", "Silvermoor", "Embervale",
  "Cloudspire", "Deepwell", "Brightforge", "Windhelm", "Stoneglyph",
];

function hashAlias(value: string) {
  let hash = 0;
  for (const character of value) {
    hash = (hash << 5) - hash + character.charCodeAt(0);
    hash |= 0;
  }
  const absHash = Math.abs(hash);
  const first = FIRST_NAMES[absHash % FIRST_NAMES.length]!;
  const last = LAST_NAMES[(absHash >>> 8) % LAST_NAMES.length]!;
  return `${first} ${last}`;
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function UsersView() {
  const replaySessionsQuery = useDashboardReplaySessions();
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  /* ----- Loading state ----- */
  if (replaySessionsQuery.isLoading && !replaySessionsQuery.data) {
    return <Skeleton className="h-[880px] rounded-2xl" />;
  }

  /* ----- Error state ----- */
  if (replaySessionsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-text-primary">Users unavailable</h2>
        <p className="mt-2 text-sm text-status-error">{replaySessionsQuery.error.message}</p>
      </div>
    );
  }

  /* ----- Profile aggregation from replay sessions ----- */
  const sessions = replaySessionsQuery.data?.sessions ?? [];
  const profileMap = new Map<
    string,
    {
      id: string;
      alias: string;
      browser: string;
      os: string;
      deviceType: string;
      sessionCount: number;
      issueCount: number;
      eventCount: number;
      pageViews: number;
      paths: string[];
      firstSeen: string;
      lastSeen: string;
      sessions: typeof sessions;
    }
  >();

  for (const session of sessions) {
    const profileId = [
      session.browser || "browser",
      session.os || "os",
      session.deviceType || "device",
      session.viewport.bucket || "viewport",
    ].join("|");

    const existing = profileMap.get(profileId);
    if (existing) {
      existing.sessionCount += 1;
      existing.issueCount += session.errorCount + session.rageClickCount + session.deadClickCount;
      existing.eventCount += session.eventCount;
      existing.pageViews += session.pageCount;
      existing.paths = [...new Set([...existing.paths, ...session.paths])];
      existing.firstSeen =
        new Date(existing.firstSeen).getTime() < new Date(session.startedAt).getTime()
          ? existing.firstSeen
          : session.startedAt;
      existing.lastSeen =
        new Date(existing.lastSeen).getTime() > new Date(session.updatedAt).getTime()
          ? existing.lastSeen
          : session.updatedAt;
      existing.sessions.push(session);
      continue;
    }

    profileMap.set(profileId, {
      id: profileId,
      alias: hashAlias(profileId),
      browser: session.browser || "Unknown",
      os: session.os || "Unknown",
      deviceType: session.deviceType || "Unknown",
      sessionCount: 1,
      issueCount: session.errorCount + session.rageClickCount + session.deadClickCount,
      eventCount: session.eventCount,
      pageViews: session.pageCount,
      paths: [...session.paths],
      firstSeen: session.startedAt,
      lastSeen: session.updatedAt,
      sessions: [session],
    });
  }

  const profiles = [...profileMap.values()]
    .sort((left, right) => new Date(right.lastSeen).getTime() - new Date(left.lastSeen).getTime())
    .filter((profile) =>
      `${profile.alias} ${profile.browser} ${profile.os} ${profile.deviceType} ${profile.paths.join(" ")}`
        .toLowerCase()
        .includes(deferredSearch.toLowerCase()),
    );
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? profiles[0] ?? null;

  useEffect(() => {
    if (selectedProfile?.id && selectedProfileId !== selectedProfile.id) {
      setSelectedProfileId(selectedProfile.id);
    }
  }, [selectedProfile, selectedProfileId]);

  const issueProfiles = profiles.filter((profile) => profile.issueCount > 0).length;
  const sessionTotal = profiles.reduce((sum, profile) => sum + profile.sessionCount, 0);
  const totalPageViews = profiles.reduce((sum, profile) => sum + profile.pageViews, 0);
  const observedPaths = new Set(profiles.flatMap((profile) => profile.paths)).size;

  /* ----- Empty state ----- */
  if (profiles.length === 0 && sessions.length === 0) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6 sm:p-8">
        <div className="mx-auto max-w-md text-center">
          <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-accent-teal/10">
            <ShieldCheck className="size-6 text-accent-teal" />
          </div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">No visitor profiles yet</h2>
          <p className="mt-2 text-sm text-text-secondary">
            Privacy-safe visitor profiles will appear here once replay sessions have been recorded.
            Install the tracker and let traffic accumulate.
          </p>
        </div>
      </div>
    );
  }

  /* ----- Main view ----- */
  return (
    <div className="space-y-5">
      {/* -- Header bar: search -- */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-text-primary">Visitors</h2>
          <p className="mt-0.5 text-sm text-text-secondary">Privacy-safe sampled profiles from replay sessions</p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            className="h-9 pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name, browser, OS, path..."
          />
        </div>
      </div>

      {/* -- KPI strip -- */}
      <div className="ov-kpi-strip section-frame grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 sm:grid-cols-5">
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{formatCompact(profiles.length)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Profiles</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-amber">{formatCompact(issueProfiles)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">With issues</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-teal">{formatCompact(sessionTotal)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Sessions</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{formatCompact(totalPageViews)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Page views</span>
        </div>
        <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
          <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{formatCompact(observedPaths)}</span>
          <span className="ov-kpi-label text-[11px] text-text-secondary">Unique paths</span>
        </div>
      </div>

      {/* -- Spreadsheet-style table -- */}
      <div className="section-frame rounded-2xl border border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Browser</th>
                <th className="px-4 py-3 font-medium">OS</th>
                <th className="px-4 py-3 font-medium">Device</th>
                <th className="px-4 py-3 font-medium text-right">Page views</th>
                <th className="px-4 py-3 font-medium text-right">Events</th>
                <th className="px-4 py-3 font-medium text-right">Sessions</th>
                <th className="px-4 py-3 font-medium">Pages visited</th>
                <th className="px-4 py-3 font-medium">First seen</th>
                <th className="px-4 py-3 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {profiles.length ? (
                profiles.map((profile) => {
                  const active = profile.id === selectedProfile?.id;
                  return (
                    <tr
                      key={profile.id}
                      onClick={() => setSelectedProfileId(profile.id)}
                      className={`cursor-pointer transition-colors ${
                        active
                          ? "bg-accent-teal/[0.04]"
                          : "hover:bg-surface-secondary/60"
                      }`}
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-text-primary">{profile.alias}</span>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary">{profile.browser}</td>
                      <td className="px-4 py-2.5 text-text-secondary">{profile.os}</td>
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                          {profile.deviceType}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{formatCompact(profile.pageViews)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">{formatCompact(profile.eventCount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-secondary">{formatCompact(profile.sessionCount)}</td>
                      <td className="max-w-[180px] truncate px-4 py-2.5 font-mono text-[11px] text-text-muted">
                        {profile.paths.slice(0, 3).join(", ")}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary">{timeAgo(profile.firstSeen)}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-text-secondary">{timeAgo(profile.lastSeen)}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-text-secondary">
                    No profiles match that search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* -- Drill-down panel -- */}
      {selectedProfile && (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[14px] font-semibold text-text-primary">{selectedProfile.alias}</h3>
            <span className="text-[11px] text-text-muted">
              {selectedProfile.browser} / {selectedProfile.os} / {selectedProfile.deviceType}
            </span>
          </div>

          {/* mini KPI row for selected profile */}
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Sessions</p>
              <p className="mt-1.5 text-base font-semibold text-text-primary">{formatCompact(selectedProfile.sessionCount)}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Page views</p>
              <p className="mt-1.5 text-base font-semibold text-text-primary">{formatCompact(selectedProfile.pageViews)}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Events</p>
              <p className="mt-1.5 text-base font-semibold text-accent-teal">{formatCompact(selectedProfile.eventCount)}</p>
            </div>
            <div className="rounded-xl border border-border/40 bg-surface-secondary/40 p-3">
              <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Issues</p>
              <p className={`mt-1.5 text-base font-semibold ${selectedProfile.issueCount > 0 ? "text-accent-amber" : "text-text-primary"}`}>
                {formatCompact(selectedProfile.issueCount)}
              </p>
            </div>
          </div>

          {/* Path spread */}
          <div className="mt-4">
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Pages visited</p>
            <p className="mt-1.5 text-sm text-text-secondary">
              {selectedProfile.paths.join(" , ") || "No paths observed."}
            </p>
          </div>

          {/* Session list */}
          <div className="mt-4">
            <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.18em] text-text-muted">Session history</p>
            <div className="ov-list space-y-1.5">
              {selectedProfile.sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="ov-list-row flex items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-surface-secondary/60"
                >
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-text-primary">{session.entryPath || "/"}</span>
                    <span className="ml-2 text-[11px] text-text-muted">
                      {formatCompact(session.eventCount)} events · {session.viewport.bucket} · {timeAgo(session.updatedAt)}
                    </span>
                  </div>
                  <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-xs">
                    <Link href={`/session-replay?session=${encodeURIComponent(session.sessionId)}`}>
                      Replay
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* -- Privacy notes -- */}
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-teal/10">
            <ShieldCheck className="size-4 text-accent-teal" />
          </div>
          <div>
            <h3 className="text-[14px] font-semibold text-text-primary">How we protect visitor privacy</h3>
            <div className="mt-2 space-y-1.5 text-sm text-text-secondary">
              <p>
                Every visitor shown above is a <strong className="font-medium text-text-primary">privacy-safe pseudonymous profile</strong>.
                We never collect real names, emails, IP addresses, or any personally identifiable information.
              </p>
              <p>
                Profiles are constructed by grouping replay sessions using non-identifying device characteristics
                (browser, operating system, device type, and viewport size). The fictional names displayed are
                deterministically generated from these hashed attributes and carry no real-world identity.
              </p>
              <p>
                All analytics data is processed in aggregate. No cross-site tracking, no fingerprinting, no cookies
                storing personal data. Your visitors remain anonymous by design.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
