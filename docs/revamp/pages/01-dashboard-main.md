# 01 — Main Dashboard

**Route**: `/dashboard`
**Component**: `apps/web/components/dashboard/dashboard-main-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Has too many badges which look bad → **remove excessive badges**
- Graph should be a little bigger, only a little, and better
- Graph should mention which things are represented — which colour represents which things (add a **legend**)
- People active card is too big → **remove the live realtime people card entirely** — no live counter, no active people widget
- Cards showing different numbers are also too big → **card should be sized according to content**
- All 4 cards below are very ugly and badly built — information is badly presented, no chart or creative graphs used → **use charts/graphs**
- Fix that git-like card properly, build it how it should suit
- Give more metrics and analytics for this page

### UI Direction
- Remove the excessive badges
- Make the main chart slightly larger and clearly decoded with a legend
- **Remove** the live realtime active people surface entirely — no live people card or widget on the main dashboard
- Resize number cards below the graph so they fit the content
- Replace the weak lower cards with better visual storytelling:
  - Traffic quality module
  - Referrer mix module
  - Device and browser spread module
  - Attention and friction hotspots module
- Redesign the git-like contribution card so it feels native to analytics
- One strong hero surface (main chart), then compact support modules

### What NOT To Do
- No oversized cards with tiny content inside
- No cards inside cards (nesting)
- No excessive badges/tags
- **No live realtime people cards** — live people counter belongs only on the Realtime Geo page (`/map`), not on the main dashboard

### Frontend Checklist
- [ ] Enlarge and redesign the main hero graph
- [ ] Add clear legend for hero graph colors
- [ ] Reduce badge noise on the page
- [ ] **Remove** live realtime active people card entirely from main dashboard
- [ ] Resize support cards to fit content (no oversized empty cards)
- [ ] Replace weak lower four cards with rich visual modules
- [ ] Redesign contribution-grid/git-like card
- [ ] Verify loading, empty, and error states
- [ ] Responsive layout verification

---

## Backend — Codex

### New Server-Side Computed Metrics

These should be computed server-side, not client-side:

| Metric | Computation |
|---|---|
| Engaged sessions | Sessions with >1 pageview or an event |
| Returning visitor ratio | Returning vs new visitors this period |
| Friction score | Derived from rage clicks, dead clicks, short sessions |
| Top path momentum | Most-growing page paths vs prior period |
| Referrer quality score | Referrers driving engaged sessions vs bounces |
| Page focus score | Average time on page vs scroll depth |
| Conversion assist score | Pages contributing most to goal conversions |
| Session duration | Derive from pageDensity * avg page time |

### Existing API Foundation
- Dashboard summary API already provides overview data
- Reuse and extend existing payloads
- Standardize comparison windows across all metrics
- Add sparkline data (daily/hourly arrays) to support mini trend charts

### Required API Changes
- Add derived metrics to summary response
- Add trend arrays (last 7/30 data points) for sparklines
- Add comparison period deltas

### Backend Checklist
- [ ] Add server-side derived metric computation (engaged sessions, friction score, etc.)
- [ ] Add trend arrays and sparkline data to API
- [ ] Add comparison period deltas to API
- [ ] Verify comparison ranges and trend logic
