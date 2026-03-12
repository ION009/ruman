# 02 — Realtime Geo

**Route**: `/map`
**Component**: `apps/web/components/dashboard/map-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

> ⚠️ **DO NOT CHANGE ANYTHING IN THE GLOBE CARD.** The 3D globe component is already built and working. Do not modify, rebuild, or restyle the globe itself. Only work on the surrounding modules (ranked lists, country cards, layout around the globe).

### What User Said (Exact Requirements)
- Icon in the sidebar should be of **earth or planet**
- **Remove** the "Privacy-safe geo" tag from this page
- Label planet earth with **countries in small text** in their maps
- Top countries cards look bad — same horizontal line problem → **fix all of them**
- Use some **other way** to display information in much better way
- Horizontal card is **not needed at all** — remove it
- Region card should show a **list of countries according to visitors with their number**
- Privacy-filtered card — same ranked list style with visitor numbers
- The **earth planet globe card must sit at the very top of the page** as the first visible element — a visual dot-map globe, nothing above it except the nav shell
- When hovering over the globe, the **country name should appear in/near the mouse cursor** (tooltip that follows the cursor)
- The globe is built up of dots — on hover, **only those same existing map dots should light up** for the hovered country; do NOT add a separate dot layer or separate markers on top of the map dots

### UI Direction
- Remove the `Privacy-safe geo` tag
- Use the earth or planet icon in the sidebar
- **Globe hero card at top of page**: the very first element on the page (below the nav shell) is the earth planet globe card — rendered as a dot-map globe (built from a grid of dots representing landmass/ocean). All other ranked modules and cards stack below it. Nothing sits above it on the page.
- Label countries subtly on the globe or map — small country-name text at country centroids
- **Hover behaviour**: as the cursor moves over the globe, detect which country is under the pointer. Show the country name in a tooltip that follows the cursor. Do not use a fixed tooltip box — it should move with the mouse.
- **Dot lighting on hover**: when a country is hovered, only the existing map dots that belong to that country should glow/highlight. Do NOT render an extra dot layer, extra SVG elements, or separate marker pins — the same dots the map is built from change their colour/opacity on hover.
- Replace weak country and region cards with compact ranked modules
- Remove the unnecessary horizontal card treatment
- Expose coverage, privacy floor, and withheld share compactly

### What NOT To Do
- No horizontal line patterns
- No unnecessary horizontal cards
- **No separate dot layer or additional markers** placed over the globe on hover — only the existing map dots should change state
- **No static tooltip box** — the country-name tooltip must follow the cursor

### Frontend Checklist
- [ ] Update sidebar icon and label to earth/planet
- [ ] Remove `Privacy-safe geo` tag clutter
- [ ] Build globe hero card at the **top of the page** — dot-map earth planet, first element below nav shell, all other modules below it
- [ ] Implement cursor-following country-name tooltip on globe hover (moves with mouse, not a fixed box)
- [ ] On hover, light up only the existing map dots for the hovered country — no separate dot layer or marker pins added
- [ ] Label countries subtly at centroids (small text on globe)
- [ ] Replace ugly country cards with ranked country modules
- [ ] Redesign region as ranked country list by visitor count
- [ ] Redesign city presentation and privacy-filter summary
- [ ] Expose coverage, privacy floor, and withheld share compactly
- [ ] No horizontal line patterns
- [ ] No separate dot layer or marker overlap on hover

---

## Backend — Codex

### Derived Realtime Signals to Add

| Signal | Description |
|---|---|
| Active now by country | Live visitor counts per country |
| Growth vs previous window | Country-level comparisons |
| Coverage confidence % | How complete the geo data is |
| Withheld geo share | What % is privacy-filtered |

### Existing Foundation
- DashboardMapView payload already provides countries, regions, cities, privacy floor, coverage
- Extend with derived signals above
- Ensure mobile-friendly payload sizes

### Backend Checklist
- [ ] Add derived realtime signals (active by country, growth, confidence)
- [ ] Ensure mobile-friendly payload sizes
