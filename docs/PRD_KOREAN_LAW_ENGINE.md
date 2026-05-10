# PRD: Korean Law Engine Integration

**Version: v2 (2026-05-10).** v2 incorporates review feedback. Tightened items: explicit MVP activation default (`LAW_AUTO_DETECT=false`), Naver Search vs Korean Law precedence, mode-by-mode disclaimer policy, article-reference normalization spec, file-naming alignment (`lawApi.js`), cache relocation (`data/cache/`), KG reuse-rather-than-fork policy, concrete rate-limit defaults, external-API privacy/logging rules, `LAW_OC` as canonical env (`KOREAN_LAW_API_KEY` only as compatibility alias), non-functional acceptance criteria, fixed §12/§17 phase numbering.

## 1. Purpose

This document gives implementation context and concrete requirements for absorbing `korean-law-mcp` into `myAI` as a native Korean law grounding layer.

The goal is not to run `korean-law-mcp` as an external MCP server. The goal is to migrate and adapt its useful code into `myAI` so that `myAI` can search, retrieve, verify, cite, compare, and reason over Korean law information from official legal APIs.

Target outcome:

```text
myAI chat / department notebook RAG / Studio
-> detects legal-information needs
-> calls native Korean Law Engine
-> retrieves official Korean law context
-> verifies statute/article citations
-> produces grounded answers with law citations
-> optionally connects legal references to department notebook RAG and KG
```

## 2. Background

### 2.1 Current myAI state

`myAI` is a local Ollama-based AI secretary and department knowledge platform. Current major capabilities include:

- streaming chat
- personal uploaded-document analysis
- department notebooks with RAG
- group/level/Super notebook-read access control
- Admin Console
- RAG Status and RAG Quality evaluation
- department notebook knowledge graphs
- Studio graph viewer
- Naver Search for explicit ordinary web-search prompts
- encrypted browser IndexedDB persistence for personal data

The important architectural principle is that `myAI` already separates several grounding sources:

```text
Personal uploaded documents
Department notebook RAG
Department notebook KG
Naver Search
Normal model-only chat
```

The Korean law feature must be added as a new grounding layer, not as a replacement for existing RAG.

### 2.2 korean-law-mcp source project

`korean-law-mcp` is a TypeScript MCP server and CLI built around Korean legal information APIs. It provides tools for:

- statute search and text retrieval
- article-level retrieval
- precedent and decision search
- administrative rules
- local ordinances
- treaties
- legal interpretations
- law history and old/new comparisons
- annexes/forms
- citation verification
- article impact maps
- time-travel comparison
- citizen action-plan style legal guidance

The myAI integration should reuse the legal API client and domain logic, but remove the MCP protocol layer.

## 3. Product Vision

Add a native `Korean Law Engine` to myAI.

The engine should allow myAI to answer questions such as:

```text
민법 제750조 불법행위 요건을 설명해줘.
개인정보 보호법 제26조 위탁 관련 조문을 찾아줘.
이 답변의 조문 인용이 실제로 맞는지 검증해줘.
우리 부서노트북의 개인정보 처리 위탁 지침이 개인정보보호법에 맞는지 검토해줘.
민법 제103조가 판례와 해석례에서 어떻게 인용되는지 영향도를 보여줘.
2020년과 2025년 개인정보보호법 조문 차이를 비교해줘.
```

The legal layer must be treated as an official grounding source. It is closer to department notebook RAG than to Naver Search.

## 4. Non-Goals

The first implementation must not attempt to do everything in `korean-law-mcp` at once.

Non-goals for MVP:

- do not expose an MCP server from myAI
- do not run korean-law-mcp as a child process
- do not add per-user legal accounts
- do not build a full legal research product in the first pass
- do not store API keys in browser state
- do not mix legal API results into answers silently without citations
- do not allow the LLM to invent statutes, article numbers, paragraphs, or case references

## 5. Design Principle

### 5.1 Official legal grounding layer

Korean law context is a new source type:

```text
sourceType = "law"
```

It sits beside existing source types:

```text
notebook citations -> [N1], [N2]
web citations      -> [W1], [W2]
law citations      -> [L1], [L2]
```

### 5.2 Law search is not normal web search

Current myAI intentionally skips Naver Search when uploaded documents or a department notebook is active. That policy stays.

Korean Law Engine is different. It is allowed to combine with department notebooks and uploaded documents when the user explicitly asks for a legal check.

Policy:

