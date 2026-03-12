# 11 — Neo AI Panel

**Component**: `apps/web/components/dashboard/neo-panel.tsx`
**Access**: Top bar button or keyboard shortcut (not a sidebar route)

---

> **Claude** is responsible for all **Frontend** work below.
> **Codex** is responsible for all **Backend** work below.

---

## Frontend — Claude

### What User Said (Exact Requirements)
- Needs to **improve the Neo UI panel** — currently looks **very basic**
- Should be **beautiful but not funky** — **premium looking beautiful**
- Neo should be **integrated in all the pages** — regardless of which page user is on, Neo can answer about all pages
- Don't send **raw metrics or junk data** which results in worst quality
- Data should be in its **most suitable format** for LLM
- Build proper **complete tool registry** — give complete platform access to Neo but **safely**
- Build **security** for this
- **Ultimate autonomous AI agent** — should have all the power

### What Neo CAN Do
- Change user profile names
- Refund, give coupons for upgrade
- Help debug
- Change tracking script if broken, generate new working script
- Update database
- Connect to customer service
- Check whether script is functional by sending signals

### What Neo MUST NOT Do
- Neo **will not have access to delete user account or site or profile**
- Instead: **guide and give exact steps** how to do it

### UI Direction
- Upgrade Neo into a premium right-side panel
- Keep the visual tone calm and product-grade, not flashy
- Make it feel integrated across all pages
- Neo slides in from the right side
- Available on every page via top bar button or keyboard shortcut

### What NOT To Do
- No flashy/funky design
- No basic/generic chat UI

### Frontend Checklist
- [ ] Redesign Neo panel to premium right-side panel
- [ ] Keep visual tone calm and product-grade
- [ ] Integrate Neo across all pages (top bar button / keyboard shortcut)

---

## Backend — Codex (FULL BUILD)

### Data Access Tools
| Tool | Access |
|---|---|
| Dashboard summary | All metrics |
| Page-level analytics | Per-page data |
| Event explorer | Event families and properties |
| Heatmap metrics | Summaries and hotspots |
| Geo data | Country/region summaries |
| Goal/funnel reports | Conversion data |
| Retention data | Cohort data |
| User aggregate data | Anonymized user data |
| Session replay metadata | Session info (not raw replay) |

### Configuration Tools
| Tool | Access |
|---|---|
| Settings summary | Read settings |
| Settings modification | Update allowed settings |
| Tracker installation status | Check setup |
| Script generation | Generate new tracking script |
| Privacy settings | Read/update privacy config |
| Site page discovery | List discovered pages |

### Diagnostic Tools
| Tool | Purpose |
|---|---|
| Tracker health check | Send signals to verify script works |
| Script validation | Check if tracking script is functional |
| Data freshness check | When was data last received |
| Integration status | Check connected integrations |

### Action Tools
| Tool | Purpose |
|---|---|
| Profile update | Change user profile names |
| Refund or credit action | Issue refunds, credits, or upgrade remediation |
| Script regeneration | Generate new working script if broken |
| Config updates | Update tracking configuration |
| Alert management | Create/modify alerts |
| Coupon/upgrade | Issue coupons when business logic exists |
| Customer-service handoff | Route support context into service workflow |

### Security Model (CRITICAL)

| Level | Rules |
|---|---|
| read-only | Free access for all data read tools |
| safe-write | Profile updates, config changes, script regeneration — logged |
| restricted | Requires explicit confirmation |
| **FORBIDDEN** | Delete user account, delete site, delete profile |

For forbidden actions: Neo MUST explain exact manual steps how to do it.

### Data Quality Rules
- Each tool: structured, LLM-friendly output
- No raw payload dumps
- Narrow to exact user request scope
- Include context, comparisons, confidence, privacy notes

### LLM Usage
- Neo CAN use both Groq and LongCat
- LongCat-only rule applies ONLY to AI Insights page, NOT Neo

### Backend Checklist
- [ ] Build complete data access tool registry
- [ ] Build configuration tools
- [ ] Build diagnostic tools
- [ ] Build action tools
- [ ] Implement security model with forbidden actions
- [ ] Ensure all tool outputs are structured and LLM-friendly
