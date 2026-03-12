import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Flame,
  Radar,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";

import { Button } from "@/components/ui/button";

const featureCards = [
  {
    title: "Thermal storytelling",
    body: "Heatmaps, funnels, and realtime motion live in one narrative surface instead of three disconnected tools.",
    icon: Flame,
  },
  {
    title: "Fast privacy posture",
    body: "Short-lived sessions, no cookies, no fingerprinting, and a dashboard that never ships to customer browsers.",
    icon: ShieldCheck,
  },
  {
    title: "Operator-grade signal",
    body: "Rage clicks, scroll drop-offs, source quality, and design dead zones turn into immediate product decisions.",
    icon: Radar,
  },
];

const previewCards = [
  {
    title: "Marketing site",
    description: "Editorial hero compositions, heat-toned gradients, and a clear product story.",
    href: "/",
  },
  {
    title: "Auth flow",
    description: "Token-gated access that feels premium instead of utilitarian.",
    href: "/auth/sign-in",
  },
  {
    title: "Dashboard suite",
    description: "Overview, heatmaps, AI insight, and settings built as one system.",
    href: "/dashboard",
  },
];

const workflowCards = [
  {
    title: "Collect lightly",
    body: "The tracker stays small, first-party, and privacy-aware so the product story starts with restraint instead of surveillance.",
  },
  {
    title: "Read behavior visually",
    body: "Overview metrics, heatmaps, and AI insight feeds work as one connected operator system rather than separate tabs with no narrative.",
  },
  {
    title: "Ship fixes faster",
    body: "Dead zones, rage clicks, and scroll drop-offs become explicit product work instead of vague hunches in a meeting.",
  },
];

