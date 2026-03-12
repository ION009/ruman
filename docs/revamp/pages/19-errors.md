# 19 — Errors

**Route**: `/errors`
**Component**: `apps/web/components/dashboard/errors-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- If retained, this must be a real issue triage surface, not a leftover beta page
- Group the page around severity, frequency, and replay linkage
- Use compact boards, charts, or ranked clusters instead of weak horizontal lists
- Keep the page visually distinct from Events while still feeling part of the same product system
- Use severity, trend, and replay linkage instead of a leftover list view

### What NOT To Do
- No leftover beta feel
- No weak horizontal lists

### Frontend Checklist
- [ ] Clear product purpose for this page
- [ ] Error groups, trend context, and replay linkage visually obvious
- [ ] Compact boards/charts instead of horizontal lists
- [ ] UI no longer feels like a derived leftover view

---

## Backend — Codex

- Only retain if a real error and issue triage pipeline remains distinct from Events, Replay, and AI surfaces
- Build error grouping, trend context, and replay linkage if retained

### Backend Checklist
- [ ] Build error grouping logic
- [ ] Build trend context for errors
- [ ] Build replay linkage for errors
