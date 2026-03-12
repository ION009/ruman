"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Globe,
  Shield,
  Upload,
  UserRound,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { OpsNotice } from "@/components/dashboard/ops-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useDashboardContext, useDashboardSettings } from "@/hooks/use-dashboard";
import { withClientCSRFHeaders } from "@/lib/csrf/client";
import { formatCompact, formatDateTime, timeAgo } from "@/lib/utils";

/* ────────────────────────────────────────────────────────────────────────── */
/*  Installation guide data                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

type InstallGuide = { id: string; label: string; code: (snippet: string) => string };

const INSTALL_GUIDES: InstallGuide[] = [
  {
    id: "html",
    label: "HTML",
    code: (s) => `<!-- Paste before </head> -->\n${s}`,
  },
  {
    id: "nextjs",
    label: "Next.js",
    code: (s) =>
      `// app/layout.tsx — add inside <head>\nimport Script from "next/script";\n\nexport default function RootLayout({ children }) {\n  return (\n    <html>\n      <head>\n        <Script\n          src="${extractScriptSrc(s)}"\n          data-site-id="${extractSiteId(s)}"\n          strategy="afterInteractive"\n        />\n      </head>\n      <body>{children}</body>\n    </html>\n  );\n}`,
  },
  {
    id: "react",
    label: "React",
    code: (s) =>
      `// index.html — add before </head>\n${s}\n\n// Or load dynamically in useEffect:\nuseEffect(() => {\n  const el = document.createElement("script");\n  el.src = "${extractScriptSrc(s)}";\n  el.dataset.siteId = "${extractSiteId(s)}";\n  el.defer = true;\n  document.head.appendChild(el);\n  return () => el.remove();\n}, []);`,
  },
  {
    id: "vue",
    label: "Vue",
    code: (s) =>
      `<!-- public/index.html — add before </head> -->\n${s}\n\n// Or in main.ts:\nconst script = document.createElement("script");\nscript.src = "${extractScriptSrc(s)}";\nscript.dataset.siteId = "${extractSiteId(s)}";\nscript.defer = true;\ndocument.head.appendChild(script);`,
  },
  {
    id: "angular",
    label: "Angular",
    code: (s) =>
      `<!-- src/index.html — add before </head> -->\n${s}\n\n// Or in angular.json scripts array:\n"scripts": ["${extractScriptSrc(s)}"]`,
  },
  {
    id: "svelte",
    label: "Svelte",
    code: (s) =>
      `<!-- src/app.html — add before </head> -->\n${s}\n\n// SvelteKit: use +layout.svelte\n<svelte:head>\n  <script defer src="${extractScriptSrc(s)}" data-site-id="${extractSiteId(s)}"></script>\n</svelte:head>`,
  },
  {
    id: "wordpress",
    label: "WordPress",
    code: (s) =>
      `// functions.php — add to your theme\nfunction anlticsheat_tracker() {\n  wp_enqueue_script(\n    'anlticsheat',\n    '${extractScriptSrc(s)}',\n    [],\n    null,\n    false\n  );\n  wp_script_add_data('anlticsheat', 'defer', true);\n}\nadd_action('wp_enqueue_scripts', 'anlticsheat_tracker');\n\n// Alternative: paste in header.php before </head>\n${s}`,
  },
  {
    id: "shopify",
    label: "Shopify",
    code: (s) =>
      `{%- comment -%}\n  Shopify: Online Store > Themes > Edit code > theme.liquid\n  Paste this block before </head>\n{%- endcomment -%}\n${s}`,
  },
  {
    id: "gatsby",
    label: "Gatsby",
    code: (s) =>
      `// gatsby-ssr.js\nexport function onRenderBody({ setHeadComponents }) {\n  setHeadComponents([\n    <script\n      key="anlticsheat"\n      defer\n      src="${extractScriptSrc(s)}"\n      data-site-id="${extractSiteId(s)}"\n    />,\n  ]);\n}`,
  },
  {
    id: "nuxt",
    label: "Nuxt",
    code: (s) =>
      `// nuxt.config.ts\nexport default defineNuxtConfig({\n  app: {\n    head: {\n      script: [\n        {\n          src: "${extractScriptSrc(s)}",\n          defer: true,\n          "data-site-id": "${extractSiteId(s)}",\n        },\n      ],\n    },\n  },\n});`,
  },
];

const AI_AGENT_GUIDES: { id: string; label: string; prompt: (snippet: string, siteId: string, origin: string) => string }[] = [
  {
    id: "cursor",
    label: "Cursor",
    prompt: (snippet, siteId, origin) =>
      `## AnlticsHeat Installation — Cursor Agent\n\nAdd the AnlticsHeat analytics tracker to the project.\n\n### Steps\n1. Locate the main HTML template or root layout file (e.g. index.html, app/layout.tsx, +layout.svelte).\n2. Insert the following script tag before the closing </head> tag:\n\n\`\`\`html\n${snippet}\n\`\`\`\n\n### Configuration\n- Site ID: ${siteId}\n- Tracked origin: ${origin}\n- The script loads asynchronously with \`defer\` and does not block rendering.\n- No additional npm packages are required.\n\n### Verification\nAfter inserting the snippet, open the site in a browser and confirm:\n- The script appears in DevTools > Network as a loaded resource.\n- A POST request is sent to the collector endpoint within a few seconds of page load.\n\nDo NOT wrap the script in any framework-specific component unless the project uses a meta-framework (Next.js, Nuxt, SvelteKit) that requires it.`,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    prompt: (snippet, siteId, origin) =>
      `## AnlticsHeat Installation — Claude Code Agent\n\nYou are installing the AnlticsHeat analytics tracker into this project.\n\n### What to do\n1. Find the root HTML shell or layout component. Common locations:\n   - \`index.html\` (Vite, CRA, plain HTML)\n   - \`app/layout.tsx\` or \`pages/_document.tsx\` (Next.js)\n   - \`src/app.html\` or \`src/routes/+layout.svelte\` (SvelteKit)\n   - \`nuxt.config.ts\` head config (Nuxt)\n   - \`theme.liquid\` (Shopify)\n2. Insert exactly this snippet before </head>:\n\n\`\`\`html\n${snippet}\n\`\`\`\n\n### Important\n- Site ID: ${siteId}\n- Tracked origin: ${origin}\n- Do NOT install any npm package — this is a standalone script.\n- Do NOT modify the src URL or data attributes.\n- The script is lightweight (<4 KB gzipped), deferred, and privacy-first.\n\n### After installation\nRun the dev server and open the site. Confirm the script loads by checking the Network tab for the tracker request.`,
  },
  {
    id: "codex",
    label: "Codex",
    prompt: (snippet, siteId, origin) =>
      `## AnlticsHeat Installation — Codex Agent\n\nTask: Add the AnlticsHeat tracking script to this web project.\n\nScript to insert (place before </head> in the root HTML document):\n\n\`\`\`html\n${snippet}\n\`\`\`\n\nConfiguration details:\n- Site ID: ${siteId}\n- Tracked origin: ${origin}\n\nFile detection heuristic:\n- If the project has an \`index.html\`, edit that file.\n- If the project uses Next.js, edit \`app/layout.tsx\` or \`pages/_document.tsx\`.\n- If the project uses Nuxt, add to the head config in \`nuxt.config.ts\`.\n- If the project uses SvelteKit, edit \`src/app.html\`.\n- If the project is Shopify, edit \`theme.liquid\`.\n- If the project uses WordPress, add via \`functions.php\` or \`header.php\`.\n\nConstraints:\n- No npm dependencies needed.\n- Do not alter the script src or attributes.\n- The script is async-deferred and does not block rendering.\n- Ensure the snippet is placed exactly once, inside <head>.`,
  },
];

const IMPORT_PLATFORMS = [
  { id: "google-analytics", label: "Google Analytics", description: "Import from GA4 or Universal Analytics export" },
  { id: "plausible", label: "Plausible", description: "CSV export from Plausible Analytics" },
  { id: "umami", label: "Umami", description: "JSON or CSV export from Umami" },
  { id: "simple-analytics", label: "Simple Analytics", description: "Data export from Simple Analytics" },
  { id: "matomo", label: "Matomo", description: "CSV export from Matomo (Piwik)" },
  { id: "fathom", label: "Fathom", description: "CSV export from Fathom Analytics" },
  { id: "custom", label: "Custom CSV / JSON", description: "Any CSV or JSON file with pageview data" },
];

/* ────────────────────────────────────────────────────────────────────────── */
/*  Helpers                                                                  */
/* ────────────────────────────────────────────────────────────────────────── */

