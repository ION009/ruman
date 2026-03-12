# 09 — Retention

**Route**: `/retention`
**Component**: `apps/web/components/dashboard/retention-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Not built — just **placeholder with generic UI**
- Lacks proper **logic and backend functionality**
- Show first a **big graph**
- Below it: **all the numbers**
- Then: **2-4 cards** with all the metrics and other information
- Nearly **99.99 percent accuracy** should be there
- **Privacy focused**

### UI Direction
- Lead with one big retention graph
- Put the key numbers below it
- Follow with a few compact support cards, not a placeholder grid wall

### What NOT To Do
- No placeholder or generic layout
- No grid wall of empty cards

### Frontend Checklist
- [ ] Design big retention graph as hero surface
- [ ] Display key numbers below graph
- [ ] Add 2-4 compact metric cards below numbers
- [ ] Privacy-safe retention without personal profiling

---

## Backend — Codex (FULL BUILD — Zero to One)

### Current State
- Current page uses SIMULATED retention from summary timeseries
- NO real retention API exists behind it
- This is a true zero-to-one backend build

### Cohort Computation
- Group users by first-seen date
- Track return rates over time
- Support cohort cadences: Daily, Weekly, Monthly

### Return Windows
- Day 1, Day 7, Day 14, Day 30 retention rates
- Define cohort freshness rules
- Privacy-safe retention measurement without personal profiling

### ClickHouse Schema
- Build or extend tables for user aggregate storage
- Define how first-seen/last-seen are computed without violating privacy

### API
- Cohort report API: cohort date, sizes, return rates by period
- Cohort trend API: overall retention curve data
- Confidence indicators on retention data

### Backend Checklist
- [ ] Build ClickHouse schema for user aggregates
- [ ] Build cohort computation logic
- [ ] Build cohort report API
- [ ] Build cohort trend API
- [ ] Support daily/weekly/monthly cohort cadences
- [ ] Add confidence indicators on retention data