```text
Naver Search:
- use only for explicit ordinary web-search prompts
- skip when uploaded documents or department notebook are active

Korean Law Engine:
- use for explicit legal-information prompts
- may combine with uploaded documents and department notebooks
- always keep legal citations separate from document/notebook citations
```

### 5.3 No citation, no legal claim

If a law/article/paragraph cannot be found, myAI must not invent it.

Use explicit failure markers internally:

```text
[NOT_FOUND]
[HALLUCINATION_DETECTED]
[LAW_API_ERROR]
```

If a legal lookup fails, the assistant may explain that official legal lookup failed, but must not fabricate the law text.

### 5.4 Naver Search vs Korean Law precedence

When a single prompt could trigger both Korean Law Engine and Naver Search, apply this precedence:

```text
1. If the prompt contains a recognizable statute/article pattern (lawName + 제N조),
   call Korean Law Engine first.
2. If the user explicitly asks for news/coverage ("뉴스", "최근 보도", "언론", "웹에서"),
   Naver Search may also run as a separate, lower-priority context source.
3. When both run, [L] law citations and [W] web citations remain separate in the
   source panel. Never merge them into one list.
4. For statute existence and original article text, Korean Law Engine results are
   authoritative. Web results must not be used to assert that a statute exists.
5. If Korean Law Engine returns NOT_FOUND or LAW_API_ERROR, the assistant must not
   conclude statute existence from web evidence alone.
```

This rule is enforced in the chat orchestrator (`server/ollama.js` prompt build path), not delegated to the LLM through prose instructions alone.

## 6. Proposed Architecture

### 6.1 New server module layout

Add native modules under `server/law/`. Naming follows the existing `*Api.js` convention used by `server/ragEvalApi.js`, `server/graphAdminApi.js`, and `server/graphStudioApi.js`:

```text
server/law/
  lawConfig.js
  lawApiClient.js
  lawApi.js                 # Express router; was lawRouter.js in v1
  lawIntent.js
  lawContextBuilder.js
  lawCitationFormatter.js
  lawCitationVerifier.js
  lawArticleRef.js          # canonical article-reference normalization (new in v2)
  lawCache.js
  lawErrors.js
  tools/
    searchLaw.js
    lawText.js
    articleDetail.js
    annexes.js
    history.js
    comparison.js
    verifyCitations.js
    decisions.js
    interpretations.js
    adminRules.js
    ordinances.js
    impactMap.js
```

The implementation may initially migrate only the MVP tools and add the remaining files later.

### 6.2 Avoid MCP protocol dependency

Do not keep the MCP `Server`, `Transport`, or `registerTools` execution model inside myAI.

Instead, convert useful tool handlers into plain async functions:

```js
export async function searchLaw({ query, display }) {}
export async function getLawArticle({ lawName, article, paragraph, item }) {}
export async function verifyLawCitations({ text }) {}
export async function buildImpactMap({ lawName, article }) {}
```

### 6.3 Environment variables

Add to `.env.example`, `.env.department.example`, `deploy/myai.env.example`, and the README configuration table:

```env
LAW_API_ENABLED=true

# Canonical legal API key. Server-side only.
LAW_OC=

LAW_USER_AGENT=Mozilla/5.0 (compatible; myAI Korean Law Engine)
LAW_TIMEOUT_MS=8000
LAW_MAX_RESULTS=8
LAW_CONTEXT_BUDGET=10000

LAW_CACHE_ENABLED=true
LAW_CACHE_TTL_MS=86400000
LAW_CACHE_MAX_ENTRIES=1000

# Auto-detect off in MVP. See §8.2 — prefer explicit activation until intent
# precision is measured. Flip to true only after the keyword set has passed a
# false-positive evaluation gate.
LAW_AUTO_DETECT=false
LAW_VERIFY_CITATIONS=true
LAW_IMPACT_MAP_ENABLED=false

# Per-route rate limits. See §13.3.
RATE_LIMIT_LAW_SEARCH_PER_MINUTE=15
RATE_LIMIT_LAW_ARTICLE_PER_MINUTE=20
RATE_LIMIT_LAW_VERIFY_PER_MINUTE=20
RATE_LIMIT_LAW_RESEARCH_PER_MINUTE=8
RATE_LIMIT_LAW_IMPACT_PER_MINUTE=4
RATE_LIMIT_LAW_TIME_TRAVEL_PER_MINUTE=4
```

Rules:

- `LAW_OC` is the canonical env name. `KOREAN_LAW_API_KEY` is accepted only as a
  compatibility alias for users migrating from `korean-law-mcp`. Documentation
  examples show only `LAW_OC`.
