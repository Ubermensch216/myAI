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

Implemented pieces:

- `server/law/` module structure with config, router, API client, cache,
  logging, intent detection, article normalization, and tool handlers.
- `GET /api/law/status`
- `POST /api/law/search`
- `POST /api/law/article`
- `POST /api/law/verify-citations`
- `POST /api/law/precedents/search`
- `POST /api/law/precedents/detail`
- `POST /api/law/interpretations/search`
- `POST /api/law/interpretations/detail`
- `POST /api/law/admin-rules/search`
- `POST /api/law/admin-rules/detail`
- `POST /api/law/ordinances/search`
- `POST /api/law/ordinances/detail`
- `POST /api/law/impact-map`
- `POST /api/law/article/at`
- `POST /api/law/article/diff`
- `POST /api/law/history`
- `legal_research` chat mode that combines statute, precedent, interpretation,
  admin-rule, and ordinance results based on intent flags
- Chat integration through `server/ollama.js` and `lawContextBuilder.js`
- `X-Notebook-Meta.law` response metadata
- Frontend law citation grouping (법령/판례/해석례/행정규칙/자치법규/웹/노트북),
  per-source-type badge colors, verification warning, and disclaimer rendering
- Frontend legal-prompt processing indicator that shows Korean Law Engine use
- Law source panel detail with official-law badge, law/article label, effective
  date, official link, and an expandable article excerpt with deep-link to
  law.go.kr when the official text is truncated
- Studio Law Explorer MVP that calls the impact-map endpoint and renders
  official-article, subject, obligation, condition, risk, and material-signal
  groups
- Per-record meta fields rendered for each citation kind (사건번호/선고법원/
  선고일자 for precedents, 회신기관/회신일자 for interpretations, 발령기관/
  종류/시행일 for admin rules, 지자체/종류/시행일 for ordinances)
- SQLite law cache at `data/cache/law-cache.sqlite`
- API key masking tests, private-response-field stripping tests, and cache
  normalization tests
- Smoke coverage for `/api/law/status`; optional live law.go.kr smoke coverage

Still incomplete or follow-up work:

- Frontend time-travel/diff UI (backend endpoints landed in Phase 4; UI is a
  follow-up).
- `action_plan` mode (Phase 5).
- Knowledge graph integration using the existing per-notebook `graph.sqlite`
  infrastructure.

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
LAW_IMPACT_MAP_ENABLED=true
LAW_HISTORY_TARGET=lsHstInq

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
- Public `/api/law/*` responses must strip internal `raw` upstream payloads
  before sending or returning cached results.
- All formatted errors and logs must pass through masking.

## Server Modules

Current modules:

```text
server/law/lawApi.js
server/law/lawApiClient.js
server/law/lawApiParser.js
server/law/lawArticleRef.js
server/law/lawCache.js
server/law/lawCitationFormatter.js
server/law/lawConfig.js
server/law/lawContextBuilder.js
server/law/lawDiff.js
server/law/lawErrors.js
server/law/lawIntent.js
server/law/lawLogger.js
server/law/tools/adminRules.js
server/law/tools/articleAt.js
server/law/tools/articleDetail.js
server/law/tools/articleDiff.js
server/law/tools/interpretations.js
server/law/tools/impactMap.js
server/law/tools/lawHistory.js
server/law/tools/lawText.js
server/law/tools/ordinances.js
server/law/tools/precedents.js
server/law/tools/searchLaw.js
server/law/tools/verifyCitations.js
```

`lawApiParser.js` owns law.go.kr JSON normalization (search results, article
payloads, precedent/interpretation/admin-rule/ordinance payloads, CDATA/HTML
stripping, upstream error detection). It is exercised by
`scripts/law-parser-test.mjs` against fixtures in `scripts/fixtures/law/` that
cover several statute families, branched articles, paragraphs, items, CDATA
wrappers, HTML-encoded revision markers, and each Phase 2 non-statute source
family.

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

### `POST /api/law/precedents/search`

Request:

```json
{ "query": "불법행위 손해배상", "display": 5, "court": "", "caseType": "" }
```

Searches official 판례 (precedents) by keyword. Returns case number, court,
선고일자, 사건종류명, and a `precId` that can be passed to the detail
endpoint. Uses the `law_research` rate-limit bucket.

### `POST /api/law/precedents/detail`

Request:

```json
{ "precId": "230001" }
```

Returns the canonical precedent record: 판시사항, 판결요지, 이유, plus a
`law_precedent` citation. Either `precId` or `caseNumber` may be supplied;
when only `caseNumber` is given the search step is performed first.

### `POST /api/law/interpretations/search`

Request:

```json
{ "query": "개인정보 보호법 제15조", "display": 5, "agency": "" }
```

Searches official 법령해석례 (legal interpretations) issued by 법령해석
기관. Returns 안건명, 회신기관, 회신일자, and an `expcId`.

### `POST /api/law/interpretations/detail`

Request:

```json
{ "expcId": "EXPC-2023-0099" }
```

