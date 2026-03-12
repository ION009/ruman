# Tech Stack And Dependencies

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Monorepo Structure

The project is a pnpm workspace monorepo rooted at the project directory.

Workspace packages:

- `apps/web` — Next.js dashboard application (app router)
- `apps/api` — Go analytics and ingestion API
- `packages/tracker` — Browser tracking script (vanilla JS)

---

## Frontend — Claude

### Frontend Stack

- **Framework**: Next.js with app router
- **Language**: TypeScript
- **Styling**: Vanilla CSS and CSS modules where needed
- **State**: React hooks, context, and SWR or fetch-based data fetching
- **Charts**: Recharts and custom canvas rendering for heatmaps
- **Maps**: Three.js or Globe.gl for the 3D globe
- **Replay**: rrweb-based session recording and playback
- **Package manager**: pnpm

### Key File Paths (Frontend)

| Purpose | Path |
|---|---|
| Protected layout shell | `apps/web/app/(protected)/layout.tsx` |
| Dashboard chrome (sidebar, topbar, Neo) | `apps/web/components/dashboard/dashboard-chrome.tsx` |
| Dashboard types | `apps/web/lib/dashboard/types.ts` |
| Dashboard client fetchers | `apps/web/lib/dashboard/client.ts` |
| Dashboard API routes | `apps/web/app/api/dashboard/` |
| Control-plane helpers | `apps/web/lib/control-plane/` |
| Neo tools registry | `apps/web/lib/dashboard/neo-tools.ts` |
| Neo chat API route | `apps/web/app/api/dashboard/neo-chat/route.ts` |

### Important Dependencies (Frontend)
- The dashboard makes server-side API calls to the Go backend through Next.js API routes in `apps/web/app/api/dashboard/`
- Neo runs through the Next.js API route which orchestrates tool calls and LLM interactions

---

## Backend — Codex

### Backend Stack

- **API**: Go (Golang) server in `apps/api`
- **Analytics store**: ClickHouse
- **Control plane store**: Neon (PostgreSQL)
- **AI providers**:
  - LongCat — used for AI Insights page (exclusive)
  - Groq — used for Neo and other AI features
- **Object storage**: Cloudflare R2 for replay chunks and heatmap screenshots

### Database Context

- `db/clickhouse/` — ClickHouse migrations and schema for analytics events, sessions, pageviews, heatmap data, and replay metadata
- `db/neon/` — Neon (Postgres) migrations for control-plane entities: sites, users, goals, funnels, alerts, reports, API keys, shared links

### Tracker Package

Located in `packages/tracker`:

- Vanilla JavaScript, no framework dependency
- Captures: pageviews, sessions, events, heatmap interactions, replay (rrweb), scroll depth, performance metrics
- Privacy controls: respects `doNotTrack`, `globalPrivacyControl`, selective replay masking via `data-replay-block`, `data-replay-ignore`, `data-replay-unmask`
- Deployed as a single script tag for end-user websites

### Key File Paths (Backend)

| Purpose | Path |
|---|---|
| Go storage and aggregation | `apps/api/internal/storage/` |
| Tracker source | `packages/tracker/src/` |
| ClickHouse migrations | `db/clickhouse/` |
| Neon migrations | `db/neon/` |

### Important Dependencies (Backend)
- The tracker talks directly to the Go API for event ingestion
- AI Insights runs server-side in the Go backend, not in the Next.js app

### Environment And Config

- `.env.example` documents all required environment variables
- `docker-compose.yml` for local ClickHouse
- `opencode.json` for AI tool configuration
- `.codex/config.toml` for Codex configuration
