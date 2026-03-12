# 06 — Session Replay

**Route**: `/session-replay`
**Component**: `apps/web/components/dashboard/replays-view.tsx`

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Not built properly → needs **lot of fixes**
- Accuracy should be **top notch**, should **cover all pages** and **record all pages properly**
- Currently **replacing ALL text in the screen with hashes** which looks bad
- Should show **proper exactly site replay**
- Only replace **cards, checkout, and all the privacy pages** where privacy is a concern
- On those pages too, only replace **specific parts** — not the whole page
- Everything else should show **proper**
- This page has a problem of **horizontal scrolling** — fix it, should be **fixed layout**
- Layout order:
  1. **Replay video container on TOP**
  2. **Controls below it** — can be clicked on container to **pause and play**
  3. Below controls: **issue markers**
  4. Below markers: **2 cards** showing metrics in **good graphical format**
  5. Below cards: show **privacy and what we do for privacy** badges/notes

### UI Direction
- Put the replay player at the top and controls below it
- Allow click-to-play or pause on the player area
- Move issue markers below the controls
- Show two good-looking metric cards below the markers
- Add a compact privacy explanation block
- Remove horizontal scrolling from the page layout

### What NOT To Do
- No horizontal scrolling
- No replacing entire pages with hashes

### Frontend Checklist
- [ ] Move replay player to top of page
- [ ] Add controls below player with click-to-play/pause
- [ ] Add issue markers section below controls
- [ ] Add two metric cards with graphical format below markers
- [ ] Add compact privacy explanation block
- [ ] Fix horizontal scrolling — use fixed layout

---

## Backend — Codex

### Critical Fixes
- Improve replay reliability across ALL tracked pages
- Improve SPA route handling and session chunk continuity
- Improve time markers for rage/dead clicks, console errors, network failures
- Standardize masking rules so fidelity is high where allowed
- Ensure multi-page session coverage works properly

### Masking Policy (CRITICAL)
- Do NOT replace entire pages with hashes
- Only mask truly sensitive parts:
  - Checkout/payment forms
  - Card numbers, passwords, personal info
  - `data-replay-block` elements
- Keep existing sensitive-region heuristics but make policy easier to reason about and override
- Support `data-replay-ignore` and `data-replay-unmask` controls

### Backend Checklist
- [ ] Fix replay masking — selective only, not whole-page hashing
- [ ] Improve replay reliability across all pages
- [ ] Improve SPA route handling and session chunk continuity (tracker)
- [ ] Improve time markers for rage/dead clicks, errors
- [ ] Ensure multi-page session coverage works (tracker)
- [ ] Standardize masking rules for high fidelity
