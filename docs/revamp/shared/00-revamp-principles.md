# Revamp Principles

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## What Must Change

- No more oversized cards with tiny content inside.
- No more weak horizontal line patterns pretending to be information design.
- No more generic analytics SaaS layouts that look copied from a dashboard kit.
- No more mixing placeholder logic and production-looking UI without clearly marking what is beta or partial.

## Product Personality

The product should feel:

- premium
- precise
- privacy-conscious
- operator-friendly
- visually warm in light mode

It should not feel:

- sterile
- gimmicky
- over-badged
- cluttered
- fake-enterprise
- chart-heavy without narrative meaning

---

## Frontend — Claude

### Visual Rules
- Cards size to content, not to empty space.
- Important charts get more room than summary badges.
- Every large graph needs an immediate legend or decoding aid.
- Side panels and drawers are for drill-downs, not for primary content.
- Forms open in pop cards, modal dialogs, or sheets instead of living inline across the page.
- Each page should have one obvious hero surface, then 2 to 5 supporting blocks, not 10 equally loud blocks.

### Information Architecture Rules
- One page, one main job.
- Remove duplicate surfaces when a stronger page can absorb the workflow.
- Hide internal or beta routes unless they serve a deliberate product purpose.
- Keep navigation names aligned with what the page actually is.

### Interaction Rules
- User actions should feel fast, obvious, and reversible.
- Create and edit flows should use focused modal experiences.
- Export, filter, compare, and inspect actions should stay close to the relevant visualization.
- Empty states should teach the next step instead of just saying there is no data.

### Global UI Rules
- Remove badge spam, tag clutter, and decorative noise.
- Stop using long horizontal divider rows as the main layout pattern.
- Size cards to their content. No giant cards with tiny content.
- Prefer one strong hero surface per page, then compact support modules.
- Use charts, diagrams, legends, and compact ranked modules instead of weak text stacks.
- Any create or edit flow with multiple inputs should open in a modal, pop card, or sheet.
- Calendar and date range styling need a full visual refresh.

### Engineering Rules (Frontend)
- Shared primitives first, page-level polish second.
- Avoid rebuilding one-off widgets if the pattern will reappear elsewhere.
- Design specs should call out data dependencies so UI work does not outrun backend reality.
- A page is not done until routing, empty states, error states, and responsive behavior are all covered.

---

## Backend — Codex

### Data Trust Rules
- If data is modeled, estimated, sampled, or privacy-thresholded, say so clearly.
- If data is accurate and ready for decision-making, say why it is trustworthy.
- Confidence, privacy posture, and freshness should be visible, but compact.
- Never claim exactness when the current pipeline is only approximate.

### Global Backend Rules
- Privacy-first rules stay in force on every feature.
- Events, heatmaps, replay, journeys, retention, and user modeling need near 99.99% trust and accuracy where promised.
- Never improve the UI by faking precision that the backend cannot defend.
- Replay masking must be selective. Do not hash or destroy whole pages when only a few fields are sensitive.
- AI payloads must be structured, compact, and privacy-safe. No junk metric dumps.
- AI Insights uses LongCat only.
- Neo can use multiple providers, but it still needs strict tool safety and structured outputs.
- Pricing and plan restrictions are intentionally deferred. Leave architecture hooks for feature gating, but do not invent final pricing behavior now.
