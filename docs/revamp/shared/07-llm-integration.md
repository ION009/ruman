# LLM Integration

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

> LLM integration is primarily a backend concern. Frontend responsibility is limited to:

- Rendering the "Generate Insights" button and loading states on the AI Insights page
- Displaying the narrative analysis, insight cards, and charts returned by the backend
- Rendering Neo panel responses from backend LLM calls
- Displaying error states when LLM calls fail
- Never making direct LLM API calls from the frontend

---

## Backend — Codex

### Model Rules

| Feature | Model | Rule |
|---|---|---|
| AI Insights page | **LongCat ONLY** | Do NOT use Groq here |
| Neo AI Copilot | Both LongCat and Groq | Choose best for each task |
| All other AI | As needed | Follow existing config |

### AI Insights Pipeline (LongCat Only)

Build an agent/data pipeline that:

1. **Gathers relevant data** — overview metrics, top pages, referrers, device mix, scroll patterns, heatmap summaries, event patterns, goal conversions, rule flags, confidence notes
2. **Converts to LLM-friendly format** — structured and organized, NOT raw JSON dumps or junk data
3. **Passes to LLM with proper prompt** — ask for genuine analysis, not generic tips
4. **Returns analysis** — structured response with narrative, actionable insights, and evidence

### Data Package Format
```
Site: {domain}
Period: {start} to {end}
Confidence: {score}/100

METRICS:
- Pageviews: {n} ({delta}% vs prior)
- Sessions: {n} ({delta}% vs prior)
...

TOP PAGES:
1. {path} — {views} views, {bounce}% bounce, {depth}% avg scroll
...

REFERRERS:
1. {source} — {sessions} sessions, {engagement}% engaged
...

DEVICE MIX:
- Desktop: {n}%, Mobile: {n}%, Tablet: {n}%

ISSUES:
- {issue_type}: {count} occurrences
...
```

### Neo Data Formatting

Each Neo tool must output in LLM-optimal format:
- Narrow to exact scope of user request
- Include comparisons and trends
- Include confidence and freshness
- No raw metric dumps
- No junk or redundant data

### Existing Foundation
- AI Insights engine already runs in Go analytics backend
- Current engine already excludes raw events, replay, IPs, cookies, DOM, free text
- LongCat defaults already in config
- Improve packaging quality, not discard foundation
