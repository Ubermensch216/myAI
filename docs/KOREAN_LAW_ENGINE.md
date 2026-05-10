# Korean Law Engine

This is the single living document for the native Korean Law Engine in myAI.
It replaces the former PRD document and keeps only the decisions, contracts,
current status, and remaining work that future agents need.

The engine adds an official law.go.kr grounding layer to myAI. It is native
server code under `server/law/`, not an external MCP server.

## Goals

- Retrieve and verify Korean statute references from official law.go.kr APIs.
- Keep official law evidence separate from department notebook, uploaded file,
  and Naver Search evidence.
- Prevent legal hallucinations: if an article cannot be verified, myAI must not
  invent the text or infer statute existence from web evidence.
- Allow explicit legal checks to combine with uploaded documents or department
  notebooks while keeping citation groups separate.

Citation families:

```text
notebook citations -> [N1], [N2]
law citations      -> [L1], [L2]
web citations      -> [W1], [W2]
```

## Current Status

Implemented MVP pieces:

- `server/law/` module structure with config, router, API client, cache,
  logging, intent detection, article normalization, and MVP tools.
- `GET /api/law/status`
- `POST /api/law/search`
- `POST /api/law/article`
- `POST /api/law/verify-citations`
- Chat integration through `server/ollama.js` and `lawContextBuilder.js`
- `X-Notebook-Meta.law` response metadata
- Frontend law citation grouping, verification warning, and disclaimer rendering
- Frontend legal-prompt processing indicator that shows Korean Law Engine use
- Law source panel detail with official-law badge, law/article label, effective
  date, and official link
- SQLite law cache at `data/cache/law-cache.sqlite`
- API key masking tests and cache normalization tests
- Smoke coverage for `/api/law/status`; optional live law.go.kr smoke coverage

Still incomplete or follow-up work:

- Validate real law.go.kr response parsing against several live statutes, not
  only the current smoke sample.
- Improve Korean legal intent extraction after false-positive evaluation.
- Add deeper article detail display, such as expandable excerpts, in the source
  panel.
- Add live tests for chat-level legal prompts when `LAW_OC` is configured.
- Post-MVP tools: precedents, interpretations, admin rules, ordinances, impact
  map, historical comparison, and action-plan mode.
- Post-MVP knowledge graph integration using the existing per-notebook
  `graph.sqlite` infrastructure.

## Configuration

`LAW_OC` is the canonical law.go.kr Open API key. `KOREAN_LAW_API_KEY` is
accepted by code only as a compatibility alias for migration. New docs and
examples should use only `LAW_OC`.

```env
LAW_API_ENABLED=true
LAW_OC=
LAW_USER_AGENT=Mozilla/5.0 (compatible; myAI Korean Law Engine)
LAW_TIMEOUT_MS=8000
LAW_MAX_RESULTS=8
LAW_CONTEXT_BUDGET=10000

LAW_CACHE_ENABLED=true
LAW_CACHE_TTL_MS=86400000
LAW_CACHE_MAX_ENTRIES=1000

LAW_AUTO_DETECT=false
LAW_VERIFY_CITATIONS=true
LAW_IMPACT_MAP_ENABLED=false

RATE_LIMIT_LAW_SEARCH_PER_MINUTE=15
RATE_LIMIT_LAW_ARTICLE_PER_MINUTE=20
RATE_LIMIT_LAW_VERIFY_PER_MINUTE=20
RATE_LIMIT_LAW_RESEARCH_PER_MINUTE=8
RATE_LIMIT_LAW_IMPACT_PER_MINUTE=4
RATE_LIMIT_LAW_TIME_TRAVEL_PER_MINUTE=4
```

Security rules:

- The API key is server-side only.
- Never send `LAW_OC`, `KOREAN_LAW_API_KEY`, upstream `OC=` query values, full
  upstream URLs, or server cache paths to browser JavaScript, response metadata,
  retrieval logs, or error bodies.
