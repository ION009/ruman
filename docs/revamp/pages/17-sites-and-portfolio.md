# 17 — Sites & Portfolio

**Route**: `/sites`
**Component**: `apps/web/components/dashboard/sites-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- Treat this as a clean multi-site workspace, not a mixed utility page
- Keep portfolio actions grouped by intent: create site, switch site, origins and domains, shared links, and API keys
- Use modal or pop-card flows for create and edit actions
- Split shared links and API keys into clean sub-sections instead of one mixed surface
- Match the main revamp rules: compact cards, no divider-heavy rows, no oversized empty panels

### What NOT To Do
- No mixed utility dump
- No divider-heavy rows

### Frontend Checklist
- [ ] Clear page purpose separate from Site Settings
- [ ] Modal-based create and edit flows
- [ ] Multi-site management visually clearer than current
- [ ] Compact cards, no divider-heavy rows

---

## Backend — Codex

- Keep multi-site management, origins, shared links, and API keys deliberate
- Existing foundations are in place — extend, don't rebuild

### Backend Checklist
- [ ] Maintain and extend multi-site management APIs
- [ ] Ensure origins, shared links, and API keys are functional
