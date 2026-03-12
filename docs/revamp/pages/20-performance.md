# 20 — Performance

**Route**: `/performance`
**Component**: `apps/web/components/dashboard/performance-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- Keep the UI honest about beta or proxy-based performance signals
- Do not present derived risk scores like full web vitals telemetry
- Use compact notices for beta, proxy, or low-confidence states
- Avoid generic placeholder cards and fake precision

### What NOT To Do
- No fake precision
- No generic placeholder cards

### Frontend Checklist
- [ ] UI clearly distinguishes proxy risk signals from real vitals telemetry
- [ ] Beta or limited-scope states are explicit but compact
- [ ] Page feels intentional if retained

---

## Backend — Codex

- Be explicit when signals are proxy-derived and not full web vitals
- Performance tracking toggle in site settings should control what is captured

### Backend Checklist
- [ ] Ensure performance signals are clearly marked as proxy or real
- [ ] Performance tracking toggle controls capture scope
