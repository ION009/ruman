# 04 — Goals

**Route**: `/goals`
**Component**: `apps/web/components/dashboard/goals-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Goal feature was **never built properly** and never integrated properly → **build this feature completely like a new**
- Big card looks **ugly** — buttons look **ugly**
- When click on "New Goal" → a **pop card should open** to fill details (goal details, name, and other things)
- When user creates a goal, it should **appear in cards** in the goals section
- Each card should have **all functionality**: edit and delete

### UI Direction
- Rebuild the page so it does not feel like one oversized card
- New goal flow should open in a modal or pop card
- Render goals as cards with edit and delete actions
- Display conversion rate and counts clearly
- Add empty state for zero goals

### What NOT To Do
- No oversized cards with tiny content
- No ugly big cards and buttons

### Frontend Checklist
- [ ] Redesign page hero and conversion summary
- [ ] Replace inline creation with modal pop-card flow
- [ ] Build premium goal cards with all required fields
- [ ] Support create, edit, and delete cleanly
- [ ] Display conversion rate and counts clearly
- [ ] Add empty state for zero goals

---

## Backend — Codex

### Existing Foundation
Goal CRUD and report APIs already exist. Current model supports:
- `pageview` and `event` goal types
- `exact`, `prefix`, `contains` matching
- Optional `currency`

### New Logic to Add

| Feature | Detail |
|---|---|
| Goal states | Active (receiving), low volume (few), stale (none in window) |
| Conversion rate computation | Per goal per time range |
| Sparkline data | Daily conversion counts for trend card |
| Goal grouping | Category support (future) |

### Backend Checklist
- [ ] Add goal states (active, low volume, stale)
- [ ] Add conversion rate computation per goal per time range
- [ ] Add sparkline trends on goal cards
- [ ] Verify goal reporting refresh and persistence
