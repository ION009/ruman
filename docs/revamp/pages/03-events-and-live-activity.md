# 03 — Events + Live Activity

**Route**: `/events`
**Component**: `apps/web/components/dashboard/events-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- This page was never built properly → **build completely like a new**, both logic and UI
- Should display a **big graph of events** first
- Below the graph: **2 small cards** focusing on different events
- Then display **events page-wise** according to user website
- User can click a specific page and the **list shows events accordingly**
- Accuracy of events should be **nearly 99.99 percent** with privacy focused
- Live activity feature was never built properly
- **Does not need a separate page** — merge it into Events page
- Show **2 cards** and graphical representation of live activities
- **Remove Live Activity page from sidebar**

### UI Direction
- Make the events graph the main hero surface
- Put two compact support cards below the graph
- Merge live activity into this page instead of keeping it separate
- Add page-wise event filtering and event drill-down
- Add live activity cards (2 compact cards) with graphical live movement indicators
- Improve event family clarity and legend behavior
- Improve event trust and privacy summary

### What NOT To Do
- No horizontal line patterns
- No separate live activity page

### Frontend Checklist
- [ ] Merge live activity into events page
- [ ] Design top event trend graph (large, hero)
- [ ] Add two smaller support cards below graph
- [ ] Add live activity cards (2 compact cards)
- [ ] Add graphical live movement indicators
- [ ] Add page-wise event filtering and drill-down
- [ ] Improve event family clarity and legend behavior
- [ ] Improve event trust and privacy summary
- [ ] Add replay linkage where permitted
- [ ] No horizontal line patterns

---

## Backend — Codex

### Accuracy Target: 99.99%

#### Tracker-Level Improvements
- Improve event deduplication at both tracker and ingestion level
- Improve event family normalization
- Handle SPA route-change event attribution correctly

#### API Improvements
- Improve event family modeling
- Improve per-page event filtering
- Add more reliable live aggregation path
- Add event trust/confidence scoring per family

#### Route Changes
- Remove or redirect standalone `/realtime` page
- Live activity data merged into events API

### Existing Foundation
- Event explorer payload already provides: families, comparison trends, property facets, top pages, devices, countries, privacy notes, confidence scoring, sample replay session IDs
- Extend and improve, don't discard

### Backend Checklist
- [ ] Improve event accuracy and deduplication logic
- [ ] Improve event family normalization
- [ ] Handle SPA route-change event attribution
- [ ] Improve per-page event filtering API
- [ ] Add reliable live aggregation path
- [ ] Add event trust/confidence scoring per family
- [ ] Remove or redirect standalone `/realtime` page
- [ ] Merge live activity data into events API
