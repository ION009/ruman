---
name: analytics-dashboard-design
description: >
  Use this skill for every chart, graph, KPI card, stat panel, table, sparkline,
  heatmap, funnel, or any data display component in a web analytics product.
  Trigger any time the user says: build a dashboard, show metrics, make a chart,
  display sessions/pageviews/bounce rate/conversions, or create any analytics UI.
  This skill defines the exact aesthetic, library, color, and component rules.
  Never freestyle analytics UI without reading this first.
---

# Analytics Dashboard Design Skill

## Product Aesthetic

This is a **privacy-focused web analytics tool**. The design language is:
- Clean, calm, and data-first — inspired by Plausible, Rybbit, and Fathom
- Warm neutral canvas (not clinical white, not dark) — `#F7F6F3` or `#FAFAF9`
- Soft borders, generous whitespace, no decorative elements
- Data speaks for itself — no gradients, no shadows, no gimmicks
- Every component should feel like it belongs in a focused productivity tool

The look should feel: **calm → trustworthy → precise**. Not loud. Not marketing-y.

---

## What Is Banned

- Pie charts and donut charts — use ranked lists instead
- Heavy gradient fills under line charts
- Rainbow / multi-color palettes in a single chart
- Default Recharts or Chart.js colors (the purple `#8884d8`, the green `#82ca9d`)
- Box shadows on cards (flat UI only)
- Thick axis lines or bounding boxes around charts
- Colored card backgrounds or gradient headers
- Default library tooltips — always build custom
- Bold decorative typography or hero-style headings inside data panels

---

## Color Palette

**Canvas**: `#F7F6F3` (warm off-white — the page background)  
**Card surface**: `#FFFFFF` with border `1px solid #E8E6E1`  
**Border muted**: `#F0EDE8`  
**Text primary**: `#1C1917`  
**Text secondary**: `#78716C`  
**Text muted**: `#A8A29E`  

**Accent (primary data color)**: `#0D9488` (teal — clean, not corporate)  
**Accent 2 (second series only)**: `#F59E0B` (amber — warm contrast)  
**Positive**: `#16A34A` with bg `#F0FDF4`  
**Negative**: `#DC2626` with bg `#FEF2F2`  
**Neutral badge**: `#78716C` with bg `#F5F4F2`  

**Chart grid**: `#F0EDE8` — horizontal lines only, very faint  
**Tooltip bg**: `#1C1917`, text `#FAFAF9`  
**Ranked bar fill**: `#CCFBF1` (very light teal), stroke `#99F6E4`  

Use at most **2 data colors** in any single chart. Never more.

---

## Chart Type Rules

| Scenario | Use | Never use |
|---|---|---|
| Traffic over time | Thin line chart | Area with fill, bar chart |
| Top pages / referrers / countries | Ranked list with row-level bar | Any chart type |
| Device or browser breakdown | Ranked list with row-level bar | Pie, donut |
| Single metric | Stat card + inline sparkline | Full chart |
| Funnel / drop-off | Horizontal step funnel with % labels | Stacked bar |
| Hour × weekday activity | Heatmap grid (GitHub dot style) | Line chart |
| Comparing 2 metrics | Dual thin-line chart | Dual-axis chart |

When in doubt, use a **ranked list table** or a **stat card**. Simpler is always correct.

---

## Library Choices

**React projects**: Recharts — for line, bar, and composed charts  
**HTML/CSS/JS projects**: Chart.js v4 — configure from scratch, never use defaults  
**Sparklines**: Hand-rolled SVG `<polyline>` — never a full library for a mini chart  
**Heatmaps**: CSS grid of colored `div` cells — no library needed  
**Funnels**: Pure HTML/CSS — divs with widths set as percentages  

Avoid D3 unless the visualization is truly custom and non-standard.  
Avoid Plotly (too heavy). Avoid Victory (heavier than Recharts, less flexible).

---

## Chart Configuration Rules (Apply to Every Chart)

- Line stroke width: `1.5px` — never thicker
- Line fill: **none** — no area fill, no gradient under the line
- Dots: hidden by default, show only on hover (`r=4`, white fill + accent stroke)
- Grid lines: horizontal only, never vertical, very faint (`#F0EDE8`)
- Axis lines: completely hidden on both axes
- Axis tick labels: `11px`, muted color, max 6 on X, max 5 on Y
- Legend: never the default library legend — use custom pill labels or direct line labels
- Tooltip: always custom-built, dark background, compact, tabular numbers
- Animation: on mount only, under 600ms

---

## Component Rules

**Stat card strip (KPI row)**  
Single bordered panel spanning full width. Cells separated by vertical dividers — not individual cards. Each cell: label (12px, secondary color) → big number (22px, 600 weight) → % badge (pill) → sparkline (80×20px SVG).

**Line chart panel**  
White card, `1px` border, `8px` radius. Title top-left. Time range toggle (Hour/Day/Week) top-right as small pill tabs. Chart fills the card body. No chart bounding box — just the lines on the canvas.

**Ranked list panel**  
White card with tabbed header (Pages / Referrers / Countries etc). Each row: name left + number right, then a full-width `4px` bar below it showing proportional share. Row hover: subtle background change only. No stripes.

**Heatmap**  
Grid of small squares (8–10px), `2px` gap, `2px` radius. 4-level intensity scale from near-white to full accent color. Day labels on top, hour labels on left. No borders around cells.

**Custom tooltip**  
Dark rounded card (`#1C1917`), `6px` radius, `8px 12px` padding. Date/time label in muted color. Metric rows: colored dot + label + right-aligned value. No arrow pointer. `box-shadow: 0 4px 12px rgba(0,0,0,0.12)`.

---

## Layout

- Page canvas: `#F7F6F3`, padding `24px`, max-width `1200px` centered
- 12-column CSS grid, `16px` gap
- Row order: KPI strip (12) → Main chart (12) → Side-by-side panels (6+6) → Full-width table (12)
- Every card: `background #FFFFFF`, `border 1px solid #E8E6E1`, `border-radius 8px`, `padding 16px 20px`
- No `box-shadow` on cards — flat only. Only tooltips get shadow.

---

## Typography

- Font: `Inter` or `system-ui` — always
- All numbers: `font-variant-numeric: tabular-nums` — no exceptions
- KPI number: `22px`, weight `600`, letter-spacing `-0.02em`
- Chart axis ticks: `11px`, weight `500`
- Panel titles: `14px`, weight `600`
- Table rows: `13px`, weight `400`
- Number shorthand: `1284920 → 1.28M`, `3721 → 3,721` — use `Intl.NumberFormat`

---

## Pre-Delivery Checklist

- [ ] No pie or donut charts anywhere
- [ ] No fill under any line chart
- [ ] Default library colors fully overridden
- [ ] Grid lines horizontal only, very faint
- [ ] Axis lines hidden
- [ ] Custom tooltip (not default)
- [ ] All numbers tabular-numbed
- [ ] % badges use semantic colors (green/red/gray pill)
- [ ] Sparklines are SVG polylines, not chart components
- [ ] No box shadows on cards
- [ ] Canvas is warm off-white, cards are white
- [ ] Font is Inter / system-ui throughout