- Resolution order in code:
  ```js
  const apiKey = process.env.LAW_OC || process.env.KOREAN_LAW_API_KEY || "";
  ```
- Legal API keys are server-side only. Never send the key, the upstream `OC`
  query parameter, or full request URLs to the browser or to the JSONL
  retrieval log.
- Mask API keys in all logs and error messages (verified by unit test, see §13.6).

### 6.4 Caching

Korean law API responses are external-source caches that can be deleted and rebuilt. They are not search indexes. To keep operations and backup policies clean, the cache lives in a dedicated directory:

```text
data/cache/law-cache.sqlite
```

This separates from `data/indexes/` (which holds Qdrant/SQLite FTS search indexes that are part of the RAG retrieval path).

Initial implementation may use an in-memory LRU during early dev, but persistent SQLite caching is required for the MVP cache-hit acceptance criterion (§18.2).

Cache key:

```text
toolName + normalizedInput + effectiveDate
```

`normalizedInput` must use the canonical article-reference format defined in §8.6 so that `750`, `750조`, `제750조`, and `민법 제750조` map to the same key.

Suggested TTLs:

```text
law search results: 1 day
law article/text:   7 days, but invalidate when manifest's lastModified changes
precedent/decision: 7 days
verification:       1 day
impact map:         1 day
```

For article text, the LawApiClient records the law's `lastModified` (or equivalent revision marker) in the cache row. On read, if the freshly fetched manifest reports a newer revision, the cached article body is invalidated. This prevents serving pre-amendment text after a law revision.

## 7. MVP Scope

The MVP is called:

```text
Korean Law Grounding MVP
```

### 7.1 MVP capabilities

Implement:

```text
1. legal API status check
2. law name search
3. law text / article retrieval
4. article detail retrieval
5. citation verification
6. chat integration for explicit legal prompts
7. law citations in X-Notebook-Meta or an equivalent response metadata header
8. frontend source panel support for law citations
```

### 7.2 MVP tools to migrate

From `korean-law-mcp`, migrate/adapt these first:

```text
search_law
get_law_text
get_article_detail
verify_citations
parse_jo_code or equivalent article-code utility
law alias resolution
article number / paragraph parser (including circled paragraph numbers)
fetch-with-retry with browser-like User-Agent
error helpers including NOT_FOUND handling
```

### 7.3 MVP API endpoints

Add:

```text
GET  /api/law/status
POST /api/law/search
POST /api/law/article
POST /api/law/verify-citations
```

#### GET /api/law/status

Returns:

```js
{
  ok: true,
  enabled: true,
  configured: true,
  cache: {
    enabled: true,
    storage: "sqlite",
    hitRate: 0.0     // 24h rolling; may be null in early MVP
  },
  api: { provider: "law.go.kr" },
  usage: {
    todayCalls: 0,
    todayErrors: 0,
    lastError: null
  }
}
```

`hitRate` and `usage.*` may report `0` / `null` in the early MVP if instrumentation is deferred, but the response shape is reserved so frontend and Admin Console status panels can render it without future migration.

#### POST /api/law/search

Request:

```js
{
  query: "민법",
  display: 10
}
```

Response:

```js
{
  ok: true,
  query: "민법",
  results: [
    {
      lawName: "민법",
      lawId: "...",
      mst: "...",
      lawType: "법률",
      effectiveDate: "..."
    }
  ]
}
```

#### POST /api/law/article

Request:

```js
{
  lawName: "민법",
  article: "제750조",
  paragraph: null,
  item: null
}
```

The server normalizes `lawName`, `article`, `paragraph`, and `item` through `lawArticleRef.js` (see §8.6) before any cache lookup or external API call.

Response:

```js
{
  ok: true,
  citation: {
    citationId: "L1",
    sourceType: "law",
    lawName: "민법",
    article: "제750조",
    canonical: "민법/제750조",
    title: "불법행위의 내용",
    effectiveDate: "...",
    url: "..."
  },
  text: "..."
}
```

#### POST /api/law/verify-citations

Request:

```js
{
  text: "민법 제750조와 형법 제9999조에 따르면..."
}
```

Response:

```js
{
  ok: true,
  checked: true,
  passCount: 1,
  failCount: 1,
  results: [
    { citation: "민법 제750조",  canonical: "민법/제750조",  valid: true,  reason: "exists" },
    { citation: "형법 제9999조", canonical: "형법/제9999조", valid: false, reason: "article_not_found" }
  ]
}
```

