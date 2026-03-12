# 22 — Auth / Sign-In

**Route**: `/auth/sign-in`
**Component**: `apps/web/components/auth/sign-in-form.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### UI Direction
- Make auth feel premium and trustworthy instead of utilitarian
- Preserve account auth, token auth, and create-account flows
- Preserve create-account onboarding inputs for full name, site name, and domain
- Keep the page lightweight, clear, and visually aligned with the revamped shell

### What NOT To Do
- No utilitarian feel

### Frontend Checklist
- [ ] Token mode and account mode both supported cleanly
- [ ] Create-account onboarding fits naturally
- [ ] Page feels like the same product as main dashboard

---

## Backend — Codex

- Preserve token auth, account auth, create-account mode, onboarding capture, and `next` redirect handling
- All existing auth flows remain intact

### Backend Checklist
- [ ] Post-auth redirect handling preserved
- [ ] All auth modes (token, account, create-account) continue working
