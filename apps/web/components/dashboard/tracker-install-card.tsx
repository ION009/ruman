"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { DashboardSettingsResponse } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

const defaultSteps = [
  "1. Install — Place snippet before </head>",
  "2. Verify — Visit your site and watch for the first event",
  "3. Inspect — Review overview, heatmaps, and replay as data lands",
];

type TrackerInstallCardProps = {
  trackerSnippet: string;
  trackerScript: DashboardSettingsResponse["trackerScript"];
  title?: string;
  description?: string;
  badgeLabel?: string;
  className?: string;
  compact?: boolean;
  steps?: string[];
};

export function TrackerInstallCard({
  trackerSnippet,
  trackerScript,
  title = "Tracker snippet",
  description,
  badgeLabel,
  className,
  compact = false,
  steps = defaultSteps,
}: TrackerInstallCardProps) {
  const [copied, setCopied] = useState(false);

  return (
    <Card className={cn("section-frame rounded-2xl", className)}>
      <CardHeader className={cn("pb-2", compact ? "px-5 pt-5" : undefined)}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            {badgeLabel ? (
              <Badge variant="secondary" className="w-fit text-[10px]">
                {badgeLabel}
              </Badge>
            ) : null}
            <div>
              <CardTitle>{title}</CardTitle>
              {description ? <CardDescription className="mt-2 max-w-2xl">{description}</CardDescription> : null}
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={async () => {
              await navigator.clipboard.writeText(trackerSnippet);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className={cn("space-y-4", compact ? "px-5 pb-5 pt-0" : undefined)}>
        <Textarea
          readOnly
          value={trackerSnippet}
          className={cn("font-mono text-xs leading-6", compact ? "min-h-24" : "min-h-32")}
        />

        <div className={cn("grid gap-3", compact ? "lg:grid-cols-3" : "sm:grid-cols-3")}>
          <div className="rounded-xl border border-border/70 bg-white/62 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Collector origin</p>
            <p className="mt-1 break-all text-xs font-medium">{trackerScript.collectorOrigin}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-white/62 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Install origin</p>
            <p className="mt-1 break-all text-xs font-medium">{trackerScript.installOrigin}</p>
          </div>
          <div className="rounded-xl border border-border/70 bg-white/62 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Script state</p>
            <p className="mt-1 text-xs font-medium">{trackerScript.isPersisted ? "Persisted in DB" : "Generated fallback"}</p>
          </div>
        </div>

        {steps.length > 0 ? (
          <div className={cn("grid gap-3", compact ? "lg:grid-cols-3" : "sm:grid-cols-3")}>
            {steps.map((step) => (
              <div key={step} className="rounded-xl border border-border/70 bg-white/62 p-3 text-xs text-muted-foreground">
                {step}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
