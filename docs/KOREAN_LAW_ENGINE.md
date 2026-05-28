# Korean Law Engine

The Korean Law Engine is myAI's official-source legal grounding layer. It is separate from Naver Search and from department notebook RAG. It uses law.go.kr and configured decision APIs through server-side routes under `/api/law/*`.

## Configuration

Important settings:

```env
LAW_API_ENABLED=true
LAW_OC=<law.go.kr-api-key>
KOREAN_LAW_API_KEY=<optional LAW_OC alias>
LAW_TIMEOUT_MS=8000
LAW_MAX_RESULTS=8
LAW_CONTEXT_BUDGET=10000
LAW_CACHE_ENABLED=true
LAW_CACHE_PATH=data/cache/law-cache.sqlite
LAW_CACHE_TTL_MS=86400000
LAW_CACHE_MAX_ENTRIES=1000
LAW_AUTO_DETECT=false
LAW_VERIFY_CITATIONS=true
LAW_IMPACT_MAP_ENABLED=true
LAW_HISTORY_TARGET=eflaw
LAW_DECISIONS_ENABLED=true
DECISIONS_API_KEY=<optional shared decision key>
HUNZAE_API_KEY=<constitutional-court key>
HAENGJIM_API_KEY=<administrative-appeal key>
HAENGJIM_API_PROVIDER=lawgo
```

Direct Law Workbench review settings:

```env
LAW_WORKBENCH_REVIEW_TIMEOUT_MS=300000
LAW_WORKBENCH_REVIEW_NUM_CTX=0
LAW_WORKBENCH_REVIEW_MAX_PROMPT_CHARS=90000
LAW_WORKBENCH_REVIEW_DOCUMENT_CHARS=16000
```

## Chat Routing

`server/promptRouter.js` selects law routes before normal notebook or web search when prompts are explicitly legal.

Important modes:

- `strict_law_search`: composer law-search mode, `lawSearchMode: true`; excludes uploaded documents, notebooks, and Naver Search.
- `law`: explicit legal prompt using official law evidence.
- `compliance_review`: department legal-review prompt combining internal material with official legal evidence.
- `normal_chat` / `notebook_rag` / `web_search`: non-law routes.

Law citations use `[L]`. Decision citations use `[D]`. Notebook and web citations remain `[N]` and `[W]`.

## API Surface

Mounted routes:

```text
GET  /api/law/status
GET  /api/law/tools
GET  /api/law/terms
POST /api/law/execute
POST /api/law/workbench
POST /api/law/workbench/review
POST /api/law/workbench/report
POST /api/law/search
POST /api/law/ai-search
POST /api/law/research
POST /api/law/action-plan
POST /api/law/article
POST /api/law/article/at
POST /api/law/article/diff
POST /api/law/history
POST /api/law/time-travel
POST /api/law/verify-citations
POST /api/law/precedents/search
POST /api/law/precedents/detail
POST /api/law/interpretations/search
POST /api/law/interpretations/detail
POST /api/law/admin-rules/search
POST /api/law/admin-rules/detail
POST /api/law/ordinances/search
POST /api/law/ordinances/detail
POST /api/law/annexes/search
POST /api/law/annexes/detail
POST /api/law/impact-map
POST /api/law/three-tier
POST /api/law/delegated-laws
POST /api/law/linked-ordinances
POST /api/law/linked-ordinance-articles
POST /api/law/linked-laws-from-ordinance
POST /api/law/decisions/search
POST /api/law/decisions/detail
```

`/api/law/execute` is a compatibility surface over native myAI handlers for common Korean-law tool names. It is not an external MCP server.

## Source Families

| Family | Routes / modules | Citation |
|---|---|---|
| Statute search/articles | `search`, `ai-search`, `article` | `[L]` |
| Citation verification | `verify-citations` | `[L]` + verification result |
| Precedents | `precedents/*` | `[L]` law-precedent metadata |
| Interpretations | `interpretations/*` | `[L]` |
| Admin rules | `admin-rules/*` | `[L]` |
| Ordinances | `ordinances/*`, linked ordinance routes | `[L]` |
| Annexes/forms/tables | `annexes/*` | `[L]` |
| Law structure | `three-tier`, `delegated-laws`, linked law routes | `[L]` |
| Constitutional Court decisions | `decisions/*` | `[D]` |
| Administrative appeals | `decisions/*` | `[D]` |
| Impact map | `impact-map` | `[L]` plus graph nodes/edges |
| Time-travel/history/diff | `article/at`, `article/diff`, `history`, `time-travel` | `[L]` |

