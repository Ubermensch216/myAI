# PRD: Korean Law Engine Integration

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

The Korean law feature must be added as a new grounding source, not as a replacement for existing RAG.

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

Korean law context should be a new source type:

```text
sourceType = "law"
```

It should sit beside existing source types:

```text
notebook citations -> [N1], [N2]
web citations      -> [W1], [W2]
law citations      -> [L1], [L2]
```

### 5.2 Law search is not normal web search

Current myAI intentionally skips Naver Search when uploaded documents or a department notebook is active. That policy should stay.

Korean Law Engine is different. It should be allowed to combine with department notebooks and uploaded documents when the user explicitly asks for a legal check.

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

## 6. Proposed Architecture

### 6.1 New server module layout

Add native modules under `server/law/`:

```text
server/law/
  lawConfig.js
  lawApiClient.js
  lawRouter.js
  lawIntent.js
  lawContextBuilder.js
  lawCitationFormatter.js
  lawCitationVerifier.js
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

Add these variables to `.env.example`, `deploy/myai.env.example`, and README configuration tables:

```env
LAW_API_ENABLED=true
LAW_OC=
KOREAN_LAW_API_KEY=
LAW_USER_AGENT=Mozilla/5.0 (compatible; myAI Korean Law Engine)
LAW_TIMEOUT_MS=8000
LAW_MAX_RESULTS=8
LAW_CONTEXT_BUDGET=10000
LAW_CACHE_ENABLED=true
LAW_CACHE_TTL_MS=86400000
LAW_CACHE_MAX_ENTRIES=1000
LAW_AUTO_DETECT=true
LAW_VERIFY_CITATIONS=true
LAW_IMPACT_MAP_ENABLED=false
```

Rules:

- `LAW_OC` and `KOREAN_LAW_API_KEY` are aliases. Prefer `LAW_OC` if both are set.
- Legal API keys are server-side only.
- Never send the law API key to the browser.
- Mask API keys in logs and errors.

### 6.4 Caching

Add a simple cache layer.

Initial implementation may use an in-memory LRU, but the preferred next step is SQLite:

```text
data/indexes/law-cache.sqlite
```

Suggested cache key:

```text
toolName + normalizedInput + effectiveDate
```

Suggested TTLs:

```text
law search results: 1 day
law article/text:   7 days
precedent/decision: 7 days
verification:       1 day
impact map:         1 day
```

## 7. MVP Scope

The MVP should be called:

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
article number / paragraph parser
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
  cache: { enabled: true },
  api: { provider: "law.go.kr" }
}
```

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

Response:

```js
{
  ok: true,
  citation: {
    citationId: "L1",
    sourceType: "law",
    lawName: "민법",
    article: "제750조",
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
    { citation: "민법 제750조", valid: true, reason: "exists" },
    { citation: "형법 제9999조", valid: false, reason: "article_not_found" }
  ]
}
```

## 8. Chat Integration Requirements

### 8.1 Legal intent detection

Add `server/law/lawIntent.js`.