The `canonical` field uses the normalization defined in §8.6 so the frontend can deduplicate and group results.

## 8. Chat Integration Requirements

### 8.1 Legal intent detection

Add `server/law/lawIntent.js`.

It detects explicit legal prompts using deterministic patterns first.

Initial keyword set:

```text
법령
법률
조문
제\d+조
제\d+조의\d+
시행령
시행규칙
고시
훈령
예규
판례
대법원
헌재
헌법재판소
행정심판
해석례
자치법규
조례
규칙
신구대조표
개정이력
법에서 찾아줘
법령에서 찾아줘
조문 검증
인용 검증
```

Return shape:

```js
{
  isLegalQuery: true,
  mode: "law_article" | "law_search" | "verify_citations" | "legal_research" | "department_legal_review" | "action_plan" | "none",
  extracted: {
    lawName,
    article,        // canonical form per §8.6
    paragraph,
    query
  },
  confidence: 0.0-1.0
}
```

### 8.2 Explicit vs automatic use

For MVP, **explicit activation is the default**. `LAW_AUTO_DETECT=false`.

Legal lookup runs only when:

```text
- prompt contains explicit phrasing such as 법령에서 찾아줘 / 법에서 찾아줘 /
  조문 검증해줘 / 판례 찾아줘
- prompt contains a recognizable lawName + article pattern (e.g., 민법 제750조)
  with high confidence from lawIntent.js
- prompt explicitly asks whether a department-notebook document complies with a law
```

Auto-detect outside these patterns stays disabled until the keyword set has been evaluated against false-positive rates. Post-MVP may flip the default after the intent classifier passes a precision/recall gate.

### 8.3 Prompt construction

When law context exists, inject a separate section into the model prompt:

```text
[공식 법령 근거]
[L1] 민법 제750조 ...
[L2] 개인정보 보호법 제26조 ...

Instructions:
- Use only the provided law context for statute/article claims.
- Do not invent law names, article numbers, paragraphs, items, precedents, or interpretations.
- If the legal context is insufficient, say so explicitly.
- Keep law citations separate from notebook citations.
```

### 8.4 Metadata

Extend response metadata. Current chat metadata includes `notebook`, `citations`, `webSearch`, and `analysisMode`. Add:

```js
law: {
  ok: true,
  query: "민법 제750조",
  mode: "law_article",     // see §13.5; drives disclaimer rendering
  citations: [
    {
      citationId: "L1",
      sourceType: "law",
      lawName: "민법",
      article: "제750조",
      canonical: "민법/제750조",
      title: "불법행위의 내용",
      locator: "민법 제750조",
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

### 8.5 Naver Search precedence in chat orchestrator

See §5.4. The chat orchestrator selects active context source(s) before prompt assembly. When both Korean Law Engine and Naver Search are eligible, both may run and contribute separate citation groups; the law layer always takes precedence for statute-existence claims.

### 8.6 Article reference normalization

`lawArticleRef.js` provides canonical normalization of Korean statute references. It is shared by intent detection, cache keys, citation verification, and KG ingestion.

Input variants that must collapse to the same canonical form:

```text
750
750조
제750조
민법750
민법 제750조
제750조의2
750조의2
제750조2
```

Canonical output:

```text
제750조
제750조의2
```

Function shape:

```js
normalizeArticleRef(input) => {
  raw: "750조의2",
  canonical: "제750조의2",
  articleNumber: 750,
  branchNumber: 2,           // null when no 의N suffix
  joCode: "..."              // when resolvable
}
```

Paragraph (항), item (호), and subitem (목) parsing:

```text
제1항, 1항, ①  → paragraph = 1
제2호, 2호      → item = 2
가목, 가.       → subitem = "가"
```

Circled paragraph numbers (①②③…) must be supported — `korean-law-mcp` documented this case and the parser must keep that behavior.

The combined canonical form for citation IDs:

```text
민법/제750조
민법/제750조의2/제1항
개인정보 보호법/제26조/제2항/제1호/가목
```

Use this canonical form in `cache key`, `verify-citations.results[].canonical`, and KG `Article` node IDs (§11).

## 9. Frontend Requirements

### 9.1 Source panel

Update the citation/source panel to support law citations.

Display grouping:

```text
출처
├─ 부서노트북
│  └─ [N1] ...
├─ 법령
│  └─ [L1] 민법 제750조
└─ 웹
   └─ [W1] ...