Returns the interpretation record split into 질의요지, 회답, 이유 sections,
combined into the `text` field with `[질의요지]/[회답]/[이유]` markers, plus a
`law_interpretation` citation. Either `expcId` or `query` may be supplied;
`query` resolves to the top hit through the search endpoint.

### `POST /api/law/admin-rules/search`

Request:

```json
{ "query": "개인정보 안전성 확보조치", "display": 5, "agency": "" }
```

Searches official 행정규칙 (고시/예규/훈령/지침) by keyword. Returns title,
발령기관, 종류, 발령일자, 시행일자, and an `admrulId` that can be passed to
the detail endpoint. Uses the `law_research` rate-limit bucket.

### `POST /api/law/admin-rules/detail`

Request:

```json
{ "admrulId": "ADM-2024-0001" }
```

Returns the canonical admin-rule record plus a `law_admin_rule` citation. Either
`admrulId` or `query` may be supplied; `query` resolves to the top hit through
the search endpoint.

### `POST /api/law/ordinances/search`

Request:

```json
{ "query": "서울특별시 주차장 조례", "display": 5, "region": "서울특별시" }
```

Searches official 자치법규 (조례/규칙) by keyword. Returns title, 지자체, 종류,
공포일자, 시행일자, and an `ordinId` that can be passed to the detail endpoint.
Uses the `law_research` rate-limit bucket.

### `POST /api/law/ordinances/detail`

Request:

```json
{ "ordinId": "ORD-SEOUL-12345" }
```

Returns the canonical ordinance record plus a `law_ordinance` citation. Either
`ordinId` or `query` may be supplied; `query` resolves to the top hit through
the search endpoint.

### `POST /api/law/impact-map`

Request:

```json
{ "lawName": "개인정보 보호법", "article": "제15조", "subject": "회원가입 양식", "materialText": "optional local material excerpt" }
```

Fetches the official statute article, then returns a deterministic structural
impact map. It does not ask the model to infer legal duties. The response
contains one official law citation plus graph-like `nodes`, `edges`, `groups`,
and `warnings` under `impactMap`.

### `POST /api/law/article/at`

Request:

```json
{ "lawName": "민법", "article": "제750조", "effectiveDate": "2012-03-04" }
```

Returns the official article body as it stood on the requested 시행일자
(historical snapshot). Internally switches the upstream call to
`target=eflawjosub` and passes `efYd=YYYYMMDD`. Accepts `YYYY-MM-DD`,
`YYYYMMDD`, `YYYY/MM/DD`, or `YYYY.MM.DD`; invalid dates return 400. Snapshots
are immutable, so cache TTL is 30 days. Uses the `law_time_travel` rate-limit
bucket. Response includes `effectiveDate` (the date requested) and
`snapshotEffectiveDate` (the actual snapshot date law.go.kr returned).

### `POST /api/law/article/diff`

Request:

```json
{ "lawName": "개인정보 보호법", "article": "제15조", "fromDate": "2012-03-04", "toDate": "2023-09-15" }
```

Fetches the article at both effective dates via `getArticleAt`, then runs a
deterministic LCS-based line diff in `server/law/lawDiff.js`. Adjacent
removed+added line pairs with bigram-Jaccard similarity ≥ 0.5 are collapsed
into a single `modified` hunk so the UI can show side-by-side rewrites instead
of separate red/green lines.

Response:

```js
{
  ok: true,
  query: { lawName, article, fromDate, toDate },
  from: { citation, text, effectiveDate, snapshotEffectiveDate, cacheHit },
  to:   { citation, text, effectiveDate, snapshotEffectiveDate, cacheHit },
  diff: {
    fromLineCount, toLineCount, identical,
    hunks: [
      { type: "unchanged", text },
      { type: "added", text },
      { type: "removed", text },
      { type: "modified", oldText, newText, similarity }
    ],
    stats: { added, removed, modified, unchanged }
  }
}
```

`fromDate` and `toDate` must both validate and must differ. Uses
`law_time_travel` rate-limit bucket. No model inference is involved; the diff
is purely structural so two calls with the same inputs always produce the same
hunks.

### `POST /api/law/history`

Request:

```json
{ "lawName": "민법" }
```

Lists 시행일별 개정 이력 for a given law (`lawName`, `lawId`, or `mst` accepted).
Calls upstream with `target=lsHstInq` (overridable via `LAW_HISTORY_TARGET`)
and returns a `revisions` array sorted newest-first. Each entry carries
`{ effectiveDate, promulgationDate, mst, promulgationNumber, revisionType, title }`
so callers can pick two dates to feed into `/api/law/article/diff`. Cached for
7 days. Uses the `law_time_travel` rate-limit bucket.

## Chat Behavior

Activation is explicit by default. `LAW_AUTO_DETECT=false` means ordinary chat
is not diverted into legal lookup.

Legal lookup runs when:

- The prompt explicitly asks to find law text or verify legal citations.
- The prompt contains a recognizable law-name plus article pattern.
- The prompt asks for official precedent, legal interpretation, admin-rule, or
  ordinance research with a research verb such as find/search/show/explain.
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
      url: "...",
      excerpt: "...",
      excerptTruncated: false,
      excerptLength: 240
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