function extractScriptSrc(snippet: string): string {
  const match = snippet.match(/src=["']([^"']+)["']/);
  return match?.[1] ?? "";
}

function extractSiteId(snippet: string): string {
  const match = snippet.match(/data-site-id=["']([^"']+)["']/);
  return match?.[1] ?? "";
}

/* ────────────────────────────────────────────────────────────────────────── */
/*  Component                                                                */
/* ────────────────────────────────────────────────────────────────────────── */

export function ProjectSettingsView() {
  const queryClient = useQueryClient();
  const contextQuery = useDashboardContext();
  const settingsQuery = useDashboardSettings();
  const settingsData = settingsQuery.data;

  /* ── local state ─────────────────────────────────────────────────────── */
  const [copied, setCopied] = useState(false);
  const [copiedGuide, setCopiedGuide] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPlatform, setImportPlatform] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── mutations (unchanged business logic) ────────────────────────────── */
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
      setProfileOpen(false);
    },
  });

  const privacyMutation = useMutation({
    mutationFn: async (input: { domSnapshotsEnabled?: boolean; visitorCookieEnabled?: boolean }) => {
      if (!settingsData?.site.id) {
        throw new Error("Select a site first.");
      }

      const response = await fetch(`/api/sites/${encodeURIComponent(settingsData.site.id)}/privacy`, {
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

  /* ── drag-and-drop helpers ───────────────────────────────────────────── */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.name.endsWith(".json"))) {
      setImportFile(file);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  /* ── copy helper ─────────────────────────────────────────────────────── */
  const copyText = useCallback(async (text: string, key?: string) => {
    await navigator.clipboard.writeText(text);
    if (key) {
      setCopiedGuide(key);
      window.setTimeout(() => setCopiedGuide(null), 1200);
    } else {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    }
  }, []);

  /* ── loading / error states ──────────────────────────────────────────── */
  if (settingsQuery.error) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-text-primary">Project settings unavailable</h2>
        <p className="mt-2 text-sm text-status-error">{settingsQuery.error.message}</p>
      </div>
    );
  }

  if (settingsQuery.isLoading && !settingsData) {
    return <Skeleton className="h-[760px] rounded-2xl" />;
  }

  if (!settingsData) {
    return (
      <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
        <h2 className="text-[14px] font-semibold text-text-primary">Project settings unavailable</h2>
        <p className="mt-2 text-sm text-text-secondary">The settings payload did not include any data.</p>
      </div>
    );
  }

  const { privacy, retention, site, stats, trackerSnippet, trackerScript } = settingsData;
  const viewer = contextQuery.data?.viewer;
  const dashboardMode = contextQuery.data?.mode ?? "token";
  const isControlPlaneMode = dashboardMode === "control-plane";

  return (
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-text-primary">Site Settings</h1>
          <p className="mt-1 text-[13px] text-text-secondary">
            Tracker setup, privacy controls, and data management for{" "}
            <span className="font-medium text-text-primary">{site.name || site.id}</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          {viewer ? (
            <Sheet open={profileOpen} onOpenChange={setProfileOpen}>
              <SheetTrigger asChild>
                <Button variant="outline" size="sm">
                  <UserRound className="size-3.5" />
                  Profile
                </Button>
              </SheetTrigger>
              <SheetContent>
                <SheetHeader>
                  <SheetTitle>Edit Profile</SheetTitle>
                  <SheetDescription>Update your display name and profile information.</SheetDescription>
                </SheetHeader>
                <div className="mt-6 space-y-5">
                  <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-white/60 p-4">
                    <UserRound className="size-4.5 shrink-0 text-text-primary" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">{viewer.fullName}</p>
                      <p className="text-xs text-text-secondary">{viewer.email}</p>
                    </div>
                  </div>

                  <form
                    className="space-y-4"
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
                      />
                    </div>
                    {profileMutation.error ? (
                      <p className="text-sm text-status-error">{profileMutation.error.message}</p>
                    ) : null}
                    <Button type="submit" size="sm" disabled={profileMutation.isPending}>
                      Save profile
                    </Button>
                  </form>
                </div>
              </SheetContent>
            </Sheet>
          ) : null}

          <Sheet open={importOpen} onOpenChange={setImportOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="size-3.5" />
                Import Data
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Import Analytics Data</SheetTitle>
                <SheetDescription>
                  Migrate historical data from another analytics platform. Select a source and upload your export file.
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-5">
                {/* Platform selection */}
                <div className="space-y-2">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">Select platform</p>
                  <div className="ov-list">
                    {IMPORT_PLATFORMS.map((platform) => (
                      <button
                        key={platform.id}
                        type="button"
                        onClick={() => {
                          setImportPlatform(platform.id);
                          setImportFile(null);
                        }}
                        className={`ov-list-row flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                          importPlatform === platform.id
                            ? "bg-accent-teal/8 ring-1 ring-[#0D9488]/25"
                            : "hover:bg-surface-secondary"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-text-primary">{platform.label}</p>
                          <p className="text-[11px] text-text-muted">{platform.description}</p>
                        </div>
                        <ChevronRight className="size-3.5 shrink-0 text-text-muted" />
                      </button>
                    ))}
                  </div>
                </div>

                {/* File upload area */}
                {importPlatform ? (
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-secondary">Upload file</p>
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                        isDragging
                          ? "border-accent-teal bg-accent-teal/5"
                          : "border-border/70 hover:border-text-muted"
                      }`}
                    >
                      <Upload className="size-6 text-text-muted" />
                      <div>
                        <p className="text-[13px] font-medium text-text-primary">
                          {importFile ? importFile.name : "Drag and drop your file here"}
                        </p>
                        <p className="mt-1 text-[11px] text-text-muted">
                          {importFile
                            ? `${(importFile.size / 1024).toFixed(1)} KB`
                            : "CSV or JSON files supported"}
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.json"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) setImportFile(file);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        Choose file
                      </Button>
                    </div>

                    {importFile ? (
                      <Button size="sm" className="w-full" disabled>
                        <Upload className="size-3.5" />
                        Start import (backend pending)
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <div className="ov-kpi-strip">
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Total events</p>
          <p className="ov-kpi-number">{formatCompact(stats.totalEvents)}</p>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Tracked pages</p>
          <p className="ov-kpi-number">{stats.trackedPages}</p>
        </div>
        <div className="ov-kpi-cell ov-kpi-cell--bordered">
          <p className="ov-kpi-label">Last event</p>
          <p className="ov-kpi-number">{stats.lastSeen ? timeAgo(stats.lastSeen) : "None"}</p>
        </div>
        <div className="ov-kpi-cell">
          <p className="ov-kpi-label">First seen</p>
          <p className="ov-kpi-number">{stats.firstSeen ? formatDateTime(stats.firstSeen) : "N/A"}</p>
        </div>
      </div>

      {/* ── Main content grid ────────────────────────────────────────── */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr),minmax(340px,0.85fr)]">
        {/* ── Left column ──────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* ── Hero: Tracking script ──────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-text-primary">Tracking Script</h2>
                <p className="mt-1 text-[12px] text-text-secondary">
                  Add this snippet to your site to start collecting analytics data.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => copyText(trackerSnippet)}
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>

            <Textarea
              readOnly
              value={trackerSnippet}
              className="mt-4 min-h-28 font-mono text-xs leading-6"
            />

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/50 bg-white/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Collector origin</p>
                <p className="mt-1 break-all text-xs font-medium text-text-primary">{trackerScript.collectorOrigin}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-white/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Install origin</p>
                <p className="mt-1 break-all text-xs font-medium text-text-primary">{trackerScript.installOrigin}</p>
              </div>
              <div className="rounded-lg border border-border/50 bg-white/60 p-3">
                <p className="text-[10px] uppercase tracking-[0.16em] text-text-muted">Script state</p>
                <p className="mt-1 text-xs font-medium text-text-primary">
                  {trackerScript.isPersisted ? "Persisted in DB" : "Generated fallback"}
                </p>
              </div>
            </div>
          </div>

          {/* ── Installation Guides ────────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h2 className="text-[14px] font-semibold text-text-primary">Installation Guides</h2>
            <p className="mt-1 text-[12px] text-text-secondary">
              Framework-specific instructions for adding the tracking script.
            </p>

            <Tabs defaultValue="html" className="mt-4">
              <TabsList className="flex-wrap h-auto gap-1">
                {INSTALL_GUIDES.map((guide) => (
                  <TabsTrigger key={guide.id} value={guide.id} className="text-xs">
                    {guide.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {INSTALL_GUIDES.map((guide) => (
                <TabsContent key={guide.id} value={guide.id}>
                  <div className="relative">
                    <Textarea
                      readOnly
                      value={guide.code(trackerSnippet)}
                      className="min-h-40 font-mono text-xs leading-6"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="absolute right-2 top-2"
                      onClick={() => copyText(guide.code(trackerSnippet), guide.id)}
                    >
                      {copiedGuide === guide.id ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copiedGuide === guide.id ? "Copied" : "Copy"}
                    </Button>
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </div>

          {/* ── AI Agent Install Helpers ────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h2 className="text-[14px] font-semibold text-text-primary">AI Agent Helpers</h2>
            <p className="mt-1 text-[12px] text-text-secondary">
              Copy a ready-made prompt for your AI coding assistant. It will install the tracker automatically.
            </p>

            <Tabs defaultValue="cursor" className="mt-4">
              <TabsList>
                {AI_AGENT_GUIDES.map((guide) => (
                  <TabsTrigger key={guide.id} value={guide.id} className="text-xs">
                    {guide.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {AI_AGENT_GUIDES.map((guide) => {
                const promptText = guide.prompt(
                  trackerSnippet,
                  site.id,
                  site.origins[0] ?? "",
                );
                return (
                  <TabsContent key={guide.id} value={guide.id}>
                    <div className="relative">
                      <Textarea
                        readOnly
                        value={promptText}
                        className="min-h-48 font-mono text-xs leading-6"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="absolute right-2 top-2"
                        onClick={() => copyText(promptText, `ai-${guide.id}`)}
                      >
                        {copiedGuide === `ai-${guide.id}` ? (
                          <Check className="size-3" />
                        ) : (
                          <Copy className="size-3" />
                        )}
                        {copiedGuide === `ai-${guide.id}` ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </TabsContent>
                );
              })}
            </Tabs>
          </div>
        </div>

        {/* ── Right column ─────────────────────────────────────────── */}
        <div className="space-y-6">
          {/* ── Site info ───────────────────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h2 className="text-[14px] font-semibold text-text-primary">Site</h2>
            <div className="mt-3 flex items-center gap-3">
              <Globe className="size-4 shrink-0 text-accent-teal" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-primary">{site.name || site.id}</p>
                <p className="text-[11px] text-text-muted">{site.origins[0] ?? "No primary origin"}</p>
              </div>
            </div>
            {site.origins.length > 1 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {site.origins.map((origin) => (
                  <span
                    key={origin}
                    className="inline-flex items-center gap-1 rounded-md bg-surface-secondary px-2 py-0.5 text-[10px] font-medium text-text-secondary"
                  >
                    <Globe className="size-2.5" />
                    {origin}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* ── Settings Switches ──────────────────────────────────── */}
          {isControlPlaneMode ? (
            <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
              <h2 className="text-[14px] font-semibold text-text-primary">Privacy &amp; Tracking</h2>
              <p className="mt-1 text-[12px] text-text-secondary">
                Toggle features that affect data collection and visitor privacy.
              </p>

              {privacyMutation.error ? (
                <p className="mt-3 text-sm text-status-error">{privacyMutation.error.message}</p>
              ) : null}

              <div className="mt-4 space-y-2">
                {/* DOM snapshots */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">DOM snapshots</p>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          privacy.domSnapshotsEnabled
                            ? "bg-status-info-bg text-accent-teal"
                            : "bg-surface-secondary text-text-muted"
                        }`}
                      >
                        {privacy.domSnapshotsEnabled ? "On" : "Off"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Structure-only DOM captures for heatmap overlays
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={privacyMutation.isPending}
                    onClick={() => privacyMutation.mutate({ domSnapshotsEnabled: !privacy.domSnapshotsEnabled })}
                  >
                    {privacy.domSnapshotsEnabled ? "Disable" : "Enable"}
                  </Button>
                </div>

                {/* Visitor cookie */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">Visitor cookie</p>
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          privacy.visitorCookieEnabled
                            ? "bg-status-info-bg text-accent-teal"
                            : "bg-surface-secondary text-text-muted"
                        }`}
                      >
                        {privacy.visitorCookieEnabled ? "On" : "Off"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Opt-in cookie for better returning-visitor accuracy
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={privacyMutation.isPending}
                    onClick={() => privacyMutation.mutate({ visitorCookieEnabled: !privacy.visitorCookieEnabled })}
                  >
                    {privacy.visitorCookieEnabled ? "Disable" : "Enable"}
                  </Button>
                </div>

                {/* Block bot traffic (placeholder) */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">Block bot traffic</p>
                      <span className="inline-block rounded bg-status-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">
                        Soon
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Filter known bots and crawlers at ingestion
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled>
                    Enable
                  </Button>
                </div>

                {/* SPA tracking (placeholder) */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">SPA tracking</p>
                      <span className="inline-block rounded bg-status-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">
                        Soon
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Automatic route-change detection for single-page apps
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled>
                    Enable
                  </Button>
                </div>

                {/* Error tracking (placeholder) */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">Error tracking</p>
                      <span className="inline-block rounded bg-status-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">
                        Soon
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Capture JavaScript errors and unhandled rejections
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled>
                    Enable
                  </Button>
                </div>

                {/* Performance tracking (placeholder) */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border/50 bg-white/60 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Shield className="size-3.5 shrink-0 text-text-primary" />
                      <p className="text-[13px] font-medium text-text-primary">Performance tracking</p>
                      <span className="inline-block rounded bg-status-warning-bg px-1.5 py-0.5 text-[10px] font-medium text-accent-amber">
                        Soon
                      </span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-muted">
                      Capture Core Web Vitals and page timing metrics
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" disabled>
                    Enable
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <OpsNotice
              title="Token mode is read-only for privacy controls."
              description="Switch to control-plane mode to manage tracking and privacy settings from this page."
            />
          )}

          {/* ── Retention windows ──────────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h2 className="text-[14px] font-semibold text-text-primary">Data Retention</h2>
            <p className="mt-1 text-[12px] text-text-secondary">
              How long each data category is kept before automatic cleanup.
            </p>

            <div className="ov-list mt-4">
              <div className="ov-list-header">
                <span>Category</span>
                <span>Retention</span>
              </div>
              {[
                { label: "Events", days: retention.eventsDays, color: "bg-accent-teal" },
                { label: "Heatmaps", days: retention.heatmapDays, color: "bg-accent-amber" },
                { label: "Replay", days: retention.replayDays, color: "bg-[#8B5CF6]" },
                { label: "AI Insight", days: retention.insightsDays, color: "bg-[#EC4899]" },
              ].map((item) => (
                <div key={item.label} className="ov-list-row">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block size-2 rounded-full ${item.color}`} />
                    <span className="ov-list-label">{item.label}</span>
                  </div>
                  <span className="ov-list-value">{item.days} days</span>
                </div>
              ))}
            </div>
          </div>

          {/* ── Collection status ──────────────────────────────────── */}
          <div className="section-frame rounded-2xl border border-border/50 p-4 sm:p-5">
            <h2 className="text-[14px] font-semibold text-text-primary">Collection Timeline</h2>
            <div className="ov-list mt-3">
              <div className="ov-list-row">
                <span className="ov-list-label">First event</span>
                <span className="ov-list-value">
                  {stats.firstSeen ? formatDateTime(stats.firstSeen) : "N/A"}
                </span>
              </div>
              <div className="ov-list-row">
                <span className="ov-list-label">Last event</span>
                <span className="ov-list-value">
                  {stats.lastSeen ? formatDateTime(stats.lastSeen) : "N/A"}
                </span>
              </div>
              <div className="ov-list-row">
                <span className="ov-list-label">Total events</span>
                <span className="ov-list-value">{formatCompact(stats.totalEvents)}</span>
              </div>
              <div className="ov-list-row">
                <span className="ov-list-label">Tracked pages</span>
                <span className="ov-list-value">{stats.trackedPages}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
