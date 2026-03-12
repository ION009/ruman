# AnlticsHeat Revamp Docs

> **Claude** is for **Frontend** work. **Codex** is for **Backend** work.

Single source of truth. Every page spec has clear **Frontend — Claude** and **Backend — Codex** sections.

---

## How To Use

1. Read `shared/00-revamp-principles.md` for global rules
2. Read the relevant `shared/` docs for cross-cutting concerns
3. Open the specific page in `pages/` — it has **Frontend — Claude** and **Backend — Codex** sections with separate checklists
4. **Claude** implements the Frontend section. **Codex** implements the Backend section.

---

## Folder Structure

```
docs/revamp/
├── README.md                              ← You are here
├── context/                               ← Project context (what exists, tech stack, routes)
│   ├── platform-context.md                ← Product summary, frontend/backend shape
│   ├── tech-stack-and-dependencies.md     ← Monorepo, frameworks, DB, key paths
│   ├── current-route-inventory.md         ← Every route, component, status
│   └── deep-sweep-audit.md               ← Corrections from deep documentation sweep
│
├── shared/                                ← Cross-page rules (design, privacy, tracker, LLM)
│   ├── 00-revamp-principles.md            ← Global rules (Frontend — Claude + Backend — Codex)
│   ├── 01-design-system.md                ← Cards, charts, modals, reusable components
│   ├── 02-sidebar-and-shell.md            ← Sidebar, top bar, navigation, Neo placement
│   ├── 03-dark-theme-and-calendar.md      ← Calendar restyling (dark mode deferred)
│   ├── 04-anti-patterns.md                ← What to NEVER do
│   ├── 05-tracker-and-accuracy.md         ← Tracker improvements, precision, masking
│   ├── 06-privacy-and-data-rules.md       ← Privacy rules, AI exclusions, data trust
│   └── 07-llm-integration.md             ← LongCat/Groq rules, data packaging for AI
│
└── pages/                                 ← End-to-end page specs
    ├── 01-dashboard-main.md
    ├── 02-realtime-geo.md
    ├── 03-events-and-live-activity.md
    ├── 04-goals.md
    ├── 05-heatmaps.md
    ├── 06-session-replay.md
    ├── 07-funnels.md
    ├── 08-journeys.md
    ├── 09-retention.md
    ├── 10-ai-insights.md
    ├── 11-neo-ai-panel.md
    ├── 12-users.md
    ├── 13-segments-and-cohorts.md
    ├── 14-alerts.md
    ├── 15-integrations.md
    ├── 16-site-settings.md
    ├── 17-sites-and-portfolio.md
    ├── 18-reports.md
    ├── 19-errors.md
    ├── 20-performance.md
    ├── 21-shared-dashboard.md
    ├── 22-auth-sign-in.md
    ├── 23-marketing-home.md
    ├── 24-ai-analysis-legacy.md
    └── 25-sessions-legacy.md
```

---

## Shared Docs Summary

| Doc | What It Covers | Primary Owner |
|---|---|---|
| `00-revamp-principles.md` | Product personality, visual rules, IA rules, data trust, engineering rules | Claude + Codex |
| `01-design-system.md` | Card types, chart language, modal patterns, notice patterns | Claude (Frontend) |
| `02-sidebar-and-shell.md` | Sidebar structure, utility panel, top bar, Neo placement, navigation | Claude (Frontend) |
| `03-dark-theme-and-calendar.md` | Calendar restyling, date range presets (dark mode deferred) | Claude (Frontend) |
| `04-anti-patterns.md` | Banned patterns: horizontal lines, oversized cards, badge spam, etc. | Claude + Codex |
| `05-tracker-and-accuracy.md` | Event dedup, pointer precision, replay masking, heatmap precision | Codex (Backend) |
| `06-privacy-and-data-rules.md` | Privacy rules, AI data exclusions, data trust rules | Codex (Backend) |
| `07-llm-integration.md` | LongCat vs Groq, AI Insights pipeline, Neo data formatting | Codex (Backend) |

---

## Page Index

| # | Page | Route | Frontend — Claude | Backend — Codex |
|---|---|---|---|---|
| 01 | Main Dashboard | `/dashboard` | UI redesign | Server-side derived metrics |
| 02 | Realtime Geo | `/map` | UI redesign (don't touch globe) | Realtime signals |
| 03 | Events + Live Activity | `/events` | Full UI rebuild, merge live activity | Event accuracy, live aggregation |
| 04 | Goals | `/goals` | UI rebuild, modal flows | Goal states, sparkline data |
| 05 | Heatmaps | `/heatmaps` | UI redesign, precision rendering | Tracker precision improvements |
| 06 | Session Replay | `/session-replay` | UI redesign, layout fixes | Masking policy, chunk reliability |
| 07 | Funnels | `/funnels` | UI rebuild, real visualization | Step suggestions, timing analytics |
| 08 | Journeys | `/journeys` | Full UI rebuild, flow diagram | Path aggregation from session data |
| 09 | Retention | `/retention` | UI build, hero graph | Full backend build (zero to one) |
| 10 | AI Insights | `/ai-insight` | UI redesign, narrative display | LLM pipeline (LongCat only) |
| 11 | Neo AI Panel | (global panel) | Premium panel redesign | Full tool registry + security model |
| 12 | Users | `/users` | Premium table UI | Full backend build (zero to one) |
| 13 | Segments & Cohorts | `/cohorts` | Full UI build | Full backend build (zero to one) |
| 14 | Alerts | `/alerts` | Full UI build | Multi-channel delivery |
| 15 | Integrations | `/integrations` | UI rebuild, connection status | Provider connection model |
| 16 | Site Settings | `/settings` | UI redesign, import modal | Import pipeline, settings wiring |
| 17 | Sites & Portfolio | `/sites` | UI polish | Extend existing APIs |
| 18 | Reports | `/reports` | UI redesign | Delivery execution |
| 19 | Errors | `/errors` | UI redesign if retained | Error grouping, replay linkage |
| 20 | Performance | `/performance` | UI honesty improvements | Signal clarity |
| 21 | Shared Dashboard | `/share/[slug]` | UI polish, privacy display | Privacy-safe read-only data |
| 22 | Auth / Sign-In | `/auth/sign-in` | Premium UI polish | Auth flow preservation |
| 23 | Marketing Home | `/` | Visual alignment | No changes needed |
| 24 | AI Analysis Legacy | `/ai-analysis` | Merge into AI Insights | Redirect route |
| 25 | Sessions Legacy | `/sessions` | Remove from navigation | Redirect to `/session-replay` |

---

## Key Product Constraints

- Privacy-first analytics platform
- LongCat only for AI Insights; both LongCat and Groq for Neo
- Pricing and plan restrictions intentionally deferred
- No destructive Neo powers (delete account/site/profile)
- 99.99% accuracy target for events, heatmaps, replay