- All formatted errors and logs must pass through masking.

## Server Modules

Current MVP modules:

```text
server/law/lawApi.js
server/law/lawApiClient.js
server/law/lawArticleRef.js
server/law/lawCache.js
server/law/lawCitationFormatter.js
server/law/lawConfig.js
server/law/lawContextBuilder.js
server/law/lawErrors.js
server/law/lawIntent.js
server/law/lawLogger.js
server/law/tools/articleDetail.js
server/law/tools/lawText.js
server/law/tools/searchLaw.js
server/law/tools/verifyCitations.js
```

Do not add MCP protocol dependencies. Tool handlers should remain plain async
functions that can be called from Express routes and chat orchestration.

## API Endpoints

### `GET /api/law/status`

Returns engine configuration and public cache/usage status. With `LAW_OC` unset
or `LAW_API_ENABLED=false`, it returns structured `503` with `ok: false`.

The response must not expose the API key, upstream URLs, `OC=` values, or server
filesystem paths.

### `POST /api/law/search`

Request:

```json
{ "query": "civil code", "display": 10 }
```

Searches official law names and returns normalized candidates.

### `POST /api/law/article`

Request:

```json
{ "lawName": "civil code", "article": "article 750" }
```

Normalizes the article reference, resolves the law, fetches official article
text, and returns `[L]` citation metadata plus article text.

### `POST /api/law/verify-citations`

Request:

```json
{ "text": "Verify civil code article 750 and civil code article 9999." }
```

Extracts statute/article citations and verifies whether each official article
can be retrieved.

## Chat Behavior

MVP activation is explicit. `LAW_AUTO_DETECT=false` means ordinary chat is not
diverted into legal lookup.

Legal lookup runs when:

- The prompt explicitly asks to find law text or verify legal citations.
- The prompt contains a recognizable law-name plus article pattern.
- The prompt explicitly asks whether an uploaded document or selected department
  notebook material complies with a law.

Naver Search remains ordinary web search. If a prompt has both legal and news
intent, the law engine is authoritative for statute existence and original
article text. Naver results may be included as separate `[W]` web evidence, but
must not be used to assert statute existence when law.go.kr lookup fails.

When law context exists, `server/ollama.js` injects a separate official-law
context block and model instructions:

```text
[Official Korean Law Evidence]
[L1] ...

Instructions:
- Use only provided law context for statute/article claims.
- Do not invent law names, article numbers, paragraphs, items, precedents, or
  interpretations.
- If legal context is insufficient, say so explicitly.
- Keep [L], [N], and [W] citations separate.
```

## Response Metadata

Chat responses expose law metadata through `X-Notebook-Meta`:

```js
law: {
  ok: true,
  query: "...",
  mode: "law_article",
  citations: [
    {
      citationId: "L1",
      sourceType: "law",
      lawName: "...",
      article: "...",
      canonical: "...",
      title: "...",
      locator: "...",
      effectiveDate: "...",
      url: "..."
    }
  ],
  verification: {
    checked: true,
    failCount: 0,
    results: []
  },
  disclaimer: "short" | "mandatory" | null,
  error: ""
}
```

The browser stores and renders this metadata, but it must never receive API keys
or upstream request URLs.

## Article References

`server/law/lawArticleRef.js` owns canonical article-reference normalization.
It is shared by intent detection, cache keys, verification results, and future
knowledge graph `Article` node IDs.

Canonical citation IDs use slash-separated parts:

```text
lawName/article/paragraph/item/subitem
```

Examples in current tests use the mojibake-compatible strings already present
in the codebase. When editing parser behavior, preserve these tests and add
proper Korean Unicode fixtures where possible.

Required behaviors:

- Numeric article variants collapse to the same canonical article.
- Branched article variants preserve the branch number.
- Paragraph, item, subitem, and circled paragraph numbers are parsed.
- Cache keys use canonical article references so equivalent inputs hit the same
  row.

