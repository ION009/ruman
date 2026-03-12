# 05 — Heatmaps

**Route**: `/heatmaps`
**Component**: `apps/web/components/dashboard/heatmaps-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- **Heatmap container/box on TOP** — currently it is opposite, fix that
- **Controls below it**
- Same pattern of horizontal lines needs to be fixed — replace with **cards which look better and compact**
- When clicked on scroll depth and selector → should show some **other graph or something else**, not horizontal lines
- Accuracy of heatmap tracking, mouse tracking, and **all kinds of tracking** must be **industry-grade and even better**
- How information is **plotted in the canvas** should look **industry-grade** — **not just circles** — should be **very precise**
- Info cards (when hovering) could be a **little more compact and better**

### UI Direction
- Put the heatmap canvas at the top and controls below it
- Replace horizontal line layouts with compact cards and visual controls
- Make hover info smaller and cleaner
- Heatmap rendering should look precise, not like blurry circles
- Implement precision gradient rendering
- All five modes working: engagement, click, rage, move, scroll

### What NOT To Do
- No horizontal lines
- No blurry circle blobs

### Frontend Checklist
- [ ] Move heatmap canvas to top
- [ ] Move controls below the canvas
- [ ] Redesign selector and scroll support modules
- [ ] Remove repetitive horizontal line styling
- [ ] Improve heatmap plotting fidelity to industry-grade
- [ ] Implement precision gradient rendering (not blurry circles)
- [ ] Improve hotspot labeling and overlay clarity
- [ ] Compact hover info cards
- [ ] All five modes working: engagement, click, rage, move, scroll

---

## Backend — Codex

### Tracker Improvements (CRITICAL)
- Tighten mouse and pointer coordinate precision relative to actual page geometry
- Improve scroll depth and viewport normalization for static and dynamic layouts
- Ensure coordinates adapt to document size changes (lazy loading, dynamic content)
- Support all modes independently: click, rage, dead, error, move, scroll

### Backend Improvements
- Strengthen confidence scoring and sample size explanations
- Improve hotspot labeling
- Improve element-level overlay data

### Existing Foundation
- Viewport segmentation exists
- Confidence scoring exists
- DOM snapshot loading exists
- Stored screenshots exist
- Discovered page lists exist
- Improve how it is surfaced, don't discard

### Backend Checklist
- [ ] Improve pointer and scroll tracking precision (tracker)
- [ ] Improve scroll depth and viewport normalization
- [ ] Support coordinate adaptation for dynamic content
- [ ] Support all modes independently (click, rage, dead, error, move, scroll)
- [ ] Strengthen confidence scoring display
- [ ] Verify screenshot and DOM snapshot handling
- [ ] Verify privacy-safe blocked zones