Phase 2 research citations may also use:

```js
{ citationId: "P1", sourceType: "law_precedent", recordType: "precedent", title, caseNumber, court, date, caseType, locator, url }
{ citationId: "I1", sourceType: "law_interpretation", recordType: "interpretation", title, agency, date, locator, url }
{ citationId: "R1", sourceType: "law_admin_rule", recordType: "admin_rule", title, agency, kind, issueDate, effectiveDate, locator, url }
{ citationId: "O1", sourceType: "law_ordinance", recordType: "ordinance", title, region, kind, promulgationDate, effectiveDate, locator, url }
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

`test:law` runs three suites:

- `scripts/law-unit-test.mjs` — intent, normalization, masking, cache.
- `scripts/law-parser-test.mjs` — law.go.kr JSON parsing across fixture
  statutes plus precedent, interpretation, admin-rule, and ordinance fixtures
  (`scripts/fixtures/law/`). Run only this with `npm run test:law:parser`.
- `scripts/law-intent-eval.mjs` — true-positive / false-positive evaluation
  for legal intent detection. Covers cases like "라면 끓이는 방법 알려줘",
  "Git 사용법 1조 5호", "야구 규칙 30조" (must NOT trigger) and "민법 제750조",
  "헌법 제10조", "도로교통법 제44조", and research prompts for 판례/해석례/조례
  (must trigger). Run only this with `npm run test:law:intent`.

`test:smoke` checks `/api/law/status` whether or not `LAW_OC` is configured and
asserts the response does not expose the server cache path or API key.

Live law.go.kr endpoint checks are opt-in:

```powershell
$env:MYAI_SMOKE_LAW_LIVE="1"
npm.cmd run test:smoke
```

When the flag is set and `/api/law/status` reports `ok: true`, the smoke test
exercises `/api/law/search`, `/api/law/article`, and `/api/law/verify-citations`
across several statute families (민법, 형법, 도로교통법, 개인정보 보호법) so a
single run validates parser robustness against multiple real responses. It also
runs `POST /api/chat` with two grounded legal prompts and asserts that
`X-Notebook-Meta.law` carries the expected mode, citation list (with `excerpt`
field), and verification fail-count. The chat live test covers `law_article`
("민법 제750조 본문을 알려줘") and `verify_citations` ("조문 검증해줘:
민법 제750조, 민법 제9999조") modes.

## Acceptance Criteria

The statute-grounding baseline is acceptable when:

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

Phase 2 (complete):

- ✅ Precedent search/text tools (`/api/law/precedents/search`, `/api/law/precedents/detail`)
- ✅ Interpretation search/text tools (`/api/law/interpretations/search`, `/api/law/interpretations/detail`)
- ✅ Admin rule tools (`/api/law/admin-rules/search`, `/api/law/admin-rules/detail`)
- ✅ Ordinance tools (`/api/law/ordinances/search`, `/api/law/ordinances/detail`)
- ✅ `legal_research` chat mode wiring intent flags (wantPrecedents/Interpretations/AdminRules/Ordinances) into a combined context
- ✅ Richer law source-panel details (expandable article excerpt + deep-link)
- ✅ Frontend rendering for precedent/interpretation/admin/ordinance citations
  with per-source-type badges and meta fields

Phase 3:

- ✅ Impact map tool
- ✅ `/api/law/impact-map`
- ✅ Studio Law Explorer MVP

Phase 4 (backend complete):

- ✅ Historical article retrieval (`/api/law/article/at`, `target=eflawjosub` +
  `efYd`)
- ✅ Article diff (`/api/law/article/diff`, `server/law/lawDiff.js` LCS +
  bigram modified-pair detection)
- ✅ Law revision history list (`/api/law/history`, `target=lsHstInq`)
- ✅ `law_time_travel` rate-limit bucket wired through all three endpoints
- Frontend diff/timeline UI — pending (separate cycle)

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

The current engine covers statute search/article retrieval/citation
verification (Phase 1), Phase 2 official-source research for precedents, legal
interpretations, admin rules, and ordinances, Phase 3 impact maps, and Phase 4
time-travel/diff backend (`/article/at`, `/article/diff`, `/history`). Frontend
diff/timeline UI and the Phase 5 `action_plan` mode remain later phases.

The `LAW_HISTORY_TARGET` upstream parameter (`lsHstInq` by default) is the
documented law.go.kr revision-history target. If law.go.kr renames or
deprecates it, override via env without code change. Live verification of
`/history` requires `MYAI_SMOKE_LAW_LIVE=1` against a real `LAW_OC` key — the
parser is fixture-driven and accepts the common 시행일자/공포일자/제개정구분
field shapes, but the upstream target itself was not exercised against the
live API in the Phase 4 implementation cycle.

The department notebook KG integration is also future work. When added, it
should reuse the existing per-notebook `graph.sqlite` infrastructure rather than
creating a parallel legal graph store.
