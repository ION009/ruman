"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function OpsHero({
  eyebrow,
  title,
  description,
  actions,
  aside,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <Card className="section-frame overflow-hidden rounded-2xl">
      <CardContent className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr),320px]">
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="eyebrow text-[11px] text-muted-foreground">{eyebrow}</p>
            <div className="space-y-2">
              <h2 className="headline-balance text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
            </div>
          </div>
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>

        {aside ? (
          <div className="rounded-[1.5rem] border border-border/70 bg-white/60 p-4">{aside}</div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OpsMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  accent?: "default" | "warning" | "critical" | "info";
}) {
  return (
    <div className="rounded-[1.4rem] border border-border/70 bg-white/68 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="eyebrow text-[10px] text-muted-foreground">{label}</p>
          <p className="text-2xl font-semibold tracking-tight">{value}</p>
        </div>
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl border",
            accent === "critical" && "border-chart-5/20 bg-chart-5/10 text-chart-5",
            accent === "warning" && "border-chart-4/20 bg-chart-4/12 text-amber-700 dark:text-amber-400",
            accent === "info" && "border-chart-2/20 bg-chart-2/10 text-chart-2",
            accent === "default" && "border-primary/20 bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-4.5" />
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

export function OpsNotice({
  title,
  description,
  tone = "default",
}: {
  title: string;
  description: string;
  tone?: "default" | "warning" | "critical" | "info";
}) {
  return (
    <div
      className={cn(
        "rounded-[1.4rem] border px-4 py-3",
        tone === "critical" && "border-chart-5/30 bg-chart-5/8 text-foreground",
        tone === "warning" && "border-chart-4/30 bg-chart-4/10 text-foreground",
        tone === "info" && "border-chart-2/30 bg-chart-2/8 text-foreground",
        tone === "default" && "border-border/70 bg-white/58 text-foreground",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export function OpsStatusBadge({
  children,
  tone = "secondary",
}: {
  children: ReactNode;
  tone?: "secondary" | "info" | "warning" | "critical";
}) {
  return (
    <Badge variant={tone} className="text-[10px] uppercase tracking-[0.14em]">
      {children}
    </Badge>
  );
}
