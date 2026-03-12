# 21 — Shared Dashboard

**Route**: `/share/[slug]`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- Shared dashboards should look product-grade, not like a downgraded export
- Preserve the password wall, unavailable state, and read-only posture
- Make freshness, privacy scope, and limited shared data obvious without clutter
- Keep the layout light, trustworthy, and visually aligned with the main dashboard

### What NOT To Do
- No downgraded export feel

### Frontend Checklist
- [ ] Protected links feel deliberate and trustworthy
- [ ] Read-only states are clear
- [ ] Public share flow visually matches the revamp system

---

## Backend — Codex

- Keep payload scope intentional, privacy-safe, and read-only
- Ensure shared dashboard data respects all privacy rules

### Backend Checklist
- [ ] Privacy-safe shared data
- [ ] Read-only payload enforcement
