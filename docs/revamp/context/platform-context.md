# Platform Context

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Product Summary

AnlticsHeat is a privacy-first web analytics platform with a Next.js dashboard, a Go ingestion and analytics API, a browser tracker package, a ClickHouse-backed analytics layer, and a Neon-backed control plane.

Current product pillars visible in the repo:

- Overview analytics: pageviews, sessions, visitors, referrers, devices, browsers, and scroll depth.
- Event explorer: grouped event families, properties, statuses, privacy notes, and live feed.
- Geo/realtime map: coarse visitor geography with privacy floor handling.
- Heatmaps: click, rage, dead, error, move, and scroll modes with confidence scoring.
- Session replay: sampled replay sessions, masked and blockable DOM capture, issue flags, and chunked playback.
- Funnels and goals: saved definitions plus reporting surfaces.
- AI insight: rule-driven plus AI-generated product findings from anonymized aggregates.
- Neo chat panel: in-product copilot with tool access to dashboard context and selected product operations.
- Control-plane setup: tracker snippet, privacy settings, site portfolio, API keys, shared links, report configs, and alerts.

---

## Frontend — Claude

### Frontend Context

Current frontend shape:

- Framework: Next.js app router in `apps/web`.
- Protected dashboard routes share one shell through `apps/web/app/(protected)/layout.tsx`.
- Navigation, top bar behavior, site switching, and the Neo panel live in `apps/web/components/dashboard/dashboard-chrome.tsx`.
- Route pages mostly wrap one view component per page from `apps/web/components/dashboard/`.

### Product Reality Check (Frontend)

The current repo already contains real frontend work for:
- Dashboard views for all major pages
- Heatmap screenshot and DOM snapshot display
- Goals, Funnels, Alerts, Reports CRUD interfaces
- Marketing landing page
- Auth sign-in flow

At the same time, several visible pages are still partial or provisional:
- `Users` is explicitly a launch-safe sampled profile surface.
- `Cohorts` is built from hard-coded replay-session filters rather than a true segment engine.
- `Retention` simulates retention from summary timeseries instead of reading cohort tables.
- `Performance` is marked as beta and derives risk from existing signals because full web vitals ingestion is not done.
- `Live Activity` should be merged into `Events` based on your new direction.
- `AI Analysis` and some hidden routes need a clear role or removal plan.

### What This Revamp Must Do (Frontend)
- Rebuild the dashboard into a tighter, premium, analytics-native interface.
- Resize cards to content instead of forcing oversized empty containers.
- Replace weak list and divider treatments with stronger visual hierarchy, charts, and compact panels.
- Increase trust by making privacy posture and confidence visible without turning the UI into a warning wall.
- Create a reusable system so every future page feels like part of one premium product.

---

## Backend — Codex

### Backend Context

Current backend shape:

- Go API in `apps/api`.
- Tracker package in `packages/tracker`.
- ClickHouse analytics storage plus Neon control-plane migrations in `db/`.
- Dashboard API routes in `apps/web/app/api/dashboard/` bridge the web app to analytics and control-plane data.

### Tracker And Privacy Context

Current tracker capabilities visible in the repo:

- Event tracking and session management.
- Heatmap collection.
- Session replay capture with sampling.
- DOM snapshot capture when enabled.
- Performance capture hooks.
- Respect for `doNotTrack` and `globalPrivacyControl`.
- Replay masking and blocking attributes such as `data-replay-block`, `data-replay-ignore`, and `data-replay-unmask`.

Important privacy stance already present in code:

- AI insights exclude raw events, replay payloads, visitor identifiers, IPs, cookies, full DOM, form text, and free text content.
- Geo is coarse and privacy-threshold aware.
- Replay already supports selective masking and blocking.
- The current users page intentionally groups replay samples into privacy-safe pseudo-profiles because true user modeling is not finished.

### Product Reality Check (Backend)

The current repo already contains real backend work for:
- Alerts CRUD
- API keys CRUD
- Shared links CRUD
- Reports CRUD
- Goals CRUD
- Funnels CRUD
- Tracker script generation and persistence
- Site page discovery

### What This Revamp Must Do (Backend)
- Finish missing backend and control-plane logic where the current UI is only a front-end shell.
- Build true retention cohort computation.
- Build true segment/cohort engine.
- Build user aggregate modeling.
- Improve tracker accuracy for events, heatmaps, and replay.
- Build data import pipeline.
- Build multi-channel alert delivery.
- Build Neo tool registry with security model.
