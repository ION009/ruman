# Design System

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### Card Sizing Rule
- Cards should be sized according to content — no oversized cards with tiny content

### Horizontal Lines — BANNED
- Replace with cards which look better and compact

### Pop Cards for Input
- When taking input from the user like forms — use pop cards / modals
- Not long inline forms

### Charts and Graphs
- Use charts/graphs to represent information
- Graph should mention which things are represented (legends)

### Tags/Badges
- Remove excessive tags and badges

### Shell Goals
The dashboard shell needs to become smaller, smarter, and more premium.

### Card System
Create a small set of reusable card types:

- Hero chart card
- Compact KPI chip card
- Insight card
- Ranked list card
- Comparison card
- Modal form card
- Privacy or confidence note card

Rules:

- Compact KPI cards should stay compact.
- Supporting list cards should not become long walls of dividers.
- Use grouped surfaces, tabs, segmented controls, or mini-panels instead of endless stacked rows.

### Chart Language
Define one reusable chart language across the product:

- Warm accent for primary engagement signal
- Cool accent for supporting comparison signal
- Clear semantic colors for warning, critical, and success
- Consistent legends, hover states, and tooltips
- Consistent axis typography and grid opacity

Every chart spec should answer:

- what is the main metric
- what is the comparison metric
- what color means what
- what action the operator can take from it

### Modal And Pop Card Pattern
Use pop cards or modal sheets for:

- new goal / edit goal
- new funnel
- new segment
- new alert
- integrations connect flow
- site data import flow
- report scheduling
- any multi-field configuration form

Requirements:

- Short, focused, and stepwise
- Clear save or cancel actions
- Inline validation
- Escape and close behavior
- Keyboard accessible

### Reusable Notice Pattern
Use a compact, reusable notice style for:

- privacy-safe sampling
- low confidence
- beta features
- missing setup
- import results

These notices must explain the impact and the next step in 1 to 3 short sentences.

---

## Backend — Codex

> The design system is primarily a frontend concern. Backend responsibility is to ensure API responses provide the data needed for the card types, chart language, and notice patterns defined above:

- API responses should include confidence metadata for notice patterns
- API responses should include comparison/trend data for chart language
- API responses should include state signals (active, stale, beta) for status cards