It should detect explicit legal prompts using deterministic patterns first.

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
  mode: "law_article" | "law_search" | "verify_citations" | "legal_research" | "none",
  extracted: {
    lawName,
    article,
    paragraph,
    query
  },
  confidence: 0.0-1.0
}
```

### 8.2 Explicit vs automatic use

For MVP, prefer explicit activation.

Legal lookup should run when:

```text
- user explicitly says 법령에서 찾아줘 / 법에서 찾아줘 / 조문 검증해줘 / 판례 찾아줘
- prompt contains recognizable law name + article pattern
- prompt asks whether a department notebook document complies with a law
```

Avoid surprising law lookups for ordinary conversation.

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

Extend response metadata.

Current chat metadata includes notebook, citations, webSearch, and analysisMode. Add:

```js
law: {
  ok: true,
  query: "민법 제750조",
  citations: [
    {
      citationId: "L1",
      sourceType: "law",
      lawName: "민법",
      article: "제750조",
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
  error: ""
}
```

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

Clicking a law citation should show:

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

### 9.4 Optional composer trigger

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
2. detect legal review intent
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

## 11. Knowledge Graph Integration: Later Phase

This is not MVP, but the design should allow it.

### 11.1 Add legal node types to notebook KG

Potential entity types:

```text
Law
Article
Precedent
Interpretation
AdminRule
Ordinance
Treaty
LegalTerm
```

Potential relation types:

```text
CITES
BASED_ON
INTERPRETED_BY
APPLIED_IN
DELEGATES_TO
AMENDED_BY
CONFLICTS_WITH
RELATED_TO
```

### 11.2 Ingest-time legal reference extraction

During department notebook ingest or KG rebuild:

```text
chunk text
-> extract statute/article references
-> verify citations through Korean Law Engine
-> create Law/Article nodes
-> link document chunk to Article node with CITES edge
```

### 11.3 Query-time law refresh

If KG contains a Law/Article node, do not rely on stale stored text for final legal claims.

At answer time:

```text
KG Article node found
-> fetch current official law text if needed
-> cite fresh law source
```

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

Response must be clearly framed as information, not legal representation.

## 13. Security and Operations

### 13.1 API key handling

- Store law API key only in server env.
- Never expose key in frontend JS or response metadata.
- Mask key in logs and errors.
- Ensure fetch error messages do not include full query URL with `OC=`.

### 13.2 User-Agent

Preserve the `korean-law-mcp` browser-like User-Agent behavior. The law API may reject Node default User-Agent.

### 13.3 Rate limits

Add route-specific limits:

```text
/api/law/search:            moderate
/api/law/article:           moderate
/api/law/verify-citations:  moderate
/api/law/impact-map:        strict
/api/law/time-travel:       strict
```

Use existing myAI `rateLimit.js` patterns.

### 13.4 Failure handling

On external API failure:

```text
- return structured error
- include machine-readable marker if appropriate
- do not pass empty/ambiguous legal context to the LLM
- instruct model not to guess
```

### 13.5 Legal disclaimer

For legal-information answers, add a concise disclaimer only when appropriate:

```text
이 답변은 공식 법령 정보를 바탕으로 한 일반 정보이며, 구체적 사건의 법률 자문은 전문가 상담이 필요합니다.
```

Do not overuse the disclaimer for simple article lookup answers.

## 14. Testing Requirements

### 14.1 Unit tests

Add tests for:

```text
law intent detection
article number parsing
paragraph/hang number parsing including circled Korean paragraph numbers
law citation extraction
NOT_FOUND response handling
API key masking
cache key normalization
```

### 14.2 API tests

Add smoke/live tests:

```text
GET /api/law/status
POST /api/law/search with 민법
POST /api/law/article with 민법 제750조
POST /api/law/verify-citations with one valid and one invalid citation
```

Live tests should be skipped or marked when `LAW_OC` is not configured.

### 14.3 Chat tests

Add tests for:

```text
법령에서 민법 제750조 찾아줘
조문 검증해줘: 민법 제750조, 형법 제9999조
selected notebook + legal compliance prompt
```

### 14.4 Frontend E2E tests

When Playwright is added, include:

```text
- legal prompt creates law source panel
- [L1] citation appears
- verification warning appears for invalid citation
- department notebook source and law source appear separately
```

## 15. Documentation Requirements

Update:

```text
README.md
.env.example
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
- environment variables
- API endpoints
- chat behavior
- citation behavior
- verification behavior
- limitations
- legal disclaimer policy
- relationship to Naver Search
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
article parser
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
[ ] Create server/law/ module structure
[ ] Add law env variables to examples and docs
[ ] Port LawApiClient/fetch-with-retry/error helpers
[ ] Implement /api/law/status
[ ] Implement /api/law/search
[ ] Implement /api/law/article
[ ] Implement /api/law/verify-citations
[ ] Add law intent detection
[ ] Add law context builder
[ ] Integrate law context into chat prompt construction
[ ] Extend response metadata with law citations
[ ] Render law citations in frontend source panel
[ ] Render citation verification warnings
[ ] Add smoke/live tests
[ ] Add docs/KOREAN_LAW_ENGINE.md
```

### Phase 2 checklist

```text
[ ] Port precedent search/text tools
[ ] Port interpretation search/text tools
[ ] Port admin rule tools
[ ] Port ordinance tools
[ ] Add legal research mode
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
[ ] Extract law citations from department notebook chunks
[ ] Add Law/Article nodes to notebook KG
[ ] Add CITES edges from document chunks to legal nodes
[ ] Add query-time law refresh for KG legal nodes
```

## 18. Acceptance Criteria

MVP is complete when all are true:

```text
1. LAW_OC configured server can search a Korean law by name.
2. myAI can retrieve a specific statute article such as 민법 제750조.
3. Chat prompt "법령에서 민법 제750조 찾아줘" produces an answer grounded in retrieved law text.
4. The answer includes law citation metadata and frontend displays [L1].
5. Citation verification detects at least one valid and one invalid citation in a sample text.
6. When a law article is not found, the assistant does not invent the article.
7. Department notebook + legal review prompt keeps notebook citations and law citations separate.
8. API keys are not exposed in frontend responses or logs.
9. Tests pass with law live tests skipped when LAW_OC is absent.
10. Documentation explains setup and limitations.
```

## 19. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Law API instability | Legal lookup fails | structured errors, cache, no guessing |
| API key leakage | security issue | mask URLs, server-only env, tests |
| LLM invents legal content | trust issue | strict prompt, citation verification, NOT_FOUND markers |
| Too much code imported at once | maintainability issue | MVP subset first |
| TypeScript/JS mismatch | build complexity | port selected modules to JS ESM first |
| Legal and notebook evidence mixed | confusing answer | separate source groups and citation IDs |
| Slow impact map/time travel | latency | keep advanced features out of MVP, strict rate limits |

## 20. Recommended First Task for Implementing AI

Start with this exact sequence:

```text
1. Read this PRD.
2. Inspect current myAI chat metadata and source panel handling.
3. Inspect korean-law-mcp LawApiClient, fetch-with-retry, search_law, get_law_text, get_article_detail, verify_citations.
4. Create server/law/ with config, client, error helpers, and MVP tools.
5. Add /api/law/status, /api/law/search, /api/law/article, /api/law/verify-citations.
6. Add tests for those endpoints.
7. Only after API works, integrate law context into /api/chat.
8. Only after chat metadata works, update frontend source panel.
```

Do not start by porting every korean-law-mcp tool. Build the smallest reliable legal grounding layer first.
