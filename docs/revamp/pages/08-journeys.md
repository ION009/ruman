# 08 — Journeys

**Route**: `/journeys`
**Component**: `apps/web/components/dashboard/journeys-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Just added like a **placeholder** or built generic one — doesn't have anything much
- Build from **scratch**
- The flow currently looks **absolutely trash, really bad**
- Should have a **proper funnel diagram** according to the pages of user website
- **Diagram on top** — not in a long card or box or container
- Not some **generic cards wired together** and calling it a diagram
- **Proper funnel diagram**, labeled according to the user's website pages

### UI Direction
- Replace placeholder UI with a real top-level flow diagram
- Use actual site-page labels where possible
- Do not fake a diagram with loose cards and lines
- Diagram should be the hero surface at the top

### What NOT To Do
- No placeholder or generic layout
- No fake diagrams with loose cards and lines
- No long card containers

### Frontend Checklist
- [ ] Replace placeholder UI with real flow diagram
- [ ] Use actual site-page labels in diagram
- [ ] Diagram as hero surface at top of page

---

## Backend — Codex

### Current State
- Current page derives routes from replay or top pages — starting point only

### Required Backend Build
- Improve path modeling and route clustering
- Add page-group naming, branch strength, intent-stage labeling
- Distinguish modeled routes from replay-backed routes (data provenance)
- Build real path aggregation from session data, not just replay approximations
- Compute: common paths, entry/exit distributions, path length distributions
- Support filtering by device, country, time period

### Backend Checklist
- [ ] Build real path aggregation from session data
- [ ] Add page-group naming and branch strength
- [ ] Distinguish modeled vs replay-backed routes
- [ ] Compute common paths, entry/exit distributions
- [ ] Support filtering by device, country, time period
