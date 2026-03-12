# Deep Sweep Audit

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

This file records what changed after the second, deeper documentation sweep across the frontend, dashboard API routes, control-plane helpers, tracker package, and Go analytics backend.

## What The First Docs Pass Already Covered Correctly

- every major dashboard page received its own spec
- hidden and secondary pages were included
- shared shell, design system, privacy, calendar, and Neo got dedicated docs
- the checklist already covered the large revamp phases well
- the docs correctly called out LongCat-only AI Insights and the Live Activity merge into Events

---

## Frontend — Claude

### Corrections (Frontend-Relevant)

#### Auth
- The auth route is not only a sign-in form.
- It already supports: token mode, account sign-in, account creation, initial site and domain capture, `next` redirect preservation
- The docs now preserve that broader auth-plus-onboarding behavior.

#### Heatmaps
- The current pipeline already supports: viewport segmentation, confidence scoring, screenshot storage, DOM snapshot loading, page discovery fallback
- The redesign should reuse these primitives and improve precision and presentation, not replace them blindly.

#### Calendar
- The revamp is not only visual. It also needs state decisions.
- There is currently only a single active date range model.
- The docs now require a deliberate compare-range strategy if compare mode becomes core.

#### Legacy Route Cleanup
- `/sessions` ships as a real duplicate replay route today.
- It now has explicit legacy-route documentation rather than being only a stray bullet in inventory.

---

## Backend — Codex

### Corrections (Backend-Relevant)

#### Site Settings
- Import is a full net-new build. There is no current file-import pipeline.
- The codebase does already have: tracker snippet/script generation, site origin management, privacy toggles, sitemap and crawl-based site page discovery, onboarding and heatmap screenshot capture helpers
- The routed `/settings` page is currently broader `Project Controls`, not just installation.
- There is also an overlapping legacy `settings-view.tsx` that should not survive by accident.
- The revamp docs now distinguish reusable foundations from brand-new import work.

#### Session Replay
- The tracker already supports selective replay privacy controls: `data-replay-block`, `data-replay-ignore`, `data-replay-unmask`
- The docs now say more clearly that the replay redesign should build on selective blocking instead of masking whole pages.

#### Goals
- Goal CRUD already exists in the control plane.
- Supported goal shape: `pageview` or `event`, `exact`/`prefix`/`contains`, optional `currency`
- The revamp is therefore a product and workflow rebuild, not zero-to-one storage.

#### Funnels
- Funnel persistence and analytics already exist.
- Current constraints: page/event steps, exact/prefix matching, sessions/visitors counting, 2-8 steps, 1-1440 minute windows
- The revamp is primarily a UX and product-shape upgrade on top of real foundations.

#### Users
- The current page is strictly replay-summary driven.
- It does not currently have native country, state, or long-lived user modeling in the replay summary contract.
- The requested premium user table requires new backend aggregate modeling.

#### Segments And Cohorts
- There is currently no real segment or cohort backend surface.
- The existing `CohortsView` is hard-coded replay filtering only.
- This is a true zero-to-one backend and product build.

#### Retention
- There is currently no real retention API surface.
- The existing page computes placeholder cohort decay from summary timeseries.
- The retention redesign requires true backend cohort logic.

#### Alerts
- Alerts are more real than the first docs implied: storage exists, metric thresholds exist, a backend checker runs, webhook delivery exists
- But the current system only supports one webhook URL per alert.
- Email, Slack, and additional channels are still new modeling and delivery work.

#### Reports
- Report configuration persistence is real.
- Delivery execution is not.
- The current config model already stores: frequency, delivery time, timezone, recipients, included sections, compare enabled, enabled status
- The redesign should not describe reports as completely unbuilt.

#### AI Insights
- AI Insights already runs in the Go analytics backend, not inside the Next.js web app.
- The current engine already applies strong privacy exclusions and returns an audit trail.
- LongCat is already the default backend base URL and model family for AI Insights config.
- The revamp should rebuild the page UX and improve the input packaging strategy without discarding the backend engine foundations.

#### Neo
- Neo already has: a web route, provider registry, planner and synthesis logic, a tool registry, page-aware context, some safe mutation support such as profile updates
- The revamp should expand and harden this foundation instead of describing Neo as if nothing exists yet.

#### Shared Dashboard
- Shared dashboards already exist and are password-protectable.
- Current shared payload is intentionally limited: summary, one heatmap snapshot, seven-day window
- The public share flow also includes a password wall, error states, and CTA back to the full dashboard.
- If the shared product expands later, the scope should be a deliberate product decision.

---

## Remaining Documentation Risk

The remaining risk is not missing page coverage. The remaining risk is implementation drift:

- polishing a page without fixing the backend gap it depends on (Backend — Codex)
- rebuilding a page without reusing the real support already present (Backend — Codex)
- accidentally treating sampled or proxy data as final truth (Both Claude and Codex)

Use this file together with the page specs and checklist to avoid those mistakes.
