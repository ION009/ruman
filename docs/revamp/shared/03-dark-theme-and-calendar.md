# Calendar

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### Calendar Revamp
- Premium calendar styling
- Stronger selected range states
- Clearer compare windows
- Compact preset handling (Today, 7d, 30d, 90d, 12m, Custom)
- Clean hover and focus states

Avoid:
- Default library styling
- Dull monochrome date cells
- Oversized padding that wastes space

---

## Backend — Codex

### State Requirements
- Preserve the existing single active range behavior
- Add explicit compare-range state if compare mode becomes part of the core product
- Define where compare-range state lives and how other pages read it

> Backend responsibility is limited to:

- Ensuring compare-range parameters are supported in API query contracts
- Ensuring date range APIs handle all preset formats (Today, 7d, 30d, 90d, 12m, Custom)
