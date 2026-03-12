# 13 — Segments & Cohorts

**Route**: `/cohorts`
**Component**: `apps/web/components/dashboard/cohorts-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- This page was **also not built at all** — requires proper build from **ground zero**
- First do a **research** what is segment and what it does and how it does
- Then build from **scratch completely** — with logic and UI
- **Include cohort feature inside this** page — build cohort feature also from ground zero
- No **horizontal lines**
- No **cheap looking bad cards**

### UI Direction
- Build this from scratch instead of keeping the current placeholder feel
- Keep rule creation inside modal flows
- Avoid cheap cards and horizontal divider layouts
- Include cohort feature within this page

### What NOT To Do
- No horizontal lines
- No cheap looking bad cards
- No placeholder layout

### Frontend Checklist
- [ ] Research segments and cohorts best practices
- [ ] Build segment creation UI in modal flow
- [ ] Build segment listing and management UI
- [ ] Build cohort feature within this page
- [ ] No horizontal lines or cheap cards

---

## Backend — Codex (FULL BUILD)

### Current State
- NO segment or cohort backend exists — true zero-to-one
- Currently relies on hard-coded replay-session filters

### Segment Definition Model
- Persist in control plane (Neon)
- Rule-based: behavior, property, geo, device, conversion conditions
- AND/OR logic between conditions
- Support condition types: visited page X, triggered event Y, from country Z, using browser B

### Segment Membership Queries
- Query against ClickHouse analytics data
- Compute segment audience size in real-time
- Segment summary metrics (avg page views, avg events, avg sessions)

### Cohort Computation
- Time-based cohorts (first-seen date groups)
- Cohort retention analysis
- Both time-based and behavioral groups

### Cross-Page Integration
- Segments as reusable filters across other dashboard APIs
- One-click jump context between segments and other pages

### API Endpoints
- Segment CRUD (create, read, update, delete)
- Segment preview (audience size before saving)
- Segment membership query
- Cohort analysis report

### Backend Checklist
- [ ] Build segment definition model in Neon
- [ ] Build segment membership queries against ClickHouse
- [ ] Build cohort computation — time-based and behavioral
- [ ] Build segment CRUD API
- [ ] Build segment preview API
- [ ] Build cohort analysis report API
- [ ] Enable segments as reusable filters across dashboard
