# 18 — Reports

**Route**: `/reports`
**Component**: `apps/web/components/dashboard/reports-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- Rebuild this as a scheduling and delivery workspace, not a leftover form page
- Present each report as a clear status card showing schedule, recipients, included sections, and delivery state
- Keep create and edit flows inside modal surfaces
- Reserve space for delivery health and history

### What NOT To Do
- No leftover form page feel

### Frontend Checklist
- [ ] Saved report cards are easy to scan
- [ ] Scheduled, paused, failed, and delivered states are visually distinct
- [ ] Create and edit flows are modal-based

---

## Backend — Codex

- Report persistence exists, but delivery execution and delivery health need backend follow-through
- Build delivery outcome tracking
- Build delivery health monitoring

### Backend Checklist
- [ ] Build delivery execution
- [ ] Build delivery outcome tracking
- [ ] Build delivery health monitoring
