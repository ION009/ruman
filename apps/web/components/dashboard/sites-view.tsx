"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Globe, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, Waves } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardAPIKeys, useDashboardContext, useDashboardSettings, useDashboardSharedLinks } from "@/hooks/use-dashboard";
import { withClientCSRFHeaders } from "@/lib/csrf/client";
import {
  createDashboardAPIKey,
  createDashboardSharedLink,
  dashboardKeys,
  deleteDashboardAPIKey,
  deleteDashboardSharedLink,
} from "@/lib/dashboard/client";
import { formatCompact, timeAgo } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

  return site.id;
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export function SitesView() {
  const queryClient = useQueryClient();
  const contextQuery = useDashboardContext();
  const settingsQuery = useDashboardSettings();
  const sharedLinksQuery = useDashboardSharedLinks();
  const apiKeysQuery = useDashboardAPIKeys();
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const setSelectedSiteId = useDashboardStore((state) => state.setSelectedSiteId);
  const [newSiteName, setNewSiteName] = useState("");
  const [newSiteOrigin, setNewSiteOrigin] = useState("");
  const [newOrigin, setNewOrigin] = useState("");
  const [sharePassword, setSharePassword] = useState("");
  const [apiKeyName, setApiKeyName] = useState("");
  const [createdToken, setCreatedToken] = useState("");
  const [copiedValue, setCopiedValue] = useState("");

  const site = settingsQuery.data?.site;
  const dashboardMode = contextQuery.data?.mode ?? "token";
  const isControlPlaneMode = dashboardMode === "control-plane";
  const settingsData = settingsQuery.data;

  /* ----- Mutations ------------------------------------------------ */

  const createSiteMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/sites", {
        method: "POST",
        headers: withClientCSRFHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ name: newSiteName, domain: newSiteOrigin }),
      });

      const payload = (await response.json().catch(() => ({}))) as { error?: string; siteId?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to register site.");
      }
      return payload.siteId ?? "";
    },
    onSuccess: async (siteId) => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setNewSiteName("");
      setNewSiteOrigin("");
      if (siteId) {
        setSelectedSiteId(siteId);
      }
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

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        discovered?: number;
        stored?: number;
        origin?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to re-scan sitemap.");
      }

      return payload;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  const createSharedLinkMutation = useMutation({
    mutationFn: async () => createDashboardSharedLink(selectedSiteId, { password: sharePassword }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.sharedLinks(selectedSiteId) });
      setSharePassword("");
    },
  });

  const deleteSharedLinkMutation = useMutation({
    mutationFn: async (linkId: string) => deleteDashboardSharedLink(selectedSiteId, linkId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.sharedLinks(selectedSiteId) });
    },
  });

  const createAPIKeyMutation = useMutation({
    mutationFn: async () => createDashboardAPIKey(selectedSiteId, { name: apiKeyName, permissions: "read" }),
    onSuccess: async (apiKey) => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.apiKeys(selectedSiteId) });
      setApiKeyName("");
      setCreatedToken(apiKey.token ?? "");
    },
  });

  const deleteAPIKeyMutation = useMutation({
    mutationFn: async (keyId: string) => deleteDashboardAPIKey(selectedSiteId, keyId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: dashboardKeys.apiKeys(selectedSiteId) });
    },
  });

  async function copyText(value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedValue(value);
    window.setTimeout(() => setCopiedValue(""), 1200);
  }

  /* ----- Loading / Error states ----------------------------------- */

  if (contextQuery.isLoading && settingsQuery.isLoading && !contextQuery.data && !settingsQuery.data) {
    return <Skeleton className="h-[920px] rounded-2xl" />;
  }

  if (contextQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-6">
        <h3 className="text-[14px] font-semibold text-status-error">Sites unavailable</h3>
        <p className="mt-1 text-[13px] text-text-secondary">{contextQuery.error.message}</p>
      </div>
    );
  }

  const sites = contextQuery.data?.sites ?? [];
  const sharedLinks = sharedLinksQuery.data ?? [];
  const apiKeys = apiKeysQuery.data ?? [];
  const shareBase =
    typeof window !== "undefined" ? `${window.location.origin}/share` : "/share";

  /* ----- Render --------------------------------------------------- */

  return (
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Registered Sites</p>
          <p className="ov-kpi-number">{formatCompact(sites.length)}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Trusted Origins</p>
          <p className="ov-kpi-number">{formatCompact(site?.origins.length ?? 0)}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">Shared Links</p>
          <p className="ov-kpi-number">{formatCompact(sharedLinks.length)}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">API Keys</p>
          <p className="ov-kpi-number">{formatCompact(apiKeys.length)}</p>
        </div>
      </div>

      {/* Read-only notice for token mode */}
      {!isControlPlaneMode ? (
        <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
          <p className="text-[13px] font-medium text-text-primary">Token mode is read-only for portfolio management.</p>
          <p className="mt-1 text-[12px] text-text-secondary">
            You can inspect the selected site here, but registering sites, managing origins, and creating shared links or API keys requires control-plane mode.
          </p>
        </div>
      ) : null}

      {/* Two-column layout */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr),minmax(360px,0.95fr)]">
        {/* Left column */}
        <div className="space-y-5">
          {/* Site Registry */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-[14px] font-semibold text-text-primary">Site registry</h3>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  Switch the active site and inspect portfolio coverage.
                </p>
              </div>
              <span className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                {formatCompact(sites.length)} sites
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {sites.map((entry) => {
                const active = entry.id === selectedSiteId;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedSiteId(entry.id)}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active
                        ? "border-accent-teal/30 bg-accent-teal/5"
                        : "border-border/50 bg-white/60 hover:bg-surface-secondary/60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-text-primary">{labelForSite(entry)}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          {entry.origins[0] || "No primary origin"}
                        </p>
                      </div>
                      {active ? (
                        <span className="rounded-md bg-accent-teal/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-teal">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 text-[11px] text-text-muted">
                      {entry.origins.length} origin{entry.origins.length !== 1 ? "s" : ""} configured
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shared Links */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold text-text-primary">Shared links</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Public or password-protected dashboards for outside viewers.
            </p>

            {createdToken ? (
              <div className="mt-3 rounded-xl border border-accent-teal/30 bg-accent-teal/5 p-3">
                <p className="text-[13px] font-medium text-text-primary">New API key created.</p>
                <p className="mt-1 text-[12px] text-text-secondary">Copy it now: {createdToken}</p>
              </div>
            ) : null}

            {sharedLinks.length ? (
              <div className="ov-list mt-3">
                {sharedLinks.map((link) => {
                  const shareUrl = `${shareBase}/${link.slug}`;
                  return (
                    <div key={link.id} className="ov-list-row items-center">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-text-primary">{shareUrl}</p>
                        <p className="mt-0.5 text-[11px] text-text-muted">
                          {link.passwordProtected ? "Password protected" : "Open access"} · created {timeAgo(link.createdAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button variant="outline" size="sm" onClick={() => copyText(shareUrl)}>
                          <Copy className="size-3.5" />
                          {copiedValue === shareUrl ? "Copied" : "Copy"}
                        </Button>
                        {isControlPlaneMode ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => deleteSharedLinkMutation.mutate(link.id)}
                            disabled={deleteSharedLinkMutation.isPending}
                          >
                            Delete
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-border/50 bg-white/60 p-4 text-center">
                <Link2 className="mx-auto size-6 text-text-muted" />
                <p className="mt-2 text-[13px] font-medium text-text-primary">No shared links yet</p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  Create a share link for outside stakeholders or embedded review flows.
                </p>
              </div>
            )}

            {isControlPlaneMode ? (
              <div className="mt-3 rounded-xl border border-border/50 bg-white/60 p-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="share-password" className="text-[12px] text-text-secondary">Optional password</Label>
                    <Input
                      id="share-password"
                      value={sharePassword}
                      onChange={(event) => setSharePassword(event.target.value)}
                      placeholder="Leave empty for open access"
                    />
                  </div>
                  {createSharedLinkMutation.error ? (
                    <p className="text-[13px] text-status-error">{createSharedLinkMutation.error.message}</p>
                  ) : null}
                  <Button size="sm" onClick={() => createSharedLinkMutation.mutate()} disabled={createSharedLinkMutation.isPending}>
                    <Plus className="size-3.5" />
                    Create shared link
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Selected Site */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold text-text-primary">Selected site</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Install, origin, and discovery controls for the active site.
            </p>

            <div className="mt-4 rounded-xl border border-border/50 bg-white/60 p-3">
              <div className="flex items-center gap-3">
                <Waves className="size-4 shrink-0 text-accent-teal" />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-text-primary">{site ? labelForSite(site) : "No site selected"}</p>
                  <p className="mt-0.5 truncate text-[11px] text-text-muted">
                    {settingsData?.trackerScript?.scriptSrc || "Tracker not available"}
                  </p>
                </div>
              </div>
            </div>

            {site?.origins.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {site.origins.map((origin) => (
                  <span
                    key={origin}
                    className="rounded-md bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-text-secondary"
                  >
                    {origin}
                  </span>
                ))}
              </div>
            ) : null}

            {isControlPlaneMode ? (
              <>
                <form
                  className="mt-4 space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    createSiteMutation.mutate();
                  }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="site-name" className="text-[12px] text-text-secondary">Register site</Label>
                      <Input
                        id="site-name"
                        value={newSiteName}
                        onChange={(event) => setNewSiteName(event.target.value)}
                        placeholder="Docs site"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="site-origin" className="text-[12px] text-text-secondary">Primary domain</Label>
                      <Input
                        id="site-origin"
                        value={newSiteOrigin}
                        onChange={(event) => setNewSiteOrigin(event.target.value)}
                        placeholder="docs.company.com"
                      />
                    </div>
                  </div>
                  {createSiteMutation.error ? (
                    <p className="text-[13px] text-status-error">{createSiteMutation.error.message}</p>
                  ) : null}
                  <Button type="submit" size="sm" disabled={createSiteMutation.isPending}>
                    <Plus className="size-3.5" />
                    Register site
                  </Button>
                </form>

                <form
                  className="mt-3 space-y-3 rounded-xl border border-border/50 bg-white/60 p-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    addOriginMutation.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="new-origin" className="text-[12px] text-text-secondary">Add trusted domain</Label>
                    <Input
                      id="new-origin"
                      value={newOrigin}
                      onChange={(event) => setNewOrigin(event.target.value)}
                      placeholder="preview.company.com"
                    />
                  </div>
                  {addOriginMutation.error ? (
                    <p className="text-[13px] text-status-error">{addOriginMutation.error.message}</p>
                  ) : null}
                  <Button type="submit" variant="outline" size="sm" disabled={addOriginMutation.isPending}>
                    <Globe className="size-3.5" />
                    Add origin
                  </Button>
                </form>

                <div className="mt-3 rounded-xl border border-border/50 bg-white/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[13px] font-medium text-text-primary">Page discovery</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        Refresh the page inventory from sitemap + crawl.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rescanPagesMutation.mutate()}
                      disabled={rescanPagesMutation.isPending}
                    >
                      <RefreshCw className={`size-3.5 ${rescanPagesMutation.isPending ? "animate-spin" : ""}`} />
                      Re-scan
                    </Button>
                  </div>
                  {rescanPagesMutation.data ? (
                    <p className="mt-2 text-[11px] text-text-secondary">
                      Discovered {rescanPagesMutation.data.discovered ?? 0} pages from {rescanPagesMutation.data.origin ?? "the configured origin"}.
                    </p>
                  ) : null}
                </div>
              </>
            ) : null}
          </div>

          {/* API Keys */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h3 className="text-[14px] font-semibold text-text-primary">API keys</h3>
            <p className="mt-0.5 text-[12px] text-text-secondary">
              Site-bound access tokens for external integrations.
            </p>

            {apiKeys.length ? (
              <div className="ov-list mt-3">
                {apiKeys.map((key) => (
                  <div key={key.id} className="ov-list-row items-center">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-text-primary">{key.name}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">
                        {key.permissions} · created {timeAgo(key.createdAt)}
                      </p>
                    </div>
                    {isControlPlaneMode ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => deleteAPIKeyMutation.mutate(key.id)}
                        disabled={deleteAPIKeyMutation.isPending}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-border/50 bg-white/60 p-4 text-center">
                <KeyRound className="mx-auto size-6 text-text-muted" />
                <p className="mt-2 text-[13px] font-medium text-text-primary">No site API keys yet</p>
                <p className="mt-0.5 text-[12px] text-text-secondary">
                  Create a read token for site-scoped integrations or automation.
                </p>
              </div>
            )}

            {isControlPlaneMode ? (
              <div className="mt-3 rounded-xl border border-border/50 bg-white/60 p-3">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="api-key-name" className="text-[12px] text-text-secondary">Key name</Label>
                    <Input
                      id="api-key-name"
                      value={apiKeyName}
                      onChange={(event) => setApiKeyName(event.target.value)}
                      placeholder="Support export token"
                    />
                  </div>
                  {createAPIKeyMutation.error ? (
                    <p className="text-[13px] text-status-error">{createAPIKeyMutation.error.message}</p>
                  ) : null}
                  <Button size="sm" onClick={() => createAPIKeyMutation.mutate()} disabled={createAPIKeyMutation.isPending}>
                    <Plus className="size-3.5" />
                    Create API key
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
