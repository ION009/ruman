"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Globe,
  Plus,
  RefreshCw,
  Shield,
  TimerReset,
  UserRound,
  Waves,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TrackerInstallCard } from "@/components/dashboard/tracker-install-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardContext, useDashboardSettings } from "@/hooks/use-dashboard";
import { withClientCSRFHeaders } from "@/lib/csrf/client";
import { formatCompact, formatDateTime, timeAgo } from "@/lib/utils";

function labelForSite(site: { id: string; name?: string; origins: string[] }) {
  const name = (site.name ?? "").trim();
  if (name && name !== site.id) {
    return name;
  }

  const origin = site.origins?.[0] ?? "";
  if (origin) {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return origin;
    }
  }

  return name || site.id;
}

type RescanPagesResponse = {
  ok: boolean;
  origin: string;
  discovered: number;
  stored: number;
  note?: string;
};

export function SettingsView() {
  const queryClient = useQueryClient();
  const contextQuery = useDashboardContext();
  const settingsQuery = useDashboardSettings();
  const settingsData = settingsQuery.data;
  const selectedSiteId = settingsData?.site.id ?? "";
  const [fullName, setFullName] = useState("");
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteOrigin, setNewSiteOrigin] = useState("");
  const [newOrigin, setNewOrigin] = useState("");

  const profileMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/profile", {
        method: "PATCH",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ fullName }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update profile.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard", "context"] });
      setFullName("");
    },
  });

  const createSiteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: newSiteName, domain: newSiteOrigin }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to register site.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setNewSiteName("");
      setNewSiteOrigin("");
    },
  });

  const addOriginMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSiteId) {
        throw new Error("Select a site first.");
      }
      const response = await fetch(`/api/sites/${encodeURIComponent(selectedSiteId)}/origins`, {
        method: "POST",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ domain: newOrigin }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to add origin.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setNewOrigin("");
    },
  });

  const rescanPagesMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSiteId) {
        throw new Error("Select a site first.");
      }

      const response = await fetch(`/api/sites/${encodeURIComponent(selectedSiteId)}/pages/discover`, {
        method: "POST",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ origin: settingsData?.site.origins?.[0] ?? "" }),
      });

      const payload = (await response.json().catch(() => ({}))) as Partial<RescanPagesResponse> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to re-scan sitemap.");
      }

      return {
        ok: Boolean(payload.ok),
        origin: payload.origin ?? "",
        discovered: payload.discovered ?? 0,
        stored: payload.stored ?? 0,
        note: payload.note,
      } satisfies RescanPagesResponse;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const privacyMutation = useMutation({
    mutationFn: async (input: { domSnapshotsEnabled?: boolean; visitorCookieEnabled?: boolean }) => {
      if (!selectedSiteId) {
        throw new Error("Select a site first.");
      }

      const response = await fetch(`/api/sites/${encodeURIComponent(selectedSiteId)}/privacy`, {
        method: "PATCH",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(input),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to update privacy settings.");
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  if (settingsQuery.error) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Settings unavailable</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">{settingsQuery.error.message}</p>
      </Card>
    );
  }

  if (settingsQuery.isLoading && !settingsData) {
    return <Skeleton className="h-[760px] rounded-2xl" />;
  }

  if (!settingsData) {
    return (
      <Card className="section-frame rounded-2xl p-6">
        <CardTitle>Settings unavailable</CardTitle>
        <p className="mt-2 text-sm text-muted-foreground">The settings payload did not include any data.</p>
      </Card>
    );
  }

  const { privacy, retention, site, stats, trackerSnippet, trackerScript, sites } = settingsData;
  const viewer = contextQuery.data?.viewer;
  const dashboardMode = contextQuery.data?.mode ?? "token";
  const isControlPlaneMode = dashboardMode === "control-plane";

  const checklist = [
    {
      label: "Collector receiving events",
      done: Boolean(stats.lastSeen),
      detail: stats.lastSeen ? `Last event ${timeAgo(stats.lastSeen)}` : "No events yet",
    },
    {
      label: "Allowed origins configured",
      done: site.origins.length > 0,
      detail: `${site.origins.length} trusted origins`,
    },
    {
      label: "Tracker script persisted",
      done: trackerScript.isPersisted,
      detail: trackerScript.isPersisted ? "Stored in control plane" : "Using generated fallback",
    },
    {
      label: "Tracked pages discovered",
      done: stats.trackedPages > 0,
      detail: `${stats.trackedPages} distinct pages`,
    },
    {
      label: "Retention policy active",
      done: retention.eventsDays > 0,
      detail: `Events ${retention.eventsDays}d · Heatmaps ${retention.heatmapDays}d · Replay ${retention.replayDays}d · AI insight ${retention.insightsDays}d`,
    },
  ];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),minmax(340px,0.85fr)]">
      {/* Left column */}
      <div className="space-y-6">
        {/* Tracker snippet */}
        <TrackerInstallCard trackerSnippet={trackerSnippet} trackerScript={trackerScript} />

        {/* Deployment checklist */}
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle>Deployment checklist</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {checklist.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-white/60 p-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className={`size-4.5 shrink-0 ${item.done ? "text-chart-2" : "text-muted-foreground"}`} />
                  <div>
                    <p className="text-sm font-medium">{item.label}</p>
                    <p className="text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                </div>
                <Badge variant={item.done ? "info" : "warning"} className="text-[10px] shrink-0">
                  {item.done ? "Ready" : "Attention"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Retention windows */}
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle>Retention windows</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
              {[
                { label: "Events", days: retention.eventsDays, indicator: "bg-chart-1" },
                { label: "Heatmaps", days: retention.heatmapDays, indicator: "bg-chart-2" },
                { label: "Replay", days: retention.replayDays, indicator: "bg-chart-3" },
                { label: "AI insight", days: retention.insightsDays, indicator: "bg-chart-5" },
              ].map((item) => (
              <div key={item.label} className="rounded-xl border border-border/70 bg-white/60 p-4">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">{item.label}</span>
                  <span className="text-muted-foreground">{item.days} days</span>
                </div>
                <div className="mt-3">
                  <Progress
                    value={Math.min(100, (item.days / retention.eventsDays) * 100)}
                    indicatorClassName={item.indicator}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Right column */}
      <div className="space-y-6">
        {/* Profile */}
        {viewer ? (
          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle>Profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/60 p-4">
                <UserRound className="size-4.5 text-primary shrink-0" />
                <div>
                  <div className="text-sm font-medium">{viewer.fullName}</div>
                  <div className="text-xs text-muted-foreground">{viewer.email}</div>
                </div>
              </div>

              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  profileMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="profile-name">Full name</Label>
                  <Input
                    id="profile-name"
                    placeholder="Update display name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    className="h-9"
                  />
                </div>

                {profileMutation.error ? <p className="text-sm text-destructive">{profileMutation.error.message}</p> : null}

                <Button type="submit" size="sm" disabled={profileMutation.isPending}>
                  Save profile
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {/* Register site */}
        {isControlPlaneMode ? (
          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle>Register another site</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  createSiteMutation.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="site-register-name">Site name</Label>
                  <Input
                    id="site-register-name"
                    placeholder="Docs site"
                    value={newSiteName}
                    onChange={(event) => setNewSiteName(event.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="site-register-origin">Primary domain</Label>
                  <Input
                    id="site-register-origin"
                    type="text"
                    placeholder="docs.company.com"
                    value={newSiteOrigin}
                    onChange={(event) => setNewSiteOrigin(event.target.value)}
                    className="h-9"
                  />
                </div>

                {createSiteMutation.error ? <p className="text-sm text-destructive">{createSiteMutation.error.message}</p> : null}

                <Button type="submit" size="sm" disabled={createSiteMutation.isPending}>
                  <Plus className="size-3.5" />
                  Register site
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : (
          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle>Access mode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-border/70 bg-white/60 p-4">
                <p className="text-sm font-medium">Token mode</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Site registration and origin management are hidden because this dashboard is using the shared token flow.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sites.map((entry) => (
                  <Badge key={entry.id} variant={entry.id === site.id ? "info" : "secondary"} className="text-[10px]">
                    {labelForSite(entry)}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Site profile & origins */}
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle>Site profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/60 p-4">
              <Waves className="size-4.5 text-primary shrink-0" />
              <div>
                <div className="text-sm font-medium">{labelForSite(site)}</div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Selected site</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {site.origins.map((origin) => (
                <Badge key={origin} variant="secondary" className="text-[10px]">
                  <Globe className="mr-1 size-3" />
                  {origin}
                </Badge>
              ))}
            </div>

            {isControlPlaneMode ? (
              <>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addOriginMutation.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="site-origin-add">Add domain</Label>
                    <Input
                      id="site-origin-add"
                      type="text"
                      placeholder="preview.company.com"
                      value={newOrigin}
                      onChange={(event) => setNewOrigin(event.target.value)}
                      className="h-9"
                    />
                  </div>

                  {addOriginMutation.error ? <p className="text-sm text-destructive">{addOriginMutation.error.message}</p> : null}

                  <Button type="submit" variant="outline" size="sm" disabled={addOriginMutation.isPending}>
                    <Globe className="size-3.5" />
                    Add domain
                  </Button>
                </form>

                <div className="rounded-xl border border-border/70 bg-white/60 p-4 space-y-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">Page discovery</p>
                      <p className="text-xs text-muted-foreground">Refresh pages from sitemap + crawl.</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={rescanPagesMutation.isPending || !selectedSiteId}
                      onClick={() => rescanPagesMutation.mutate()}
                    >
                      <RefreshCw className={`size-3.5 ${rescanPagesMutation.isPending ? "animate-spin" : ""}`} />
                      Re-scan sitemap now
                    </Button>
                  </div>

                  {rescanPagesMutation.error ? <p className="text-sm text-destructive">{rescanPagesMutation.error.message}</p> : null}

                  {rescanPagesMutation.data ? (
                    <p className="text-xs text-muted-foreground">
                      Discovered {rescanPagesMutation.data.discovered} pages from {rescanPagesMutation.data.origin}
                      {rescanPagesMutation.data.note ? ` · ${rescanPagesMutation.data.note}` : ""}
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-xl border border-border/70 bg-white/60 p-4">
                <p className="text-sm font-medium">Read-only site access</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Domain management and page discovery are only available in control-plane mode.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {isControlPlaneMode ? (
          <Card className="section-frame rounded-2xl">
            <CardHeader className="pb-2">
              <CardTitle>Privacy controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                {
                  key: "domSnapshotsEnabled" as const,
                  label: "Masked DOM snapshots",
                  enabled: privacy.domSnapshotsEnabled,
                  description: "Allows structure-only DOM captures for heatmap overlays. The snippet adds data-snapshots when enabled.",
                  actionLabel: privacy.domSnapshotsEnabled ? "Disable" : "Enable",
                },
                {
                  key: "visitorCookieEnabled" as const,
                  label: "Visitor identity cookie",
                  enabled: privacy.visitorCookieEnabled,
                  description: "Opt-in _vid cookie for better returning-visitor accuracy. Only enable if the site already handles consent.",
                  actionLabel: privacy.visitorCookieEnabled ? "Disable" : "Enable",
                },
              ].map((item) => (
                <div key={item.key} className="rounded-xl border border-border/70 bg-white/60 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Shield className="size-4 text-primary shrink-0" />
                        <p className="text-sm font-medium">{item.label}</p>
                        <Badge variant={item.enabled ? "info" : "secondary"} className="text-[10px]">
                          {item.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={privacyMutation.isPending}
                      onClick={() =>
                        privacyMutation.mutate(
                          item.key === "domSnapshotsEnabled"
                            ? { domSnapshotsEnabled: !item.enabled }
                            : { visitorCookieEnabled: !item.enabled },
                        )
                      }
                    >
                      {item.actionLabel}
                    </Button>
                  </div>
                </div>
              ))}

              {privacyMutation.error ? <p className="text-sm text-destructive">{privacyMutation.error.message}</p> : null}
            </CardContent>
          </Card>
        ) : null}

        {/* Site registry */}
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle>Site registry</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sites.map((entry) => (
              <div
                key={entry.id}
                className={`rounded-xl border p-3.5 ${
                  entry.id === site.id ? "border-primary/25 bg-primary/10" : "border-border/70 bg-white/60"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{labelForSite(entry)}</p>
                    <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">{entry.origins.length} origins</p>
                  </div>
                  {entry.id === site.id ? <Badge className="text-[10px]">Active</Badge> : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Collection status */}
        <Card className="section-frame rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle>Collection status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/70 bg-white/60 p-4">
                <p className="eyebrow text-[10px] text-muted-foreground">Total events</p>
                <p className="mt-2 text-2xl font-semibold">{formatCompact(stats.totalEvents)}</p>
              </div>
              <div className="rounded-xl border border-border/70 bg-white/60 p-4">
                <p className="eyebrow text-[10px] text-muted-foreground">Tracked pages</p>
                <p className="mt-2 text-2xl font-semibold">{stats.trackedPages}</p>
              </div>
            </div>

            <div className="rounded-xl border border-border/70 bg-white/60 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TimerReset className="size-3.5 text-chart-2" />
                Last event {timeAgo(stats.lastSeen)}
              </div>
              <p className="mt-2 text-xs">First: {formatDateTime(stats.firstSeen)}</p>
              <p className="text-xs text-muted-foreground">Last: {formatDateTime(stats.lastSeen)}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