```

### 9.2 Law citation detail

Clicking a law citation shows:

```text
법령명
조문
조문 제목 if available
시행일 / 기준일 if available
원문 excerpt
공식 URL if available
```

### 9.3 Citation verification warning

If verification fails, show a visible warning above or inside the source panel:

```text
⚠️ 조문 인용 검증 경고
- 형법 제9999조: 해당 조문을 찾을 수 없습니다.
- 상법 제401조의2 제7항: 해당 항을 찾을 수 없습니다.
```

### 9.4 Disclaimer rendering

When response metadata indicates a disclaimer-required mode (see §13.5), the frontend renders a compact disclaimer below the answer body and above the source panel. The disclaimer is metadata-driven (`law.disclaimer = "short" | "mandatory"`), not LLM-generated, so wording stays consistent across answers.

### 9.5 Optional composer trigger

Do not add a large new UI in MVP. Use chat prompts first.

Later, add a composer menu item:

```text
+ → 법령 검색
```

## 10. Department Notebook + Law Integration

### 10.1 Combined legal review

Support this use case:

```text
선택한 부서노트북의 개인정보 처리 위탁 지침이 개인정보보호법에 맞는지 검토해줘.
```

Expected behavior:

```text
1. run department notebook RAG
2. detect legal review intent (mode = department_legal_review)
3. retrieve official law articles
4. build combined context
5. answer with separated sections and separated citations
```

Answer structure:

```text
1. 내부 문서상 기준
2. 공식 법령 기준
3. 차이점 / 리스크
4. 보완 권고
5. 출처
```

### 10.2 Source separation

Never merge internal notebook evidence and official law evidence into one undifferentiated citation list.

Use separate citation IDs:

```text
[N1] department notebook chunk
[L1] official statute article
```

### 10.3 Disclaimer

`department_legal_review` is a disclaimer-required mode (§13.5). The frontend always shows the short disclaimer for these answers because they involve compliance interpretation.

## 11. Knowledge Graph Integration: Later Phase

This is not MVP. The design **must reuse the existing department notebook KG infrastructure** rather than create a parallel legal graph store.

### 11.1 Reuse existing graph store

Use the existing modules unchanged in concept:

```text
server/rag/graph/ontology.js   — extended ontology only
server/rag/graph/store.js      — same SQLite schema, same store API
server/rag/graph/extractor.js  — extended prompt only
data/notebooks/<id>/graph.sqlite — same per-notebook graph file
```

Do not introduce a separate `data/graphs/law.sqlite` or any parallel store. Legal entities live in the same per-notebook graph as document/concept entities, which lets the existing Studio graph viewer and admin moderation endpoints work without a UI fork.

### 11.2 Add legal entity and relation types

Extend `ontology.js`:

```text
Entity types added:
Law
Article
Precedent
Interpretation
AdminRule
Ordinance
Treaty
LegalTerm

Relation types added:
CITES
INTERPRETED_BY
APPLIED_IN
DELEGATES_TO
AMENDED_BY
CONFLICTS_WITH
RELATED_TO
```

`Article` node identifiers use the canonical form defined in §8.6 (e.g., `민법/제750조`).

### 11.3 Ingest-time legal reference extraction

Extend the extractor prompt in `server/rag/graph/extractor.js`:

```text
- If a statute/article citation appears in the chunk, extract it as a Law/Article entity.
- Use canonical article references (see §8.6).
- If the citation has been verified by Korean Law Engine in this run, set the
  node's verified flag and link the document chunk to the Article node with a
  CITES edge.
- Do not create unverified Article nodes unless explicitly marked unverified.
  Unverified nodes must not appear in chat-time citation lists by default.
```

### 11.4 Query-time law refresh

If a KG path retrieves an `Article` node:

```text
Article node has:
- lawName
- articleCanonical (e.g., 제750조의2)
- lawId or mst when resolvable

