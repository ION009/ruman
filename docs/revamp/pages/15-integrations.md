# 15 — Integrations

**Route**: `/integrations`
**Component**: `apps/web/components/dashboard/integrations-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Should have **all the integrations**
- User can bring their data from other analytics tools — any one of the famous ones like **Google and bunch of others**
- Keep this page as **integration only** — build it completely
- For **other integration data import** → that will be in **Site Settings**, not here

### UI Direction
- Keep this page focused on integrations and connection status
- Do not let historical data import drift back onto this route
- Use modal-friendly connect, reconnect, and disconnect flows

### What NOT To Do
- No data import on this page (that's in Site Settings)

### Frontend Checklist
- [ ] Build integrations page focused on connection status
- [ ] Modal-friendly connect/disconnect flows
- [ ] No data import on this page

---

## Backend — Codex

### Provider Connection Model
- Persist provider connection status, health, and last sync state
- Store secrets or tokens safely
- Support disconnected, connected, degraded, and coming-soon states

### Provider Families
- Analytics providers (Google Analytics, etc.)
- Collaboration destinations (Slack, etc.)
- Developer surfaces (API keys, webhooks, export endpoints)

### Connection Health
- Expose compact health summaries the UI can render
- Include last successful sync or verification time
- Separate `configured` from `actively healthy`

### Configuration Flows
- Support modal-friendly create, connect, reconnect, rotate, and disconnect actions
- Return structured validation errors for missing scopes, invalid tokens, expired credentials

### Reuse From Existing Product
- API keys already exist
- Shared links already exist
- Alerts already have partial webhook delivery support
- Build on those foundations

### Backend Checklist
- [ ] Build provider connection model
- [ ] Build connection health monitoring
- [ ] Support analytics providers, collaboration tools, developer APIs
- [ ] Structured validation errors for connection issues
