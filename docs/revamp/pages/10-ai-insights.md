# 10 — AI Insights

**Route**: `/ai-insight`
**Component**: `apps/web/components/dashboard/insights-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- This section is **different** from Neo — do NOT ask Neo
- Automatically give a button of **"Generate Insights"**
- When user clicks, should get **genuine insights** of overall their website
- **Actionable insights**, not **generic gimmicky insights**
- For this specific section use **LongCat only** — **don't integrate Groq** here
- Build an **agent or pipeline** which gives all relevant data, convert to LLM-friendly format, pass to LLM
- When analysis comes, first show **analysis on top**
- Then populate **cards and graphs below** it accordingly
- Display information in **cards and graphs**, graphical way
- This page has a **lot of bunch of tags** → **remove them**
- No **long horizontal lines** and **long horizontal cards**

### UI Direction
- Add a "Generate Insights" action as the primary entry point
- Show the narrative analysis first
- Render supporting insight cards and charts below the narrative
- Remove tag clutter and long horizontal card patterns

### What NOT To Do
- No tag clutter
- No long horizontal lines and cards
- No generic gimmicky insights

### Frontend Checklist
- [ ] Add "Generate Insights" button as primary entry point
- [ ] Show narrative analysis at top of page
- [ ] Render insight cards and charts below narrative
- [ ] Remove tag clutter
- [ ] Remove long horizontal card patterns

---

## Backend — Codex

### LLM: LongCat ONLY (No Groq)

### Pipeline Steps

#### Step 1: Data Gathering
Collect from existing APIs:
- Overview: pageviews, sessions, visitors, bounce rate, duration, trends
- Top pages with performance metrics
- Referrer sources and quality
- Device/browser distribution
- Scroll patterns and engagement
- Heatmap interaction summaries
- Event patterns and anomalies
- Goal conversion rates
- Rule flags and alerts
- Confidence and data freshness

#### Step 2: Convert to LLM-Friendly Format
- Structure as clean organized context — NOT raw JSON dumps
- Include comparisons and trends
- Include confidence and freshness notes

#### Step 3: Prompt Engineering
- Craft prompt asking for genuine analysis specific to this site — NOT generic tips
- Request: narrative, actions, evidence
- Every insight must reference specific data

#### Step 4: Return Structured Analysis
- Narrative text
- Prioritized actions with expected impact
- Page-specific opportunities
- Evidence data for supporting charts

### Privacy Exclusions (ENFORCED)
- No raw events / replay payloads
- No visitor identifiers / IPs
- No cookies / session tokens
- No full DOM content
- No form text / free text
- No personal user information

### Existing Foundation
- AI Insights engine already runs in Go backend
- Already excludes sensitive data
- Already has LongCat config
- Improve packaging quality, not discard

### Backend Checklist
- [ ] Build/improve data gathering pipeline
- [ ] Build LLM-friendly data conversion
- [ ] Build proper prompt engineering for genuine analysis
- [ ] Return structured analysis with narrative + evidence
- [ ] Enforce privacy exclusions in data pipeline
- [ ] LongCat only — no Groq