## Law Workbench

Workbench evidence collection:

```text
public/modules/lawWorkbench.js
-> POST /api/law/workbench
-> server/law/lawWorkbench.js
-> statutes, decisions, ordinances, linked laws, history, impact metadata
-> browser stores official evidence snapshot in state.lawReviews
```

Review draft:

```text
POST /api/law/workbench/review
body: { query, conditions, workbench, documents, model }
-> server/law/lawWorkbenchReview.js
-> JSON-only review prompt
-> Ollama
-> reviewResult or structured error
```

Scope rule: Law Workbench review never auto-includes active chat-room attachments. Only documents explicitly attached in the Law Workbench upload UI are sent in `documents`.

Report:

```text
POST /api/law/workbench/report
-> structured markdown report
-> frontend can open it in Studio Document
```

Diagnostics are logged as `[law-workbench-review]` without prompt text or document body. Logs include prompt size, estimated tokens, document/evidence counts, elapsed time, and Ollama token counters when available.

## Department Legal Review

Department legal-review chat flows are different from the Law Workbench. They are routed through `/api/chat` and `server/compliance/*`.

Behavior:

- Requires internal material when the selected review type needs it.
- Internal material can come from uploaded documents or selected department notebook evidence.
- Official law evidence can include statutes, precedents, interpretations, admin rules, and ordinances.
- Compliance metadata is returned through `X-Notebook-Meta.compliance`.
- The assistant should clearly separate internal evidence from official law evidence.

## GRC Workbench

GRC review is an internal-policy audit, not a Korean Law Engine legal research flow.

Routes:

```text
POST /api/compliance/grc/review
POST /api/compliance/grc/report/pdf
```

GRC accepts target text and either policy text or a selected department notebook as the policy source. It uses Ollama JSON output with bounded input sizes and can save its draft opinion into Studio Document.

## Decision APIs

Decision routes use `server/law/decisionsApiClient.js`.

Configuration:

- `LAW_DECISIONS_ENABLED=false` disables decision routes.
- `HUNZAE_API_KEY` or `DECISIONS_API_KEY` configures Constitutional Court access.
- `HAENGJIM_API_KEY` or `DECISIONS_API_KEY` configures administrative appeal access where needed.
- `HAENGJIM_API_PROVIDER=lawgo` uses law.go.kr fallback behavior unless `HAENGJIM_API_URL` selects a hub API.

Some Constitutional Court list records may be list-only if the configured source does not provide full Korean text.

## Law Term KB

`GET /api/law/terms` searches the local legal-term knowledge base. The Law Workbench can use it silently for query expansion and prompt assistance; the UI no longer needs to render term chips.

## Time Travel

Supported date-aware operations:

- `POST /api/law/article/at`: article at a requested effective date.
- `POST /api/law/article/diff`: article diff between dates.
- `POST /api/law/history`: revision history.
- `POST /api/law/time-travel`: MCP-style wrapper that chooses article/full-law comparison.

Dates accept common `YYYY-MM-DD`, `YYYYMMDD`, `YYYY/MM/DD`, or `YYYY.MM.DD` forms where supported by the tool.

## Error Handling

`server/law/lawErrors.js` normalizes law errors. If official lookup fails, chat metadata carries an error marker and the assistant must not invent statute text. No-evidence answers should suppress source panels and follow-up suggestions.

## Rate Limits

Law routes use dedicated fixed-window buckets:

```env
RATE_LIMIT_LAW_SEARCH_PER_MINUTE=15
RATE_LIMIT_LAW_ARTICLE_PER_MINUTE=20
RATE_LIMIT_LAW_VERIFY_PER_MINUTE=20
RATE_LIMIT_LAW_RESEARCH_PER_MINUTE=8
RATE_LIMIT_LAW_IMPACT_PER_MINUTE=4
RATE_LIMIT_LAW_TIME_TRAVEL_PER_MINUTE=4
```

## Tests

Relevant commands:

```powershell
npm.cmd run test:law
npm.cmd run test:law-review-view
npm.cmd run test:grc
npm.cmd run test:grc-pdf
npm.cmd test
```
