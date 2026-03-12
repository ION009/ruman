# 24 — AI Analysis Legacy

**Route**: `/ai-analysis`
**Component**: `apps/web/components/dashboard/ai-analysis-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Decision

- Do not keep a second competing AI findings page alive by accident
- Merge any useful ideas into AI Insights (page 10)
- If the route remains temporarily, make it visually obvious that it is transitional

---

## Frontend — Claude

- Navigation and labeling must not create AI page confusion
- The product exposes one clear AI findings page (AI Insights)
- Redirect `/ai-analysis` to `/ai-insight` or retire the route

### Frontend Checklist
- [ ] Merge useful ideas into AI Insights
- [ ] No duplicate AI surfaces in navigation

---

## Backend — Codex

- Redirect `/ai-analysis` to `/ai-insight` at the routing level or retire the route entirely

### Backend Checklist
- [ ] Redirect or retire `/ai-analysis` route
