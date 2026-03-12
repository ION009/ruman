"use client";

import {
    Check,
    Code2,
    Copy,
    Database,
    FileDown,
    Globe,
    Link2,
    Loader2,
    MessageCircle,
    Plug,
    Plus,
    Trash2,
    Webhook,
} from "lucide-react";
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
    useDashboardAPIKeys,
    useDashboardSettings,
    useDashboardSharedLinks,
} from "@/hooks/use-dashboard";
import {
    createDashboardAPIKey,
    createDashboardSharedLink,
    deleteDashboardAPIKey,
    deleteDashboardSharedLink,
    dashboardKeys,
} from "@/lib/dashboard/client";
import { useDashboardStore } from "@/stores/dashboard-store";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Status helpers                                                             */
/* -------------------------------------------------------------------------- */

type ConnectionStatus = "connected" | "coming_soon" | "available";

const statusConfig: Record<
    ConnectionStatus,
    { label: string; color: string; bg: string }
> = {
    connected: { label: "Connected", color: "text-accent-teal", bg: "bg-accent-teal/10" },
    coming_soon: { label: "Coming soon", color: "text-text-secondary", bg: "bg-surface-secondary" },
    available: { label: "Available", color: "text-accent-amber", bg: "bg-accent-amber/10" },
};

function StatusSpan({ status }: { status: ConnectionStatus }) {
    const cfg = statusConfig[status];
    return (
        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${cfg.bg} ${cfg.color}`}>
            {cfg.label}
        </span>
    );
}

/* -------------------------------------------------------------------------- */
/*  CopyButton                                                                 */
/* -------------------------------------------------------------------------- */

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="ghost"
            size="icon"
            className="size-7 rounded-lg"
            onClick={() => {
                navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            }}
        >
            {copied ? <Check className="size-3 text-accent-teal" /> : <Copy className="size-3" />}
        </Button>
    );
}

/* -------------------------------------------------------------------------- */
/*  Main component                                                             */
/* -------------------------------------------------------------------------- */

export function IntegrationsView() {
    const queryClient = useQueryClient();
    const selectedSiteId = useDashboardStore((s) => s.selectedSiteId);
    const settingsQuery = useDashboardSettings();
    const apiKeysQuery = useDashboardAPIKeys();
    const sharedLinksQuery = useDashboardSharedLinks();

    const [creatingKey, setCreatingKey] = useState(false);
    const [newKeyName, setNewKeyName] = useState("");
    const [savingKey, setSavingKey] = useState(false);
    const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);

    const [creatingLink, setCreatingLink] = useState(false);
    const [savingLink, setSavingLink] = useState(false);
    const [deletingLinkId, setDeletingLinkId] = useState<string | null>(null);

    const invalidateKeys = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.apiKeys(selectedSiteId) });
    }, [queryClient, selectedSiteId]);

    const invalidateLinks = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.sharedLinks(selectedSiteId) });
    }, [queryClient, selectedSiteId]);

    async function handleCreateKey() {
        if (!newKeyName.trim()) return;
        setSavingKey(true);
        try {
            await createDashboardAPIKey(selectedSiteId, { name: newKeyName.trim() });
            setNewKeyName("");
            setCreatingKey(false);
            invalidateKeys();
        } catch {
        } finally {
            setSavingKey(false);
        }
    }

    async function handleDeleteKey(keyId: string) {
        setDeletingKeyId(keyId);
        try {
            await deleteDashboardAPIKey(selectedSiteId, keyId);
            invalidateKeys();
        } catch {
        } finally {
            setDeletingKeyId(null);
        }
    }

    async function handleCreateLink() {
        setSavingLink(true);
        try {
            await createDashboardSharedLink(selectedSiteId, {});
            setCreatingLink(false);
            invalidateLinks();
        } catch {
        } finally {
            setSavingLink(false);
        }
    }

    async function handleDeleteLink(linkId: string) {
        setDeletingLinkId(linkId);
        try {
            await deleteDashboardSharedLink(selectedSiteId, linkId);
            invalidateLinks();
        } catch {
        } finally {
            setDeletingLinkId(null);
        }
    }

    /* ----- Loading state ----- */
    if (settingsQuery.isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-14 rounded-2xl" />
                <Skeleton className="h-20 rounded-2xl" />
                <div className="grid gap-3 sm:grid-cols-3">
                    <Skeleton className="h-28 rounded-2xl" />
                    <Skeleton className="h-28 rounded-2xl" />
                    <Skeleton className="h-28 rounded-2xl" />
                </div>
            </div>
        );
    }

    const settings = settingsQuery.data;
    const apiKeys = apiKeysQuery.data ?? [];
    const sharedLinks = sharedLinksQuery.data ?? [];

    return (
        <div className="space-y-5">
            {/* ── Header ── */}
            <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-accent-teal/10">
                    <Plug className="size-4 text-accent-teal" />
                </div>
                <div>
                    <h2 className="text-[14px] font-semibold text-text-primary">Integrations</h2>
                    <p className="text-[11px] text-text-secondary">
                        Connect, export, and share your analytics data
                    </p>
                </div>
            </div>

            {/* ── KPI strip ── */}
            <div className="ov-kpi-strip section-frame grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border/50 sm:grid-cols-4">
                <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
                    <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{apiKeys.length}</span>
                    <span className="ov-kpi-label text-[11px] text-text-secondary">API keys</span>
                </div>
                <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
                    <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-primary">{sharedLinks.length}</span>
                    <span className="ov-kpi-label text-[11px] text-text-secondary">Shared links</span>
                </div>
                <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
                    <span className="ov-kpi-number text-lg font-semibold tracking-tight text-accent-teal">3</span>
                    <span className="ov-kpi-label text-[11px] text-text-secondary">Connected</span>
                </div>
                <div className="ov-kpi-cell flex flex-col gap-1 bg-surface-primary p-4">
                    <span className="ov-kpi-number text-lg font-semibold tracking-tight text-text-secondary">2</span>
                    <span className="ov-kpi-label text-[11px] text-text-secondary">Coming soon</span>
                </div>
            </div>

            {/* ── Tracker snippet ── */}
            {settings?.trackerSnippet && (
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Code2 className="size-3.5 text-text-primary" />
                            <p className="text-[13px] font-semibold text-text-primary">Tracker Script</p>
                        </div>
                        <CopyButton text={settings.trackerSnippet} />
                    </div>
                    <pre className="rounded-xl bg-surface-secondary/60 p-3 text-[11px] text-text-secondary font-mono overflow-x-auto whitespace-pre-wrap">
                        {settings.trackerSnippet}
                    </pre>
                </div>
            )}

            {/* ── Integration providers ── */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Data Export */}
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <FileDown className="size-4 text-text-primary" />
                        <StatusSpan status="connected" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-text-primary">Data Export</h3>
                    <p className="text-[11px] text-text-secondary mt-1">Export events, summary, and heatmaps as JSON or CSV.</p>
                    <div className="mt-3 flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-[11px] h-7"
                            onClick={() => window.open(`/api/dashboard/export/summary?site=${selectedSiteId}&range=7d&format=json`, "_blank")}
                        >
                            Summary JSON
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg text-[11px] h-7"
                            onClick={() => window.open(`/api/dashboard/export/events?site=${selectedSiteId}&range=7d&format=csv`, "_blank")}
                        >
                            Events CSV
                        </Button>
                    </div>
                </div>

                {/* Public Stats API */}
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <Globe className="size-4 text-text-primary" />
                        <StatusSpan status="connected" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-text-primary">Public Stats API</h3>
                    <p className="text-[11px] text-text-secondary mt-1">Embed analytics widgets or build custom dashboards.</p>
                    <p className="mt-2 text-[11px] font-mono text-text-muted truncate">
                        GET /api/v1/stats/summary?site={selectedSiteId}
                    </p>
                </div>

                {/* Webhooks */}
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <Webhook className="size-4 text-text-primary" />
                        <StatusSpan status="connected" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-text-primary">Webhooks</h3>
                    <p className="text-[11px] text-text-secondary mt-1">Push event notifications to external endpoints in real time.</p>
                </div>

                {/* Google Analytics */}
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <Globe className="size-4 text-text-muted" />
                        <StatusSpan status="coming_soon" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-text-primary">Google Analytics</h3>
                    <p className="text-[11px] text-text-secondary mt-1">Connect your GA4 property to sync audiences and compare metrics.</p>
                </div>

                {/* Slack */}
                <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                    <div className="flex items-center justify-between mb-3">
                        <MessageCircle className="size-4 text-text-muted" />
                        <StatusSpan status="coming_soon" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-text-primary">Slack</h3>
                    <p className="text-[11px] text-text-secondary mt-1">Send weekly reports and alert notifications to channels.</p>
                </div>
            </div>

            {/* ── API Keys ── */}
            <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Database className="size-3.5 text-text-primary" />
                        <p className="text-[13px] font-semibold text-text-primary">API Keys</p>
                    </div>
                    {!creatingKey && (
                        <Button size="sm" className="rounded-lg text-[11px] h-7 gap-1" onClick={() => setCreatingKey(true)}>
                            <Plus className="size-2.5" /> New Key
                        </Button>
                    )}
                </div>

                {creatingKey && (
                    <div className="flex items-center gap-2 mb-3">
                        <Input
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            placeholder="Key name (e.g. Production)"
                            className="h-8 rounded-lg text-xs flex-1"
                        />
                        <Button size="sm" className="rounded-lg text-[11px] h-8" disabled={savingKey || !newKeyName.trim()} onClick={handleCreateKey}>
                            {savingKey ? <Loader2 className="size-3 animate-spin" /> : "Create"}
                        </Button>
                        <Button variant="ghost" size="sm" className="rounded-lg text-[11px] h-8" onClick={() => setCreatingKey(false)}>
                            Cancel
                        </Button>
                    </div>
                )}

                {apiKeys.length === 0 ? (
                    <p className="text-[11px] text-text-secondary py-2">No API keys created yet.</p>
                ) : (
                    <div className="ov-list space-y-1">
                        {apiKeys.map((key) => (
                            <div
                                key={key.id}
                                className="ov-list-row flex items-center justify-between rounded-lg bg-surface-secondary/40 px-3 py-2.5"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-text-primary">{key.name}</p>
                                    <p className="text-[11px] text-text-muted">
                                        Created {new Date(key.createdAt).toLocaleDateString()}
                                        {key.lastUsed && ` · Last used ${new Date(key.lastUsed).toLocaleDateString()}`}
                                    </p>
                                    {key.token && (
                                        <div className="flex items-center gap-1 mt-1">
                                            <code className="text-[11px] bg-surface-secondary rounded px-1.5 py-0.5 font-mono text-text-secondary">{key.token}</code>
                                            <CopyButton text={key.token} />
                                        </div>
                                    )}
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7 rounded-lg text-red-500 hover:text-red-600 shrink-0"
                                    disabled={deletingKeyId === key.id}
                                    onClick={() => handleDeleteKey(key.id)}
                                >
                                    {deletingKeyId === key.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                </Button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Shared Dashboard Links ── */}
            <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
                <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                        <Link2 className="size-3.5 text-text-primary" />
                        <p className="text-[13px] font-semibold text-text-primary">Shared Dashboard Links</p>
                    </div>
                    <Button size="sm" className="rounded-lg text-[11px] h-7 gap-1" disabled={savingLink} onClick={handleCreateLink}>
                        {savingLink ? <Loader2 className="size-2.5 animate-spin" /> : <Plus className="size-2.5" />}
                        New Link
                    </Button>
                </div>

                {sharedLinks.length === 0 ? (
                    <p className="text-[11px] text-text-secondary py-2">No shared links created yet.</p>
                ) : (
                    <div className="ov-list space-y-1">
                        {sharedLinks.map((link) => {
                            const shareUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/share/${link.slug}`;
                            return (
                                <div
                                    key={link.id}
                                    className="ov-list-row flex items-center justify-between rounded-lg bg-surface-secondary/40 px-3 py-2.5"
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-1.5">
                                            <code className="text-[11px] font-mono truncate text-text-primary">{shareUrl}</code>
                                            <CopyButton text={shareUrl} />
                                        </div>
                                        <p className="text-[11px] text-text-muted mt-0.5">
                                            Created {new Date(link.createdAt).toLocaleDateString()}
                                            {link.passwordProtected && (
                                                <span className="inline-flex items-center ml-1.5 rounded-md bg-accent-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">
                                                    Password protected
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 rounded-lg text-red-500 hover:text-red-600 shrink-0"
                                        disabled={deletingLinkId === link.id}
                                        onClick={() => handleDeleteLink(link.id)}
                                    >
                                        {deletingLinkId === link.id ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                                    </Button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