## Verification

If a citation cannot be verified, myAI must not invent the article text. Chat
metadata carries verification failures, and the frontend renders a visible
warning in the source panel.

Internal failure markers:

```text
NOT_FOUND
HALLUCINATION_DETECTED
LAW_API_ERROR
LAW_DISABLED
LAW_NOT_CONFIGURED
```

## Disclaimer Policy

Disclaimers are metadata-driven, not generated by the model.

| Mode | Disclaimer |
|---|---|
| `law_article` | none |
| `law_search` | none |
| `verify_citations` | none |
| `legal_research` | short |
| `department_legal_review` | short |
| `action_plan` | mandatory |

Avoid attaching disclaimers to simple article lookups. Use short disclaimers for
interpretation or compliance-style answers, and mandatory disclaimers for future
action-plan guidance.

## Privacy And Logging

Law API calls send only normalized fields such as law name, article reference,
and display count. They do not send the full user prompt.

Law retrieval logs are privacy-safe JSONL records under `data/logs/`:

```json
{ "tool": "article_detail", "normalizedQuery": { "lawName": "...", "article": "..." }, "latencyMs": 123, "resultCount": 1, "cacheHit": false, "errorMarker": "" }
```

Logs and errors mask `LAW_OC`, `KOREAN_LAW_API_KEY`, and any `OC=` URL
parameter.

## Testing

Fast tests:

```powershell
npm.cmd run test:law
npm.cmd run test:smoke
```

`test:smoke` checks `/api/law/status` whether or not `LAW_OC` is configured and
asserts the response does not expose the server cache path or API key.

Live law.go.kr endpoint checks are opt-in:

```powershell
$env:MYAI_SMOKE_LAW_LIVE="1"
npm.cmd run test:smoke
```

When the flag is set and `/api/law/status` reports `ok: true`, the smoke test
also exercises `/api/law/search`, `/api/law/article`, and
`/api/law/verify-citations`.

## Acceptance Criteria

The MVP is acceptable when:

- A server with `LAW_OC` configured can search a Korean law by name.
- myAI can retrieve a specific statute article.
- Explicit legal chat prompts produce answers grounded in retrieved law text.
- Answers include law citation metadata and the frontend displays `[L1]`.
- Citation verification detects valid and invalid citations.
- Missing articles are reported without invented article text.
- Department notebook evidence and law evidence remain separate.
- API keys and upstream `OC=` values never appear in frontend responses, logs, or
  errors.
- Tests pass with live law tests skipped unless explicitly enabled.
- Setup, limitations, and future work are documented here.

## Roadmap

Phase 2:

- Precedent search/text tools
- Interpretation search/text tools
- Admin rule and ordinance tools
- `legal_research` mode and `/api/law/research`
- Richer law source-panel details

Phase 3:

- Impact map tool
- `/api/law/impact-map`
- Studio Law Explorer MVP

Phase 4:

- Historical law retrieval
- Old/new comparison and legal diff UI

Phase 5:

- `action_plan` mode with mandatory disclaimer
- Structured-step response template
- Non-legal-advice framing tests

Knowledge graph track:

- Extend existing `server/rag/graph/ontology.js` with legal entity/relation
  types.
- Extend `server/rag/graph/extractor.js` to extract verified legal citations.
- Reuse `data/notebooks/<notebookId>/graph.sqlite`; do not create a parallel
  legal graph store.
- Re-fetch official article text through `LawApiClient` at answer time when a
  graph path retrieves an `Article` node.

## Limitations

The current MVP focuses on statute search, article retrieval, and citation
verification. Precedents, legal interpretations, admin rules, ordinances, impact
maps, time travel, and legal action plans are later phases.

The department notebook KG integration is also post-MVP. When added, it should
reuse the existing per-notebook `graph.sqlite` infrastructure rather than
creating a parallel legal graph store.
