# 07 — Funnels

**Route**: `/funnels`
**Component**: `apps/web/components/dashboard/funnels-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Built like another **sloppy and generic page**
- Need to do a **proper research** what funnel is, how it is used, and how to build this according to our platform
- Then build it properly — **do not build a generic one**
- Avoid **generic horizontal lines cards**
- Avoid **long forms**
- When taking input from user → use **pop cards**

### UI Direction
- Do not ship a generic funnel page
- Use a real funnel visualization, not weak stacked cards
- Keep funnel creation and editing inside modal flows
- Research what a funnel is and build it properly for this platform

### What NOT To Do
- No generic horizontal line cards
- No long inline forms
- No sloppy/generic layout

### Frontend Checklist
- [ ] Research funnel best practices for analytics platforms
- [ ] Build real funnel visualization (not stacked cards)
- [ ] Build funnel creation in modal flow
- [ ] Build funnel editing in modal flow
- [ ] No horizontal line patterns

---

## Backend — Codex

### Existing Foundation
Funnel CRUD and report logic already exist. Current model supports:
- `page` and `event` steps
- `exact` and `prefix` matching
- `sessions` and `visitors` count modes
- 2 to 8 steps
- 1 to 1440 minute time windows

### New Logic to Add
- Improve suggested step discovery from site pages and event catalog
- Consider funnel templates derived from site structure
- Add step-level entrant/drop-off inspection queries
- Add step timing analytics (how long between steps)

### Backend Checklist
- [ ] Add step suggestions from site pages and events
- [ ] Add step-level entrant/drop-off inspection
- [ ] Add step timing analytics
- [ ] Consider funnel templates derived from site structure
