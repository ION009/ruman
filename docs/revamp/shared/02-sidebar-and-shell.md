# Sidebar, Shell & Navigation

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### Sidebar Changes
- Realtime icon → earth or planet
- Remove Live Activity from sidebar (merge into Events)
- Neo should be integrated in all the pages — regardless of which page user is on

### Sidebar Utility Panel
- Create a small hoverable panel which shrinks
- Contains:
  - Logo on top
  - User profile at the bottom
  - Sign out button
  - Account/profile button

### Revamp Sidebar Structure

```
┌─────────────────────────────────────┐
│  AnlticsHeat Logo                   │
├─────────────────────────────────────┤
│  📊 Main              /dashboard    │
│  🌍 Realtime           /map         │  ← earth/planet icon
│  📌 Events            /events       │  ← includes merged live activity
│  🎯 Goals             /goals        │
│  🔥 Heatmaps          /heatmaps     │
│  🎬 Replay            /session-replay│
│  🔄 Funnels           /funnels      │
│  🗺️ Journeys          /journeys     │
│  📈 Retention         /retention    │
│  ✨ Insights          /ai-insight   │
│  👥 Users             /users        │
│  🧩 Segments          /cohorts      │
│  🔔 Alerts            /alerts       │
│  🔗 Integrations      /integrations │
│  ⚙️ Site Settings      /settings     │
├─────────────────────────────────────┤
│  ▸ Utility Panel (hoverable)       │
│    👤 Profile / Account             │
│    🚪 Sign Out                      │
└─────────────────────────────────────┘
```

### Items Removed From Sidebar
- Live Activity / Realtime (the live activity page, not the geo page) — merged into Events
- AI Analysis — merged into AI Insights or retired

### Items Hidden But Accessible
- `/sites` — portfolio management
- `/reports` — report scheduling
- `/errors` — issue triage
- `/performance` — beta performance board
- `/sessions` — legacy replay alias (redirect)

### Sidebar Visual Rules
- Logo at top, always visible
- Compact icon-plus-label design
- Active state should be clear and understated, not a loud highlight bar
- Group dividers should be subtle, not heavy horizontal lines
- The utility panel at the bottom should be a compact hoverable or collapsible area
- When collapsed, sidebar shows only icons with tooltips

### Neo Panel Integration
- Neo is accessed via a button in the top bar or a keyboard shortcut, not from the sidebar
- The Neo panel slides in from the right side
- It should feel integrated, not like a separate chat app bolted on
- Neo is available on every page and can answer questions about any page

### Top Bar Structure

```
┌─────────────────────────────────────────────────────┐
│  Page Title     │ Date Range Picker │ Site Selector │ Neo │
└─────────────────────────────────────────────────────┘
```

- Page title should match the page purpose, not generic "Dashboard"
- Date range picker stays compact with preset handling
- Site switcher available when user has multiple sites
- Neo button for opening the AI copilot panel
- Avoid stacking badges or alerts in the top bar

### Navigation State
- Active route highlighting in sidebar
- Breadcrumb or context path where useful
- Deep-link support for page-specific states (filters, selected items)
- Post-auth redirect preservation from sign-in

---

## Backend — Codex

> The sidebar and shell are primarily frontend concerns. Backend responsibility is limited to:

- Ensuring the site/project selector API returns the correct list of sites for the user
- Ensuring the Neo chat API route supports page-aware context from any page
- Ensuring post-auth redirect handling works correctly in the auth flow
- Ensuring route redirects (e.g., `/sessions` → `/session-replay`, `/ai-analysis` → `/ai-insight`) are configured
