"use client";

import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowRight,
  Flame,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Waves,
} from "lucide-react";
import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const DEMO_DASHBOARD_TOKEN = "demo-dashboard-token";

const accountNotes = [
  { title: "Neon-backed identity", icon: ShieldCheck },
  { title: "Per-site isolation", icon: Sparkles },
  { title: "ClickHouse stays fast", icon: KeyRound },
];

const tokenNotes = [
  { title: "Token-backed access", icon: KeyRound },
  { title: "Protected routes", icon: ShieldCheck },
  { title: "Demo-friendly flow", icon: Sparkles },
];

async function createTokenSession(token: string) {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to create session.");
  }
}

async function createAccountSession(input: { email: string; password: string }) {
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to sign in.");
  }
}

async function registerAccount(input: {
  fullName: string;
  email: string;
  password: string;
  siteName: string;
  domain: string;
}) {
  const response = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "Failed to create account.");
  }
}

export function SignInForm({
  nextPath,
  authMode,
}: {
  nextPath: string;
  authMode: "account" | "token";
}) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [siteName, setSiteName] = useState("");
  const [origin, setOrigin] = useState("");

  const tokenSessionMutation = useMutation({
    mutationFn: createTokenSession,
    onSuccess: () => {
      startTransition(() => {
        router.push(nextPath || "/dashboard");
        router.refresh();
      });
    },
  });

  const accountSessionMutation = useMutation({
    mutationFn: createAccountSession,
    onSuccess: () => {
      startTransition(() => {
        router.push(nextPath || "/dashboard");
        router.refresh();
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: registerAccount,
    onSuccess: () => {
      startTransition(() => {
        router.push(nextPath || "/dashboard");
        router.refresh();
      });
    },
  });

  const accessNotes = authMode === "account" ? accountNotes : tokenNotes;

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6 lg:grid lg:grid-cols-[1fr,420px] lg:gap-8 lg:px-10">
      <section className="section-frame grain-mask dashboard-orbit relative hidden overflow-hidden rounded-2xl p-8 lg:flex lg:flex-col lg:justify-center lg:self-stretch">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_14%_18%,rgba(255,212,139,0.42),transparent_28%),radial-gradient(circle_at_86%_18%,rgba(15,167,181,0.18),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.36),rgba(255,255,255,0.12))]" />
        <div className="relative z-10 space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-white shadow-lg">
                <Waves className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold text-text-primary">AnlticsHeat</p>
                <p className="text-xs text-text-secondary">
                  {authMode === "account" ? "Control plane" : "Operator access"}
                </p>
              </div>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/">Back to site</Link>
            </Button>
          </div>

          <div className="space-y-3">
            <span className="inline-block rounded-md bg-surface-secondary px-2 py-0.5 text-[10px] font-medium text-text-secondary">
              {authMode === "account" ? "Account + site onboarding" : "Token-gated access"}
            </span>
            <h1 className="headline-balance max-w-[16ch] font-serif text-3xl tracking-[-0.04em] text-text-primary xl:text-4xl">
              {authMode === "account"
                ? "Register sites, isolate every customer stream."
                : "Walk into the warm room, not a cold login wall."}
            </h1>
            <p className="max-w-md text-sm text-muted-foreground">
              {authMode === "account"
                ? "Users and site settings live in Neon. Events and heatmaps stay in ClickHouse."
                : "Enter your token to access overview, heatmaps, AI insight, and settings."}
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {accessNotes.map(({ title, icon: Icon }) => (
              <div key={title} className="flex items-center gap-2 rounded-xl border border-border/70 bg-surface-primary/70 px-4 py-2.5 text-sm shadow-sm">
                <Icon className="size-4 text-accent-teal" />
                <span className="font-medium">{title}</span>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border/70 bg-[#211c17] p-4 text-white">
            <p className="eyebrow text-[10px] text-white/50">After sign-in</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {["Overview metrics", "Heatmap overlays", "AI insight queue", "Site settings"].map((item) => (
                <div key={item} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/70">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="flex w-full items-center justify-center lg:py-8">
        <div className="section-frame w-full max-w-[420px] overflow-hidden rounded-2xl border border-border/50 p-6">
          <div className="space-y-3 pb-2">
            <div className="flex items-center justify-between gap-4">
              <div className="flex size-10 items-center justify-center rounded-full bg-foreground text-white shadow-lg">
                <Flame className="size-4" />
              </div>
              <span className="inline-block rounded-md bg-surface-secondary px-2 py-0.5 text-[10px] font-medium text-text-secondary lg:hidden">
                {authMode === "account" ? "Neon account" : "Token gate"}
              </span>
            </div>

            <h2 className="font-serif text-2xl tracking-[-0.04em] text-text-primary">
              {authMode === "account" ? "Access the control plane" : "Unlock mission control"}
            </h2>
            <p className="text-[13px] text-text-secondary">
              {authMode === "account"
                ? "Sign in or create a new workspace."
                : "Enter the dashboard token to start your session."}
            </p>
          </div>

          <div className="space-y-4 pt-2">
            {authMode === "account" ? (
              <Tabs defaultValue="sign-in">
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                  <TabsTrigger value="register">Create account</TabsTrigger>
                </TabsList>

                <TabsContent value="sign-in">
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      accountSessionMutation.mutate({ email, password });
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="email">Work email</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="team@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="password">Password</Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-9"
                      />
                    </div>

                    {accountSessionMutation.error ? (
                      <p className="text-sm text-destructive">{accountSessionMutation.error.message}</p>
                    ) : null}

                    <Button type="submit" className="w-full" disabled={accountSessionMutation.isPending}>
                      {accountSessionMutation.isPending ? "Signing in..." : "Sign in"}
                      <ArrowRight />
                    </Button>
                  </form>
                </TabsContent>

                <TabsContent value="register">
                  <form
                    className="space-y-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      registerMutation.mutate({
                        fullName,
                        email,
                        password,
                        siteName,
                        domain: origin,
                      });
                    }}
                  >
                    <div className="space-y-1.5">
                      <Label htmlFor="fullName">Full name</Label>
                      <Input
                        id="fullName"
                        name="fullName"
                        autoComplete="name"
                        placeholder="Alex Morgan"
                        value={fullName}
                        onChange={(event) => setFullName(event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="siteName">Site name</Label>
                        <Input
                          id="siteName"
                          name="siteName"
                          placeholder="Marketing site"
                          value={siteName}
                          onChange={(event) => setSiteName(event.target.value)}
                          className="h-9"
                        />
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="origin">Primary domain</Label>
                        <Input
                          id="origin"
                          name="origin"
                          placeholder="example.com"
                          value={origin}
                          onChange={(event) => setOrigin(event.target.value)}
                          className="h-9"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="registerEmail">Email</Label>
                      <Input
                        id="registerEmail"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder="alex@company.com"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="h-9"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="registerPassword">Password</Label>
                      <Input
                        id="registerPassword"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        placeholder="Create a password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="h-9"
                      />
                    </div>

                    {registerMutation.error ? (
                      <p className="text-sm text-destructive">{registerMutation.error.message}</p>
                    ) : null}

                    <Button type="submit" className="w-full" disabled={registerMutation.isPending}>
                      {registerMutation.isPending ? "Creating account..." : "Create account"}
                      <ArrowRight />
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  tokenSessionMutation.mutate(token);
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="token">Dashboard token</Label>
                  <Input
                    id="token"
                    name="token"
                    placeholder="demo-dashboard-token"
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    className="h-9"
                  />
                </div>

                <div className="rounded-xl border border-border/70 bg-surface-primary/60 p-4 text-sm text-muted-foreground">
                  Use <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{DEMO_DASHBOARD_TOKEN}</code> for the local demo flow.
                </div>

                {tokenSessionMutation.error ? (
                  <p className="text-sm text-destructive">{tokenSessionMutation.error.message}</p>
                ) : null}

                <Button type="submit" className="w-full" disabled={tokenSessionMutation.isPending}>
                  {tokenSessionMutation.isPending ? "Starting session..." : "Enter dashboard"}
                  <ArrowRight />
                </Button>
              </form>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
