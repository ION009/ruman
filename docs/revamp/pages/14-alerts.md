# 14 — Alerts

**Route**: `/alerts`
**Component**: `apps/web/components/dashboard/alerts-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- This page was **also not built at all** — needs to build from **ground zero**
- Give **multiple integrations** of getting alerts: **Email**, **Slack**, and **bunch of others**
- User can **configure** to get alerts through these channels

### UI Direction
- Build alert management from the ground up visually
- Support channel setup through compact modals and clear status cards

### What NOT To Do
- No placeholder or generic layout

### Frontend Checklist
- [ ] Build alert management UI from ground up
- [ ] Build alert creation in modal flow
- [ ] Build channel configuration UI (email, Slack, webhook)
- [ ] Build clear status cards for alert state

---

## Backend — Codex

### Existing Foundation
- Alert CRUD exists
- Threshold evaluation exists
- Webhook delivery exists
- Current model: only ONE webhookUrl per alert → need multiple channels

### Channel Model
- Expand from single webhookUrl to multi-channel support
- Each alert can have multiple delivery channels

### Delivery Channels

| Channel | Config |
|---|---|
| Email | Recipient addresses |
| Slack | Workspace connection, channel selection |
| Webhook | URL, optional headers, payload format (multiple URLs) |

### Alert History
- Store alert firing history
- Per-firing delivery status: sent, failed, pending
- Timestamps for each firing

### Backend Path
- Alert evaluation → dispatch per channel
- Delivery outcome tracking
- Health monitoring per channel

### Backend Checklist
- [ ] Expand backend from single webhook to multi-channel
- [ ] Build alert history storage
- [ ] Build per-firing delivery status tracking
- [ ] Build health monitoring per channel
