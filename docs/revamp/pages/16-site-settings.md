# 16 — Site Settings

**Route**: `/settings`
**Component**: `apps/web/components/dashboard/project-settings-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- **Remove first big card** — it looks ugly
- Show **tracking script**
- Below script, show all the **website installation guides** — build for: **Shopify, WordPress, React, Next.js** and all bunch of things
- Give a **Cursor, Claude Code, Codex** option as well in the installation
- Give a **prompt and script** in it for AI agents — write **proper instructions for these agents**
- Below, **remove deployment checklist** and all bunch of other cards
- Give **option and switches to toggle** and build complete logic for all of them (e.g. **block bot traffic**)
- Give an **option of Import** — when clicked, **open a pop card**
- User can select which platform — **list bunch of popular platforms**
- **Choose file** option — like import file option
- **Drag and drop file** option as well
- Once user imports data, our system **automatically populates all the sections**

### UI Direction
- Remove the ugly first big card
- Make tracking script setup the hero
- Add installation guides for major frameworks and CMSs
- Add AI agent install helpers for Cursor, Claude Code, and Codex
- Replace deployment-checklist style blocks with real settings switches
- Open import in a modal with platform selection and drag-drop upload

### What NOT To Do
- No ugly big cards
- No deployment checklist blocks

### Frontend Checklist
- [ ] Remove ugly first big card
- [ ] Make tracking script setup the hero section
- [ ] Build installation guides for Shopify, WordPress, React, Next.js, etc.
- [ ] Build AI agent install helpers (Cursor, Claude Code, Codex)
- [ ] Replace deployment checklist with real settings switches
- [ ] Build import modal with platform selection
- [ ] Build drag-and-drop file upload
- [ ] Retire old settings-view.tsx

---

## Backend — Codex

### Settings Switches (All Need Backend Wiring)

| Switch | Backend Action |
|---|---|
| Block bot traffic | Update tracker config, filter at ingestion |
| DOM snapshots | Toggle in site config |
| Visitor cookies | Toggle cookie policy |
| Replay privacy defaults | Update masking defaults |
| Data retention controls | Set retention periods, schedule cleanup |
| Import behavior defaults | Set default import mapping |
| SPA tracking | Toggle SPA mode in tracker |
| Error tracking | Toggle error capture |
| Performance tracking | Toggle web vitals capture |

### Data Import Pipeline (FULL BUILD)

#### Import Flow
1. User selects platform or uploads file
2. System parses file (CSV, JSON)
3. Field mapping (auto-detect + manual override)
4. Data validation
5. ClickHouse data insertion
6. Progress tracking
7. Auto-population of all dashboard sections

#### Supported Platforms
- Google Analytics
- Plausible
- Umami
- Simple Analytics
- Matomo
- Fathom
- Other (custom CSV/JSON)

#### File Handling
- CSV parsing with header detection
- JSON parsing with schema inference
- Drag-and-drop file upload endpoint
- File size limits and validation

#### Data Insertion
- Map imported data to AnlticsHeat ClickHouse schema
- Insert historical pageviews, sessions, events
- Populate derived metrics
- Update page lists and site discovery

#### Error Handling
- Validation errors per row
- Partial import support
- Progress reporting to UI
- Rollback on critical errors

### Existing Foundation
- Tracker snippet and script generation already exist
- Control-plane privacy toggles exist
- Site origin management exists
- Site page discovery exists
- Heatmap and onboarding screenshot capture exist

### Legacy Cleanup
- `settings-view.tsx` (24KB) has overlapping responsibilities
- Explicitly retire and migrate to new `project-settings-view.tsx`

### Backend Checklist
- [ ] Wire all settings switches to backend
- [ ] Build import pipeline: parsing, field mapping, validation
- [ ] Build ClickHouse data insertion for imports
- [ ] Build progress tracking for imports
- [ ] Build error handling and rollback for imports
