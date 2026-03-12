# Current Route Inventory

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### Public Routes

#### `/`
- Purpose: marketing landing page
- Current component: `apps/web/components/marketing/marketing-page.tsx`
- Notes: already more styled than many protected pages, but not part of the analytics workspace

#### `/auth/sign-in`
- Purpose: dashboard access
- Current component: `apps/web/components/auth/sign-in-form.tsx`
- Notes: supports control-plane account auth or token mode depending on environment

#### `/share/[slug]`
- Purpose: shared dashboard link entry point
- Notes: should be considered during the revamp so public shares do not visually drift from the main product

### Main Sidebar Routes

#### `/dashboard`
- Nav label: `Main`
- Component: `dashboard-overview.tsx`
- Status: functional, but visually dense in the wrong places and missing better metric storytelling

#### `/map`
- Nav label: `Realtime`
- Component: `map-view.tsx`
- Status: this is actually the geo globe page, not the live activity feed
- Revamp implication: this should become the main realtime geography surface

#### `/goals`
- Nav label: `Goals`
- Component: `goals-view.tsx`
- Status: has CRUD and reporting support, but the experience is still too plain and not product-grade

#### `/events`
- Nav label: `Events`
- Component: `events-view.tsx`
- Status: reasonably developed, but still needs the merged live activity story and a cleaner visual system

#### `/heatmaps`
- Nav label: `Heatmaps`
- Component: `heatmaps-view.tsx`
- Status: wired, confidence-aware, but current interaction controls and visual plotting are not at the quality bar

#### `/session-replay`
- Nav label: `Replay`
- Component: `replays-view.tsx`
- Status: functional queue plus player, but layout, privacy behavior, and presentation need major rework

#### `/realtime`
- Nav label: `Live Activity`
- Component: `realtime-view.tsx`
- Status: separate operator board today
- Revamp implication: merge into `Events` and remove from sidebar

#### `/funnels`
- Nav label: `Funnels`
- Component: `funnels-view.tsx`
- Status: saved funnel logic exists, but the current UX is still too generic

#### `/journeys`
- Nav label: `Journeys`
- Component: `journeys-view.tsx`
- Status: partially modeled and falls back to replay or top-page approximations

#### `/retention`
- Nav label: `Retention`
- Component: `retention-view.tsx`
- Status: provisional and derived from summary timeseries, not true retention cohorts

#### `/ai-insight`
- Nav label: `Insights`
- Component: `insights-view.tsx`
- Status: live AI/rules surface exists, but generation flow and presentation need a full rebuild

#### `/users`
- Nav label: `Users`
- Component: `users-view.tsx`
- Status: intentionally privacy-safe sampled profiles, not a complete user model

#### `/cohorts`
- Nav label: `Segments`
- Component: `cohorts-view.tsx`
- Status: hard-coded filters and replay-based grouping, not a real segment/cohort engine

#### `/alerts`
- Nav label: `Alerts`
- Component: `alerts-view.tsx`
- Status: CRUD exists, but notifications and integrations are far from finished

#### `/integrations`
- Nav label: `Integrations`
- Component: `integrations-view.tsx`
- Status: currently mixes API keys, shared links, export examples, and snippets

#### `/settings`
- Nav label: `Site Settings`
- Component: `project-settings-view.tsx`
- Status: current page is broader project controls, not the full installation/import/settings hub you want

### Hidden Or Secondary Routes

#### `/sites`
- Component: `sites-view.tsx`
- Role: multi-site portfolio, origins, shared links, and API keys

#### `/reports`
- Component: `reports-view.tsx`
- Role: report config persistence, but delivery still unfinished

#### `/errors`
- Component: `errors-view.tsx`
- Role: replay plus AI issue board

#### `/performance`
- Component: `performance-view.tsx`
- Role: beta performance board built from proxy signals

#### `/ai-analysis`
- Component: `ai-analysis-view.tsx`
- Role: overlapping analysis page that should be merged, renamed, or removed

#### `/sessions`
- Component: `replays-view.tsx`
- Role: duplicate replay alias
- Revamp implication: redirect or remove to avoid duplicate IA
- Dedicated legacy note: see `frontend/pages/25-sessions-legacy.md`

---

## Backend — Codex

### Route Decisions For The Revamp

- Turn the current geo page into the canonical `Realtime` experience.
- Merge the current `Live Activity` page into `Events`.
- Decide whether `/map` becomes `/realtime` or remains as an internal compatibility route.
- Remove duplicate or drifting surfaces such as `/sessions` and likely `/ai-analysis`.
- Expose hidden pages only if they earn a permanent IA slot after redesign.

> Backend responsibility here is implementing redirects, retiring unused API routes, and ensuring route changes don't break data pipelines:

- Implement redirect from `/sessions` to `/session-replay`
- Implement redirect from `/ai-analysis` to `/ai-insight`
- Merge live activity API data into events API
- Remove or redirect standalone `/realtime` API if it exists separately