At answer time:
- re-fetch official article text through LawApiClient
- cite the [L] source from live retrieval, not the stale graph text
```

This avoids serving pre-amendment text from KG-stored chunk excerpts.

## 12. Advanced Feature Roadmap

### Phase 2: decisions and interpretations

Add:

```text
search_precedents
get_precedent_text
search_interpretations
get_interpretation_text
search_admin_rule
get_admin_rule
search_ordinance
get_ordinance
get_law_system_tree
get_linked_ordinances
```

### Phase 3: impact map

Migrate `impact_map`.

Use cases:

```text
민법 제103조 영향도 분석
개인정보보호법 제26조가 판례/해석례에서 어떻게 쓰이는지 보여줘
```

Output:

```text
- text summary
- graph data for Studio
- optional Mermaid output
```

Studio integration:

```text
Studio
├─ Mind Map
├─ Notebook Knowledge Graph
└─ Law Explorer
```

### Phase 4: time travel and legal diff

Add:

```text
time_travel
compare_old_new
historical law retrieval
```

Use case:

```text
개인정보보호법 2020-01-01과 2025-11-01 차이를 비교해줘.
```

### Phase 5: action plan

Add citizen-style step-by-step guidance, but keep legal-disclaimer behavior.

Use case:

```text
전세금을 못 받았어. 어떻게 해야 해?
```

Response is clearly framed as information, not legal representation. `action_plan` is a mandatory-disclaimer mode (§13.5).

### KG integration (separate post-MVP track)

KG-related work runs as its own track and may overlap with Phases 2–5. See §11 for design and §17 for the dedicated checklist.

## 13. Security and Operations

### 13.1 API key handling

- Store law API key only in server env.
- Never expose key in frontend JS or response metadata.
- Mask key in logs and errors.
- Ensure fetch error messages do not include full query URL with `OC=`.

### 13.2 User-Agent

Preserve the `korean-law-mcp` browser-like User-Agent behavior. The law API may reject Node default User-Agent.

### 13.3 Rate limits

Default per-route limits with concrete numbers (env-overridable, see §6.3):

| Route | Default per minute | Tier | MVP |
|---|---:|---|---|
| `/api/law/search` | 15 | moderate | yes |
| `/api/law/article` | 20 | moderate | yes |
| `/api/law/verify-citations` | 20 | moderate | yes |
| `/api/law/research` (Phase 2) | 8 | strict | no |
| `/api/law/impact-map` (Phase 3) | 4 | strict | no |
| `/api/law/time-travel` (Phase 4) | 4 | strict | no |

MVP enables only `search`, `article`, and `verify-citations`. The others are defined upfront so adding endpoints later does not require new env-var plumbing — just routing.

Use the existing `server/rateLimit.js` patterns. Trusted-proxy keying (`TRUST_PROXY`, `RATE_LIMIT_KEY_HEADER`) applies to law routes the same way it applies to chat/upload.

### 13.4 Failure handling

On external API failure:

```text
- return structured error
- include machine-readable marker if appropriate
- do not pass empty/ambiguous legal context to the LLM
- instruct model not to guess
```

### 13.5 Legal disclaimer

Disclaimer policy is mode-driven and rendered by frontend metadata (see §9.4), not by free-form LLM prose.

| Mode | Use case | Disclaimer |
|---|---|---|
| `law_article` | direct article lookup | none |
| `law_search` | law-name / article search | none |
| `verify_citations` | citation verification | none |
| `legal_research` | interpretation, precedent synthesis, compliance review | short |
| `department_legal_review` | internal-policy vs statute comparison | short |
| `action_plan` (Phase 5) | step-by-step citizen guidance | mandatory |

The short disclaimer is:

```text
이 답변은 공식 법령 정보를 바탕으로 한 일반 정보이며, 구체적 사건의 법률 자문은
전문가 상담이 필요합니다.
```

Avoid attaching it to simple article-lookup answers; over-use erodes its meaning.

### 13.6 External API privacy and logging

Korean law APIs are external services and receive query data on every call. The following rules govern what crosses the boundary and what is recorded:

- Do not forward the full user prompt to the external API. Send only normalized
  fields (canonical lawName, canonical article reference, search query,
  display count).
- The retrieval logger writes a privacy-safe JSONL entry per law call:
  `{ tool, normalizedQuery, latencyMs, resultCount, cacheHit, errorMarker }`.
  No raw user prompt, no `LAW_OC`, no full request URL with `OC=` are written.
- Error messages and stack traces must mask the API key. Validate this with a
  unit test that injects `LAW_OC=SECRET` and asserts the literal does not
  appear anywhere in formatted error output.
- The browser never receives the API key, full upstream URL, or upstream `OC`
  parameter — only the normalized citation payload (lawName, article, title,
  effectiveDate, public URL).

## 14. Testing Requirements

### 14.1 Unit tests

Add tests for:

```text
law intent detection
article number parsing
paragraph/hang number parsing including circled Korean paragraph numbers
canonical article reference round-trip (§8.6)
law citation extraction
NOT_FOUND response handling
API key masking (§13.6)
cache key normalization
cache invalidation on lastModified bump
```

### 14.2 API tests

Add smoke/live tests:

```text
GET /api/law/status
POST /api/law/search with 민법
POST /api/law/article with 민법 제750조
POST /api/law/verify-citations with one valid and one invalid citation
```

Live tests are skipped or marked when `LAW_OC` is not configured.

### 14.3 Chat tests

Add tests for:

```text
법령에서 민법 제750조 찾아줘
조문 검증해줘: 민법 제750조, 형법 제9999조
selected notebook + legal compliance prompt
mixed prompt: news request + statute reference (precedence test, §5.4)
```

### 14.4 Frontend E2E tests

When Playwright is added, include:

```text
- legal prompt creates law source panel
- [L1] citation appears
- verification warning appears for invalid citation
- department notebook source and law source appear separately
- disclaimer renders for legal_research / action_plan, not for law_article
```

## 15. Documentation Requirements

Update:

```text
README.md
.env.example
.env.department.example
deploy/myai.env.example
docs/API.md
docs/RAG.md
docs/SECURITY.md
docs/KNOWN_ISSUES.md
```

Add:

```text
docs/KOREAN_LAW_ENGINE.md
```

`docs/KOREAN_LAW_ENGINE.md` should explain:

```text
- purpose
- environment variables (LAW_OC canonical; KOREAN_LAW_API_KEY compat-only)
- API endpoints
- chat behavior including precedence vs Naver Search (§5.4)
- citation behavior and canonical article references (§8.6)
- verification behavior
- disclaimer policy (§13.5)
- privacy/logging policy (§13.6)
- limitations
- relationship to department notebooks and KG
```

## 16. Migration Notes from korean-law-mcp

### 16.1 Keep

Keep/adapt:

```text
LawApiClient
fetch-with-retry
browser User-Agent workaround
law alias resolution
article parser (including circled paragraph numbers)
citation verifier
NOT_FOUND / HALLUCINATION_DETECTED markers
core search/text/article tools
impact_map logic later
compact decision response helpers later
```

### 16.2 Remove or avoid

Do not bring into myAI MVP:

```text
MCP Server / Transport
stdio mode
HTTP MCP endpoint
CLI commands
setup command
MCP tool registry as runtime dependency
all 90+ tools at once
```

### 16.3 TypeScript handling

Options:

```text
Option A: port selected TS files to JS ESM manually
Option B: add TypeScript build support under server/law
Option C: vendor korean-law-mcp as package dependency, then progressively inline
```

Recommended for myAI:

```text
Phase 1: port selected MVP files to JS ESM
Phase 2: consider TS build only if tool count grows substantially
```

## 17. Implementation Checklist

### MVP checklist

```text
[ ] Create server/law/ module structure (lawApi.js, not lawRouter.js)
[ ] Add law env variables (LAW_OC canonical) to .env.example,
    .env.department.example, deploy/myai.env.example, and README env table
