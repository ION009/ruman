# 12 — Users

**Route**: `/users`
**Component**: `apps/web/components/dashboard/users-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- This page was **never built properly** — it is **not even built**
- Has **no logic** right now — needs to be wired with backend, tracking script, and everything
- As we are privacy focused, give users **random funny names** like Xyy, Zon, Leein or something **fictional names**
- Show: User name (fictional), country, state, browser, OS, page views and which page views, events, last on platform, first time they came
- Whole **columns** of these like a proper spreadsheet but better one
- Below it show **privacy notes** — how we anonymize users and track, we never track personal users

### UI Direction
- Build a premium spreadsheet-like table
- Use privacy-safe fictional names
- Show the required columns and a privacy explanation below the table

### What NOT To Do
- No placeholder or generic layout
- No real personal user data

### Frontend Checklist
- [ ] Build premium spreadsheet-like table UI
- [ ] Implement fictional name display
- [ ] Show all required columns (name, country, state, browser, OS, pageviews, events, first/last seen)
- [ ] Add privacy notes section below table

---

## Backend — Codex (FULL BUILD)

### Current State
- Page was never built
- Current replay-based sampled profile grouping is NOT enough
- No proper user aggregate backend exists

### ClickHouse Schema
- Build dedicated user aggregate table(s)
- Privacy-safe: pseudonymous identifiers only
- Columns: user hash, country, state, browser, OS, page views, events, first seen, last seen

### Tracking Script Wiring
- Wire tracker to populate user-level aggregates
- Identity stitching rules (session → user mapping)
- Privacy-safe: no personal identifiers stored

### API
- User list API: paginated, sortable, filterable
- User detail API: pages viewed, events triggered, session history
- Fictional name generation: deterministic from user hash (funny names like Xyy, Zon, Leein)

### Privacy
- Never store real names or personal identifiers
- First-seen / last-seen computed without violating privacy posture
- Anonymization documented and verifiable

### Backend Checklist
- [ ] Build ClickHouse user aggregate schema
- [ ] Wire tracker to populate user aggregates (tracker)
- [ ] Build user list API — paginated, sortable, filterable
- [ ] Build user detail API
- [ ] Build deterministic fictional name generation
- [ ] Ensure privacy compliance — no personal identifiers
