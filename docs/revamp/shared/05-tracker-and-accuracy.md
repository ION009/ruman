# Tracker & Accuracy

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

> Tracker and accuracy improvements are primarily backend/tracker concerns. Frontend responsibility is limited to:

- Rendering confidence scoring and sample size explanations provided by the backend
- Displaying accuracy indicators and privacy notices in heatmap and replay UIs
- Showing masking indicators where selective replay masking is active
- Displaying trust and freshness metadata provided by API responses

---

## Backend — Codex

### Tracker Script Improvements

The tracker already captures: sessions, events, heatmap interactions, replay sampling, performance hooks, optional DOM snapshots.

### Priority Improvements

| Area | What To Fix |
|---|---|
| Event deduplication | Improve dedup and event family normalization |
| Mouse/pointer precision | Tighten coordinate precision for heatmaps relative to actual page geometry |
| Scroll depth | Improve scroll depth and viewport normalization |
| Replay chunks | Improve chunk reliability across SPA route changes |
| Replay masking | Selective element/field masking NOT whole-page hashing |
| Multi-page coverage | Verify SPA and MPA session continuity |
| Confidence scoring | Add confidence and freshness metadata to all analytic API surfaces |
| Session boundaries | Improve session boundary detection for SPAs |

### Replay Masking Rules (Critical)
- Default: show everything faithfully
- Only mask what's truly sensitive:
  - Checkout / payment pages
  - Cards, passwords, personal info fields
  - Elements tagged with `data-replay-block`
- Even on sensitive pages: only mask specific parts, not everything
- Respect `data-replay-ignore` and `data-replay-unmask`

### Heatmap Precision
- Align plotting to true page geometry, viewport segment, and document size
- Support click, rage, dead, error, move, and scroll modes independently
- Account for dynamic content, lazy loading, and document size changes
- Canvas rendering: precision gradient maps, not blurry blobs

### Event Accuracy Target: 99.99%
- Deduplication at tracker and ingestion level
- Normalization of event families
- Privacy-safe property summaries