[ ] Port LawApiClient / fetch-with-retry / error helpers
[ ] Implement lawArticleRef.js canonical normalization (§8.6)
[ ] Implement lawCache.js at data/cache/law-cache.sqlite with lastModified-aware
    invalidation
[ ] Implement /api/law/status (with usage / cache-hit shape reserved)
[ ] Implement /api/law/search
[ ] Implement /api/law/article
[ ] Implement /api/law/verify-citations
[ ] Add lawIntent.js with LAW_AUTO_DETECT=false default
[ ] Add lawContextBuilder.js
[ ] Integrate law context into chat prompt construction
[ ] Implement Naver-vs-Law precedence in chat orchestrator (§5.4 / §8.5)
[ ] Extend X-Notebook-Meta with law citations and disclaimer mode
[ ] Render law citations in frontend source panel
[ ] Render citation verification warnings
[ ] Render mode-driven disclaimer (§9.4 / §13.5)
[ ] Wire concrete rate limits per §13.3
[ ] Add API-key masking unit test (§13.6)
[ ] Add smoke/live tests
[ ] Add docs/KOREAN_LAW_ENGINE.md
```

### Phase 2 checklist

```text
[ ] Port precedent search/text tools
[ ] Port interpretation search/text tools
[ ] Port admin rule tools
[ ] Port ordinance tools
[ ] Add legal_research mode
[ ] Add /api/law/research route + rate limit
[ ] Add richer law source panel detail
```

### Phase 3 checklist

```text
[ ] Port impact_map
[ ] Add /api/law/impact-map
[ ] Add Studio Law Explorer MVP
[ ] Add graph payload output for impact map
```

### Phase 4 checklist

```text
[ ] Port old/new comparison and historical law retrieval
[ ] Add /api/law/time-travel or /api/law/compare-time
[ ] Add legal diff UI
```

### Phase 5 checklist

```text
[ ] Add action_plan mode with mandatory disclaimer (§13.5)
[ ] Add structured-step output template
[ ] Add scenario tests for non-legal-advice framing
```

### KG integration checklist (separate post-MVP track)

```text
[ ] Extend server/rag/graph/ontology.js with Law/Article/Precedent/... entity
    types and CITES/INTERPRETED_BY/... relation types