export function MarketingPage() {
  return (
    <main className="relative isolate overflow-hidden">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 pb-16 pt-4 sm:px-6 lg:px-8">
        <header className="section-frame grain-mask rounded-[2rem] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background shadow-lg">
                <Waves className="size-5" />
              </div>
              <div>
                <p className="eyebrow text-[11px] text-muted-foreground">AnlticsHeat</p>
                <p className="text-sm text-foreground/70">Thermal analytics for teams shipping fast</p>
              </div>
            </div>
            <nav className="hidden items-center gap-6 text-sm text-foreground/70 md:flex">
              <a href="#product">Product</a>
              <a href="#surfaces">Surfaces</a>
              <a href="#privacy">Privacy</a>
            </nav>
            <div className="flex items-center gap-2">
              <Button asChild variant="ghost" size="sm">
                <Link href="/auth/sign-in">Sign in</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/dashboard">
                  Open dashboard
                  <ArrowRight />
                </Link>
              </Button>
            </div>
          </div>
        </header>

        <section className="relative grid flex-1 items-center gap-10 py-14 lg:grid-cols-[minmax(0,1.05fr),minmax(360px,0.95fr)] lg:py-20">
          <div className="relative z-10 space-y-8">
            <span className="inline-block rounded-md bg-surface-secondary px-2.5 py-1 text-[11px] font-medium text-text-secondary">
              Editorial analytics, not another sterile SaaS shell
            </span>
            <div className="space-y-6">
              <h1 className="headline-balance font-serif text-[clamp(3.5rem,7vw,7rem)] leading-[0.92] tracking-[-0.06em] text-balance text-foreground">
                Make behavior feel visible before it becomes a spreadsheet.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground sm:text-xl">
                AnlticsHeat turns pageviews, scrolls, clicks, and friction patterns into a warm, legible command surface.
                The memorable hook is simple: it reads like an editorial atlas, but behaves like a serious analytics tool.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/auth/sign-in">
                  Start with the auth flow
                  <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/dashboard">Preview dashboard pages</Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[1.75rem] border border-border/70 bg-surface-primary/55 dark:bg-surface-primary/10 p-5 shadow-sm">
                <p className="eyebrow text-[11px] text-muted-foreground">Realtime</p>
                <p className="mt-3 text-3xl font-semibold">64</p>
                <p className="mt-2 text-sm text-muted-foreground">visitors live in the demo stream</p>
              </div>
              <div className="rounded-[1.75rem] border border-border/70 bg-surface-primary/55 dark:bg-surface-primary/10 p-5 shadow-sm">
                <p className="eyebrow text-[11px] text-muted-foreground">Scroll depth</p>
                <p className="mt-3 text-3xl font-semibold">62%</p>
                <p className="mt-2 text-sm text-muted-foreground">average depth across flagship pages</p>
              </div>
              <div className="rounded-[1.75rem] border border-border/70 bg-surface-primary/55 dark:bg-surface-primary/10 p-5 shadow-sm">
                <p className="eyebrow text-[11px] text-muted-foreground">Rage clusters</p>
                <p className="mt-3 text-3xl font-semibold">18</p>
                <p className="mt-2 text-sm text-muted-foreground">high-friction moments worth fixing first</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-x-10 top-4 h-72 rounded-full bg-[radial-gradient(circle,rgba(239,122,41,0.32),transparent_66%)] blur-3xl" />
            <div className="absolute -left-8 bottom-10 size-44 rounded-full bg-[radial-gradient(circle,rgba(15,167,181,0.16),transparent_72%)] blur-3xl" />
            <div className="section-frame topo-lines relative overflow-hidden rounded-[2.5rem] border border-white/40 p-5 shadow-[0_24px_90px_rgba(31,22,16,0.12)] sm:p-6">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr),220px]">
                <div className="space-y-4 rounded-[2rem] bg-[#1e1b17] p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="eyebrow text-[11px] text-white/50">Mission control</p>
                      <p className="mt-2 text-2xl font-semibold">Dashboards with heat in them</p>
                    </div>
                    <Sparkles className="size-5 text-[#ffd48b]" />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/45">Pages</p>
                      <div className="mt-4 space-y-3">
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-2 w-[82%] rounded-full bg-[#ef7a29]" />
                        </div>
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-2 w-[65%] rounded-full bg-[#0fa7b5]" />
                        </div>
                        <div className="h-2 rounded-full bg-white/10">
                          <div className="h-2 w-[49%] rounded-full bg-[#ffd48b]" />
                        </div>
                      </div>
                    </div>
                    <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.2em] text-white/45">AI insight feed</p>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-full bg-white/8 px-3 py-2 text-sm">Rage clicks on pricing switch</div>
                        <div className="rounded-full bg-white/8 px-3 py-2 text-sm">Hero copy cools before proof</div>
                        <div className="rounded-full bg-white/8 px-3 py-2 text-sm">LinkedIn traffic reads deeper</div>
                      </div>
                    </div>
                  </div>
                  <div className="rounded-[1.6rem] border border-white/10 bg-gradient-to-r from-white/8 to-transparent p-4">
                    <p className="eyebrow text-[11px] text-white/45">Heat signature</p>
                    <div className="mt-4 flex gap-2">
                      {["22%", "48%", "76%"].map((stop, index) => (
                        <div
                          key={stop}
                          className="h-36 flex-1 rounded-[1.4rem]"
                          style={{
                            background:
                              index === 0
                                ? "radial-gradient(circle at 30% 35%, rgba(239,122,41,0.92), transparent 45%), #2f2722"
                                : index === 1
                                  ? "radial-gradient(circle at 48% 58%, rgba(255,191,77,0.88), transparent 48%), #2f2722"
                                  : "radial-gradient(circle at 70% 30%, rgba(15,167,181,0.82), transparent 44%), #2f2722",
                          }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="grid gap-4">
                  <div className="rounded-[1.8rem] border border-border/70 bg-surface-primary/72 dark:bg-surface-primary/12 p-5">
                    <p className="eyebrow text-[11px] text-muted-foreground">Today</p>
                    <p className="mt-3 text-4xl font-semibold">9.1k</p>
                    <p className="mt-2 text-sm text-muted-foreground">pageviews in the demo overview</p>
                  </div>
                  <div className="rounded-[1.8rem] border border-border/70 bg-surface-primary/72 dark:bg-surface-primary/12 p-5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Activity className="size-4 text-primary" />
                      Live product rhythm
                    </div>
                    <div className="mt-4 space-y-2">
                      {[72, 44, 90, 58, 66].map((height, index) => (
                        <div key={height} className="flex items-end gap-2">
                          <div className="w-10 text-xs text-muted-foreground">0{index + 1}</div>
                          <div
                            className="flex-1 rounded-full bg-gradient-to-r from-primary/85 via-chart-4/70 to-chart-2/60"
                            style={{ height }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[1.8rem] border border-border/70 bg-[#201b17] p-5 text-white">
                    <p className="eyebrow text-[11px] text-white/45">Demo access</p>
                    <p className="mt-3 text-xl font-semibold">Use `demo-dashboard-token`</p>
                    <p className="mt-2 text-sm text-white/60">The auth page accepts the same token as the Go API default.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="grid gap-5 py-8 md:grid-cols-3">
          {featureCards.map(({ title, body, icon: Icon }) => (
            <div key={title} className="section-frame overflow-hidden rounded-2xl border border-border/50 p-6">
              <div className="relative">
                <div className="absolute right-0 top-0 flex size-10 items-center justify-center rounded-full bg-accent-teal/10 text-accent-teal">
                  <Icon className="size-5" />
                </div>
                <h3 className="max-w-[12ch] font-serif text-2xl tracking-[-0.04em] text-text-primary">{title}</h3>
                <p className="mt-2 max-w-sm text-[13px] leading-6 text-text-secondary">{body}</p>
              </div>
            </div>
          ))}
        </section>

        <section id="surfaces" className="py-10">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-[11px] text-muted-foreground">Surfaces</p>
              <h2 className="headline-balance mt-3 font-serif text-5xl tracking-[-0.05em]">One design system, three distinct front doors.</h2>
            </div>
            <p className="max-w-xl text-sm leading-7 text-muted-foreground">
              The marketing page sells the product, the auth page earns trust, and the dashboard reads like a premium operations desk.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {previewCards.map((card) => (
              <div key={card.title} className="section-frame rounded-2xl border border-border/50 overflow-hidden p-6">
                <div className="mb-5 rounded-xl border border-border/50 bg-[#1e1b17] p-5 text-white">
                  <div className="grid gap-3">
                    <div className="flex gap-2">
                      <span className="size-3 rounded-full bg-[#ff8c6b]" />
                      <span className="size-3 rounded-full bg-[#ffd48b]" />
                      <span className="size-3 rounded-full bg-[#0fa7b5]" />
                    </div>
                    <div className="grid gap-2">
                      <div className="h-3 w-1/2 rounded-full bg-white/15" />
                      <div className="h-24 rounded-xl bg-gradient-to-br from-white/10 to-transparent" />
                      <div className="grid grid-cols-3 gap-2">
                        <div className="h-12 rounded-lg bg-white/8" />
                        <div className="h-12 rounded-lg bg-white/8" />
                        <div className="h-12 rounded-lg bg-white/8" />
                      </div>
                    </div>
                  </div>
                </div>
                <h3 className="text-xl font-semibold tracking-tight text-text-primary">{card.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-text-secondary">{card.description}</p>
                <Button asChild variant="ghost" className="mt-4 px-0">
                  <Link href={card.href}>
                    Open surface
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className="py-10">
          <div className="section-frame grain-mask dashboard-orbit rounded-[2.5rem] p-6 sm:p-8 lg:p-10">
            <div className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr),minmax(0,1.1fr)]">
              <div>
                <p className="eyebrow text-[11px] text-muted-foreground">Operator flow</p>
                <h2 className="headline-balance mt-3 font-serif text-5xl tracking-[-0.05em]">
                  The product is strongest when the story flows from collection to action without changing tone.
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-8 text-muted-foreground">
                  That is why the auth page feels like part of the app, the dashboard reads like a control desk, and the settings page verifies
                  whether install and retention are actually healthy instead of hiding them behind a utility screen.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                {workflowCards.map((card, index) => (
                  <div key={card.title} className={`rounded-[1.9rem] border border-border/70 p-5 ${index === 1 ? "bg-[#201b17] text-white" : "bg-surface-primary/72 dark:bg-surface-primary/12"}`}>
                    <p className={`eyebrow text-[11px] ${index === 1 ? "text-white/48" : "text-muted-foreground"}`}>
                      0{index + 1}
                    </p>
                    <p className="mt-4 text-xl font-semibold tracking-tight">{card.title}</p>
                    <p className={`mt-3 text-sm leading-7 ${index === 1 ? "text-white/72" : "text-muted-foreground"}`}>{card.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
