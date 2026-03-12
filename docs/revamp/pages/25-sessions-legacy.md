# 25 — Sessions Legacy

**Route**: `/sessions`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Decision

- Do not present `/sessions` as a separate replay page
- Keep one canonical replay route (`/session-replay`) and handle this alias quietly
- If it remains, titles and breadcrumbs should still point users toward the canonical replay experience

---

## Frontend — Claude

- One clear replay product surface
- Any legacy alias is low-noise and low-confusion

### Frontend Checklist
- [ ] No duplicate replay surfaces in navigation

---

## Backend — Codex

- Redirect `/sessions` to `/session-replay`

### Backend Checklist
- [ ] Redirect `/sessions` to `/session-replay`