[ ] Extend server/rag/graph/extractor.js prompt to extract verified legal
    citations as Law/Article entities with canonical IDs
[ ] Use existing graph.sqlite per notebook — no parallel legal graph store
[ ] Add CITES edges from document chunks to legal Article nodes
[ ] Add query-time law refresh that re-fetches article text via LawApiClient
    when an Article node is in the retrieval path
```

## 18. Acceptance Criteria

MVP is complete when all functional and non-functional criteria are true.

### 18.1 Functional

```text
1.  LAW_OC configured server can search a Korean law by name.
2.  myAI can retrieve a specific statute article such as 민법 제750조.
3.  Chat prompt "법령에서 민법 제750조 찾아줘" produces an answer grounded in
    retrieved law text.
4.  The answer includes law citation metadata and frontend displays [L1].
5.  Citation verification detects at least one valid and one invalid citation
    in a sample text.
6.  When a law article is not found, the assistant does not invent the article.
7.  Department notebook + legal review prompt keeps notebook citations and law
    citations separate.
8.  API keys are not exposed in frontend responses or logs.
9.  Tests pass with law live tests skipped when LAW_OC is absent.
10. Documentation explains setup and limitations.
```

### 18.2 Non-functional

```text
11. With LAW_OC unset, /api/law/* returns a structured 503 / disabled response,
    and /api/chat continues to work for non-legal prompts.
12. On external-API 5xx or timeout, response metadata carries [LAW_API_ERROR]
    and the assistant does not guess article content.
13. Identical lawName + canonical-article requests within TTL hit the cache and
    do not re-call the external API. A test hook or /api/law/status counter
    confirms cache hit.
14. Article-text cache rows include the source's lastModified marker; a manifest
    showing a newer revision invalidates the cached body before serve.
15. The literal value of LAW_OC never appears in error output, retrieval log
    entries, or response bodies (verified by unit test).
```

## 19. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Law API instability | Legal lookup fails | structured errors, cache, no guessing |
| API key leakage | security issue | mask URLs, server-only env, masking unit test |
| LLM invents legal content | trust issue | strict prompt, citation verification, NOT_FOUND markers |
| Too much code imported at once | maintainability issue | MVP subset first |
| TypeScript/JS mismatch | build complexity | port selected modules to JS ESM first |
| Legal and notebook evidence mixed | confusing answer | separate source groups and citation IDs |
| Slow impact map/time travel | latency | keep advanced features out of MVP, strict rate limits |
| Cached pre-amendment text served as current | trust issue | lastModified-aware cache invalidation (§6.4 / §18.2) |
| Auto-detect false positives derail ordinary chat | UX degradation | LAW_AUTO_DETECT=false default until precision is measured |

## 20. Recommended First Task for Implementing AI

Start with this exact sequence:

```text
1.  Read this PRD.
2.  Inspect current myAI chat metadata construction (server/index.js
    /api/chat handler, X-Notebook-Meta build path).
3.  Inspect current frontend citation/source panel rendering
    (public/answerRenderer.js, public/modules/chat.js, public/styles.css
    source panel rules).
4.  Inspect korean-law-mcp LawApiClient, fetch-with-retry, search_law,
    get_law_text, get_article_detail, verify_citations, and the article-code
    parser — these are the MVP migration units.
5.  Create server/law/ with config, client, error helpers, lawArticleRef.js
    (canonical normalization), and the four MVP tools.
6.  Add /api/law/status, /api/law/search, /api/law/article,
    /api/law/verify-citations.
7.  Add unit and smoke tests for those endpoints, including API-key masking
    and cache-hit verification.
8.  Integrate law context into /api/chat, including Naver-vs-Law precedence
    (§5.4 / §8.5).
9.  Extend response metadata (X-Notebook-Meta) with law citations and the
    disclaimer mode field.
10. Update frontend source panel rendering and disclaimer display.
```

Do not start by porting every korean-law-mcp tool. Build the smallest reliable legal grounding layer first.
