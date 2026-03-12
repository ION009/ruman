# Privacy & Data Rules

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### Privacy Display Rules
- Every analytics-heavy page shows freshness and confidence in a compact way
- Every privacy-sensitive page shows what is anonymized and why
- Replay and heatmaps show masking indicators where active
- Privacy notes should be compact, not a warning wall

### Shared Acceptance Criteria (Frontend)
- [ ] Every analytics page shows freshness and confidence compactly
- [ ] Every privacy-sensitive page shows anonymization explanation
- [ ] Replay and heatmap UIs show masking indicators

---

## Backend — Codex

### Privacy Rules

| Rule | Detail |
|---|---|
| doNotTrack / globalPrivacyControl | Respect both |
| Geo | Coarse only |
| Identifiers | Pseudonymous by default |
| Personal identity | Never expose in AI payloads, shared dashboards, or public views |
| Replay masking | Selective and policy-driven, NOT whole-page |
| User tracking | Never track personal users — use fictional aliases |

### Data Trust Rules
- If data is modeled/estimated/sampled/privacy-thresholded → say so clearly
- If data is accurate → explain why it's trustworthy
- Confidence, privacy posture, freshness → visible but compact on every analytics page

### AI Data Exclusions (CRITICAL)

#### What to INCLUDE in LLM data packages
- Overview metrics: pageviews, sessions, visitors, bounce rate, avg duration, trends
- Top pages with performance metrics
- Referrer sources and quality
- Device/browser distribution
- Scroll patterns and engagement depth
- Event patterns and anomalies
- Goal conversion rates
- Confidence and data freshness notes

#### What to EXCLUDE from LLM data packages
- Raw events and replay payloads
- Visitor identifiers and IPs
- Cookies and session tokens
- Full DOM content
- Form text and free text content
- Any personal user information

### Neo Data Rules
- Clean, structured, tool-readable data — NOT raw payload dumps
- Tool outputs narrowed to exact scope of user request
- Include context, comparisons, confidence, privacy notes

### Shared Acceptance Criteria (Backend)
- [ ] Every AI or Neo workflow uses structured aggregates, not junk data
- [ ] Replay and heatmaps never trade away privacy-safe fidelity more than necessary
- [ ] All privacy rules enforced at tracker and ingestion level
