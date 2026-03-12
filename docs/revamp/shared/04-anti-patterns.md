# Anti-Patterns — What To NEVER Do

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### ❌ Horizontal Lines
> "some sort of line is used the whole project which looks really ugly you need to fix all of them"

Applies to: Realtime, Heatmaps, Events, Funnels, Segments, and all other pages

### ❌ Oversized Cards
> "cards are bigger but content inside it is not so it should be only what content is and card should be sized according to that"

### ❌ Ugly Big Cards and Buttons
> "big card looks ugly" / "buttons as well"

Mentioned for: Goals, Dashboard, Site Settings

### ❌ Long Horizontal Cards
> "not long horizontal lines and long horizontal cards"

Mentioned for: AI Insights, and general pattern

### ❌ Many Badges/Tags
> "has too many badges which look bad"
> "this page has lot of bunch of tags remove them"

Mentioned for: Dashboard, AI Insights

### ❌ Generic/Sloppy Pages
> "built like another sloppy and generic page"
> "just added like a placeholder"

Mentioned for: Funnels, Journeys, Retention, Segments, Alerts, Users

### ❌ Long Inline Forms
> "when taking input from the user like form or anything use pop cards"

Use pop cards/modals instead

---

## Backend — Codex

### ❌ Faking Precision
- Never improve the UI by faking precision that the backend cannot defend
- If data is modeled/estimated/sampled/privacy-thresholded → say so clearly
- Never claim exactness when the current pipeline is only approximate
