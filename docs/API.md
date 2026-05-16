# API

All endpoints are served by `server/index.js`.

## Status

### `GET /api/status`

Returns Ollama connectivity, model names, department RAG backend health, Naver
Search and Korean Law Engine configuration status, model queue depths, and
rate-limit settings.

Example shape:

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["bge-m3:latest", "gemma4:e2b"],
  "rag": {
    "department": {
      "backend": { "vector": "qdrant", "lexical": "sqlite" },
      "qdrant": { "configured": true, "ok": true, "collection": "myai_notebook_chunks" },
      "sqlite": { "configured": true, "ok": true, "path": "data/indexes/department-rag.sqlite" }
    }
  },
  "search": {
    "naver": { "enabled": true, "configured": true },
    "law": { "enabled": true, "configured": true }
  },
  "queues": {
    "embedding": { "concurrency": 2, "running": 0, "queued": 0 },
    "mapReduce": { "concurrency": 2, "running": 0, "queued": 0 },
    "analysis": { "concurrency": 2, "running": 0, "queued": 0 }
  },
  "rateLimits": {
    "chat": { "max": 20, "windowMs": 60000 },
    "visualize": { "max": 10, "windowMs": 60000 },
    "upload": { "max": 8, "windowMs": 60000 },
    "lightweight": { "max": 30, "windowMs": 60000 },
    "adminWrite": { "max": 10, "windowMs": 60000 }
  }
}
```

Qdrant health is reported as degraded metadata only. A Qdrant outage does not
make `/api/status` fail when Ollama itself is reachable. After changing `.env`,
restart the Node process so status reflects the new values.

## Admin RAG Status

### `GET /api/admin/rag/status`

Admin-oriented status for department RAG health, queue depths, configured rate
limits, and model names.

## Documents

### `POST /api/upload`

Multipart upload field: `file`.

Optional header: `X-MyAI-Document-Key`.

Returns a parsed document payload for encrypted browser persistence. Normal
documents include best-effort `summary` and `topics`. The same document key
scopes the short-lived runtime cache used by `GET` and `DELETE
/api/documents/:id`.

### `GET /api/documents`

Disabled. Runtime personal-document cache entries are not listable.

### `GET /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Returns a
runtime server-memory copy if it is still cached.

### `DELETE /api/documents/:id`

Requires the same `X-MyAI-Document-Key` that uploaded the file. Deletes the
runtime server-memory copy only.

## Chat

### `POST /api/chat`

Body:

```js
{
  model,
  messages,
  documents,
  personalization,
  notebookId,      // optional
  mode,            // optional; "map_reduce" activates Precision Analysis / Map-Reduce
  lawSearchMode    // optional; true => Korea Law Engine only, documents/notebook/web excluded
}
```

Streams plain text from Ollama.

When `NAVER_SEARCH_ENABLED=true` and `NAVER_SEARCH_CLIENT_ID` /
`NAVER_SEARCH_CLIENT_SECRET` are configured, explicit web-search prompts such
as "네이버에서 ... 검색해줘", "최신 뉴스 찾아줘", or "웹에서 조회해줘" cause
the server to call Naver Search before streaming. Normalized search results are
added to model context and may be cited as `[W1]`, `[W2]`, etc.

Naver Search is intentionally skipped when uploaded files are included in the
chat payload or when `notebookId` is selected. Those paths must stay grounded in
the uploaded file context or department notebook RAG context.

When `LAW_API_ENABLED=true` and `LAW_OC` is configured, explicit legal prompts
add official Korea Law Engine context across these modes: `law_article`,
`law_search`, `verify_citations`, `legal_research` (precedents / 해석례 /
admin rules / ordinances), `department_legal_review`, and `action_plan`
(structured 5-step response template with mandatory non-legal-advice
disclaimer; gated on statute citation or law-name + article). Law citations
use `[L1]`, `[L2]`, etc. and stay separate from notebook `[N]` and web `[W]`
citations. If official law lookup fails, chat metadata carries a law error
marker and the assistant must not invent statute text. Current Korea Law Engine
coverage also includes annexes, delegated-law and ordinance links,
Constitutional Court decisions, and administrative-appeal decisions. Decision
citations use `[D1]`, `[D2]`, etc. and remain separate from statute `[L]`,
notebook `[N]`, and web `[W]` citations.

When `lawSearchMode: true` is sent from the composer "법령 검색" mode, the
server forces Korea Law Engine grounding only. Uploaded documents, department
notebook RAG, and Naver Search are excluded from that answer path.

When a department notebook is selected and its knowledge graph surfaces
matched `Article` nodes, the chat orchestration re-fetches each article via
`LawApiClient` and merges them as additional `[L]` citations (mode
`kg_articles` when no explicit legal intent fired; otherwise merged into the
explicit context via `mergeLawContexts`). KG-derived citations carry
`kgDerived: true` and surface in `X-Notebook-Meta.law.kgArticlesMerged`.

If notebook, web-search, or analysis metadata exists, the response includes
`X-Notebook-Meta` as base64 JSON:

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ],
  webSearch: {
    ok,
    query,
    error,
    citations: [
      { citationId, documentName, documentType, locator, url, sourceName }
    ]
  },
  law: {
    ok,
    query,
    mode,                  // law_article | law_search | law_topic_search |
                           // verify_citations | legal_research |
                           // department_legal_review | action_plan |
                           // kg_articles
    error,
    errorMessage,
    disclaimer,            // null | "short" | "mandatory"
    citations: [
      { citationId, sourceType, lawName, article, canonical, title, locator,
        effectiveDate, url, excerpt?, kgDerived?, recordType? }
    ],
    verification: { checked, failCount, results },
    kgArticlesMerged       // count of KG-discovered articles merged as [L]
  },
  compliance: {            // present only when intent === department_legal_review
    ok,
    mode: "department_legal_review",
    reviewType,            // compliance review type selected by server/compliance/complianceTypes.js
    outputStyle,           // "summary" | "detailed_report"
    title,
    disclaimer: "short",
    evidenceFamilies,      // subset of ["notebook","uploaded_document","law",
                           //            "precedent","interpretation",
                           //            "admin_rule","ordinance"]
    error                  // "" | "NO_INTERNAL_MATERIAL" | "LAW_NOT_CONFIGURED"
  } | null,
  analysisMode: "map_reduce" // or null
}
```

The frontend groups notebook, law, and Naver web citations in one source panel.
If the assistant answer is a no-evidence response, such as "관련 정보를
찾을 수 없습니다", the frontend suppresses both the source panel and follow-up
suggestions for that answer.

## Korean Law Engine

### `GET /api/law/status`

Returns enabled/configured state, cache health, provider, and reserved usage
counters. With `LAW_OC` unset, returns structured `503` with `ok: false`.

### `POST /api/law/search`

Body:

```js
{ query: "민법", display: 10 }
```

Searches official Korean law names.

### `GET /api/law/tools`

Lists the MCP-compatible Korean Law Engine tool names exposed by myAI. Query
parameters `q`/`query` and `category` filter the list.

### `POST /api/law/execute`

Body:

```js
{ toolName: "search_all", params: { query: "전세금 못 받았어" } }
```

Executes the native myAI equivalent of common `korean-law-mcp` tool names,
including `search_law`, `search_ai_law`, `search_all`, `get_law_text`,
`verify_citations`, `search_annexes`, `get_annexes`, `get_three_tier`,
`get_delegated_laws`, linked-ordinance tools, `search_decisions`,
`get_decision_text`, `impact_map`, `time_travel`, `action_plan`,
`chain_full_research`, and `chain_amendment_track`. It is a compatibility
surface over native handlers, not an external MCP server.

### `POST /api/law/ai-search`

Body:

```js
{ query: "전세보증금 반환", searchType: 0, display: 5 }
```

Runs law.go.kr `aiSearch` semantic search for natural-language article
matches. `searchType: 0` searches statute articles; `searchType: 2` searches
administrative-rule article content.

### `POST /api/law/research`

Body:

```js
{ query: "전세금 못 받았어" }
```

Natural-language topic research. The engine searches semantic law articles,
law names, administrative rules, precedents, legal interpretations, local
ordinances, annexes, law-structure links, and requested decision families in
parallel, then returns official-source context and citation metadata for chat
or API callers.

### `POST /api/law/action-plan`

Body:

```js
{ query: "전세금 못 받았어" }
```

Builds an evidence-grounded `action_plan` context. If `lawName` + `article`
are supplied, it uses that official article directly. Otherwise it performs
topic research first and appends the 5-step action-plan response template only
when official source candidates were found.

### `POST /api/law/article`

Body:

```js
{ lawName: "민법", article: "제750조" }
```

Normalizes the article reference, resolves the law, and returns official
article text plus `[L]` citation metadata.

### `POST /api/law/verify-citations`

Body:

```js
{ text: "민법 제750조와 형법 제9999조를 검증해줘." }
```

Extracts Korean statute/article citations and verifies them against official
law data.

### `POST /api/law/precedents/search`

Body:

```js
{ query: "불법행위 손해배상", display: 5, court: "", caseType: "" }
```

Searches official precedent records. Results expose normalized public fields
such as `precId`, title, case number, court, date, and case type.

### `POST /api/law/precedents/detail`

Body:

```js
{ precId: "230001" }
```

Returns precedent text plus `law_precedent` citation metadata. `caseNumber` may
be supplied when the caller does not already have `precId`.

### `POST /api/law/interpretations/search`

Body:

```js
{ query: "개인정보", display: 5, agency: "" }
```

Searches official legal interpretation records. Results expose `expcId`, title,
agency, and date.

### `POST /api/law/interpretations/detail`

Body:

```js
{ expcId: "EXPC-2023-0099" }
```

Returns legal interpretation text plus `law_interpretation` citation metadata.
`query` may be supplied when the caller does not already have `expcId`.

### `POST /api/law/admin-rules/search`

Body:

```js
{ query: "개인정보 안전성 확보조치", display: 5, agency: "" }
```

Searches official admin-rule records. Results expose `admrulId`, title, agency,
kind, issue date, and effective date.

### `POST /api/law/admin-rules/detail`

Body:

```js
{ admrulId: "ADM-2024-0001" }
```

Returns admin-rule text plus `law_admin_rule` citation metadata. `query` may be
supplied when the caller does not already have `admrulId`.

### `POST /api/law/ordinances/search`

Body:

```js
{ query: "서울특별시 주차장 조례", display: 5, region: "서울특별시" }
```

Searches official ordinance records. Results expose `ordinId`, title, region,
kind, promulgation date, and effective date.

### `POST /api/law/ordinances/detail`

Body:

```js
{ ordinId: "ORD-SEOUL-12345" }
```

Returns ordinance text plus `law_ordinance` citation metadata. `query` may be
supplied when the caller does not already have `ordinId`.

### `POST /api/law/annexes/search`

Body:

```js
{ lawName: "개인정보 보호법", query: "서식", display: 5 }
```

Searches official law.go.kr annex, table, and form records and returns
normalized annex identifiers, title, type, and source-law metadata.

### `POST /api/law/annexes/detail`

Body:

```js
{ annexId: "ANNEX-12345" }
```

Returns the official annex/table/form text plus law citation metadata.
`lawName` and `query` may be supplied when the caller does not already have an
annex identifier.

### `POST /api/law/three-tier`

Body:

```js
{ lawName: "개인정보 보호법", article: "제15조" }
```

Returns statute, enforcement-decree, and enforcement-rule structure around the
requested law or article when official linked records are available.

### `POST /api/law/delegated-laws`

Body:

```js
{ lawName: "개인정보 보호법", article: "제15조" }
```

Finds delegated or subordinate laws linked from the requested statute/article.

### `POST /api/law/linked-ordinances`

Body:

```js
{ lawName: "개인정보 보호법", article: "제15조", region: "서울특별시" }
```

Finds local ordinances linked to the requested statute/article.

### `POST /api/law/linked-ordinance-articles`

Body:

```js
{ ordinId: "ORD-SEOUL-12345", article: "제3조" }
```

Returns ordinance article links and metadata for the selected local ordinance.

### `POST /api/law/linked-laws-from-ordinance`

Body:

```js
{ ordinId: "ORD-SEOUL-12345" }
```

Finds national laws referenced by the selected local ordinance.

### `POST /api/law/decisions/search`

Body:

```js
{ query: "개인정보 침해", category: "constitutional", display: 5 }
```

Searches official decision records. `category` supports Constitutional Court
decisions and administrative-appeal decisions; chat intent selects the category
from prompts such as "헌법재판소 결정례" or "행정심판 재결례".

Administrative appeals use the documented hub API when
`HAENGJIM_API_PROVIDER=hub` or `HAENGJIM_API_URL` is configured; otherwise the
engine uses law.go.kr `target=decc`. If the hub request fails and `LAW_OC` is
available, it falls back to law.go.kr. Constitutional Court requests use
`HUNZAE_API_KEY` or the shared `DECISIONS_API_KEY`.

### `POST /api/law/decisions/detail`

Body:

```js
{ decisionId: "2020헌마123", category: "constitutional" }
```

Returns decision text plus `decision_constitutional` or `decision_haengjim`
citation metadata. `query` may be supplied when the caller does not already
have a decision identifier.

### `POST /api/law/impact-map`

Body:

```js
{ lawName: "개인정보 보호법", article: "제15조", subject: "회원가입 양식", materialText: "optional excerpt" }
```

Fetches the official statute article and returns a deterministic impact-map
graph with law citation metadata, nodes, edges, groups, and warnings. This is
the backend used by Studio Law Explorer.

### `POST /api/law/article/at`

Body:

```js
{ lawName: "민법", article: "제750조", effectiveDate: "2012-03-04" }
```

Returns the official article body as it stood on the requested 시행일자.
Internally switches the upstream call to `target=eflawjosub` + `efYd=YYYYMMDD`.
Accepts `YYYY-MM-DD`, `YYYYMMDD`, `YYYY/MM/DD`, or `YYYY.MM.DD`; invalid dates
return 400. Snapshots are immutable (30-day cache TTL). Uses the
`law_time_travel` rate-limit bucket. Response carries `effectiveDate` (the
requested date) and `snapshotEffectiveDate` (the actual snapshot date
law.go.kr returned).

### `POST /api/law/time-travel`

Body:

```js
{ query: "개인정보 보호법", fromDate: "2020-01-01", toDate: "2025-11-01" }
```

MCP-style wrapper for date comparison. With an `article`/`jo` value it returns
the article-level diff. Without an article, it resolves historical full-law
snapshots, fetches official full-law text for both dates, and returns a
deterministic line diff. Large full-law diffs may be capped with
`warnings: ["full_law_diff_truncated"]`.

### `POST /api/law/article/diff`

Body:

```js
{ lawName: "개인정보 보호법", article: "제15조", fromDate: "2012-03-04", toDate: "2023-09-15" }
```

Fetches the article at both effective dates and returns a deterministic
LCS-based line diff. Adjacent removed+added pairs with bigram-Jaccard
similarity ≥ 0.5 collapse into a single `modified` hunk. Response includes
`from`/`to` blocks (citation + text + snapshotEffectiveDate + cacheHit) and a
`diff` object with `hunks` (`unchanged`/`added`/`removed`/`modified`) plus
`stats`. Both dates must validate and must differ. Uses `law_time_travel`
bucket. Pure structural diff — no model inference.

### `POST /api/law/history`

Body:

```js
{ lawName: "민법" }
```

Lists 시행일별 개정 이력 (`lawName`, `lawId`, or `mst` accepted). Calls
upstream with `target=lsHstInq` (override via `LAW_HISTORY_TARGET`) and
returns a `revisions` array sorted newest-first. Each entry: `{ effectiveDate,
promulgationDate, mst, promulgationNumber, revisionType, title }`. Two
revision dates from this response feed `/api/law/article/diff`. Cached 7 days.
Uses `law_time_travel` bucket.

All `/api/law/*` public responses must omit upstream `raw` payloads, upstream
service URLs, and `OC=` query values.

## Answer Export

### `GET /api/export/formats`

Returns the answer-download formats exposed by the frontend message action
menu: `md`, `xlsx`, `pdf`, `hwpx`, and `docx`.

### `POST /api/export`

Body:

```js
{
  format,  // "md" | "xlsx" | "pdf" | "hwpx" | "docx"
  title,
  content
}
```

Returns a downloadable file with `Content-Disposition: attachment`. The
frontend sends the already-rendered assistant answer text from the message
action menu. `.doc` is intentionally not supported; Word export uses `.docx`.
PDF export embeds a Korean-capable server font when one is available.

## Source Workflow

### `POST /api/source-workflow/from-answer`

Body:

```js
{
  messageId: "msg_123",
  title: "검토 보고서",
  answerMarkdown: "...",
  format: "md", // "md" | "pdf" | "docx" | "hwpx"
  metadata: {
    notebook: {},
    law: {},
    compliance: {},
    webSearch: {},
    citations: []
  }
}
```

Converts an assistant answer into a document-like room source payload. The
server reuses `server/exportFiles.js` for file generation and returns:

```js
{
  ok: true,
  generatedSource: {
    id: "generated_doc_...",
    kind: "document",
    fileName: "검토 보고서.docx",
    fileType: "docx",
    mimeType: "...",
    text: "...",
    textLength: 1234,
    preview: "...",
    origin: "assistant_answer",
    sourceMessageId: "msg_123",
    generatedBy: "assistant",
    generatedAt: "2026-05-14T00:00:00.000Z",
    trustLevel: "generated",
    sourceTrust: 0.5,
    labels: ["AI 생성", "검증 필요"],
    citations: [],
    sourceMetadata: {
      notebook: null,
      law: null,
      compliance: null,
      webSearch: null
    },
    dataBase64: ""
  }
}
```

The frontend stores the returned object in `room.documents` and persists it in
encrypted IndexedDB with the current room. The endpoint does not automatically
promote generated sources into department notebooks and does not create
server-side permanent personal storage. Department notebook promotion is a
separate admin-reviewed workflow. `dataBase64` is present only when the
generated binary is no larger than `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES`;
`text` remains the analysis source either way.

### `POST /api/source-workflow/source-guide`

Body:

```js
{
  title: "감사자료 소스 가이드",
  documents: [/* current room document payloads */],
  notebookId: "nb_...", // optional selected department notebook
  model: "gemma4:e2b"
}
```

Builds a NotebookLM-style source guide from uploaded room documents and/or the
selected department notebook. If `notebookId` is provided and Department
Notebook Access Control is active, the request must include the normal notebook
read token unless it is an admin request.

Response:

```js
{
  ok: true,
  guide: {
    id: "source_guide_...",
    kind: "source_guide",
    title: "...",
    summary: "...",
    keyIssues: [],
    relatedLaws: [],
    recommendedQuestions: [],
    possibleOutputs: [],
    markdown: "...",
    sourceScope: {
      documentCount: 2,
      notebook: { id: "nb_...", name: "..." }
    },
    warnings: [],
    createdAt: "2026-05-16T00:00:00.000Z"
  }
}
```

The browser stores the guide as a room-level Studio output under
`room.studio.outputs`; it can later be reopened as a Studio draft, added back to
the room as a generated source, or submitted for notebook-promotion review.

### `POST /api/source-workflow/promotions`

Body:

```js
{
  notebookId: "nb_...",
  title: "검토의견서",
  markdown: "...",
  summary: "...",
  sourceType: "studio_output",
  sourceRoomId: "room_...",
  sourceMessageId: "msg_...",
  sourceOutputId: "studio_output_...",
  generatedAt: "2026-05-16T00:00:00.000Z",
  citations: [],
  metadata: {}
}
```

Creates a pending department-notebook promotion request for an AI-generated
Studio output. The request is stored server-side under
`data/source-promotions/promotions.json`. It does not modify the target notebook
until an admin approves it.

If Department Notebook Access Control is active, non-admin users must have read
access to the target notebook to submit a request.

### `GET /api/admin/source-promotions`

Admin-only. Lists pending and reviewed promotion requests without returning the
full markdown body.

### `PATCH /api/admin/source-promotions/:id`

Admin-only. Body:

```js
{
  status: "approved", // or "rejected"
  reviewNote: "...",
  approvedBy: "admin"
}
```

Approving a request ingests the reviewed generated output into the target
department notebook as a Markdown document with provenance metadata. Rejected
requests remain in the promotion store for audit context.

## Studio

### `GET /api/studio/document/templates`

Returns the list of built-in document templates.

### `POST /api/studio/document/from-answer`

Body:

```js
{
  title: "...",
  answerMarkdown: "...",
  templateId: "review_report",
  template: {},
  metadata: {},
  model: "gemma4:e2b"
}
```

Converts an AI answer into a template-structured JSON document draft using Ollama.

### `POST /api/studio/document/export`

Body:

```js
{
  format: "docx",
  document: { title: "...", blocks: [], citations: {} },
  options: { includeCitations: true }
}
```

Exports the edited Studio document model as a binary file (HWPX, DOCX, PDF, or MD).

### `POST /api/studio/mindmap`

Body:

```js
{
  model,
  documents
}
```

Builds a NotebookLM-style hierarchical mind-map graph from the current room's
uploaded documents. The frontend sends the same browser-persisted document
payload used by chat.

The server evenly samples chunks across the full document and asks Ollama for a
parent-based hierarchy with one root, several major branches, and compact leaf
nodes. The internal `parentId` hierarchy is normalized into the stable public
`nodes` + `edges` response shape.

Web search and department notebook RAG are not used in this flow.

Returns:

```js
{
  mindmap: {
    title,
    generatedAt,
    documentCount,
    groups: [{ id, label }],
    nodes: [{ id, label, summary, group, importance, sourceRefs }],
    edges: [{ from, to, label, strength }],
    warnings: []
  }
}
```

If Ollama fails after documents are supplied, the server returns a deterministic
fallback graph derived from document titles, headings, phases, bullets, topics,
and high-signal PRD terms. Requests without text-bearing uploaded documents
return `400`.

### `GET /api/studio/graph/ontology`

Returns the notebook knowledge-graph ontology used by the Studio graph viewer:
entity types, relation types, and display metadata.

### `GET /api/studio/graph/notebooks`

Returns department notebooks that both have a built knowledge graph and are
visible to the current user. When Department Notebook Access Control is active,
the caller must include a valid notebook-read access token.

### `GET /api/studio/graph/:notebookId/stats`

Returns graph counts and ontology version for an accessible notebook graph.

### `GET /api/studio/graph/:notebookId/search?q=term&limit=20`

Searches enabled graph nodes by alias/label for an accessible notebook graph.

### `GET /api/studio/graph/:notebookId/subgraph`

Returns graph nodes and edges for rendering. Query parameters:

```text
mode=top | around
type=<entity type>
limit=80
nodeId=<seed node id>   // required for mode=around
hops=1                 // 1-2 for mode=around
```

Only enabled nodes and edges are returned through the Studio endpoint.

### `GET /api/studio/graph/:notebookId/node/:nodeId`

Returns one enabled node, its neighbors, and source references.

### `GET /api/studio/graph/:notebookId/edge/:edgeId`

Returns one enabled edge and source references.

Studio graph endpoints use normal notebook read access, not `ADMIN_TOKEN`.
They return `404` with `error: "no_graph"` when a notebook has no graph index.

## Visualization

### `POST /api/visualize`

Body:

```js
{
  prompt,
  model,
  messages,
  documents,
  personalization
}
```

Returns:

```js
{ visualization }
```

The LLM proposes a plan, and `server/visualization.js` validates and computes
the final chart/table/KPI data from the uploaded CSV/XLSX rows.

## Follow-Ups

### `POST /api/followups`

Body:

```js
{
  model,
  messages,
  personalization
}
```

Returns:

```js
{ suggestions: ["...", "...", "..."] }
```

The frontend does not request or display follow-up suggestions for no-evidence
assistant answers.

## Calendar Agent

### `POST /api/agent/intent`

Body:

```js
{
  prompt,
  model,
  currentDate,
  messages,
  pendingAction
}
```

Returns:

```js
{
  intent: "chat" | "calendar.propose" | "calendar.create" | "calendar.list" | "calendar.delete" | "calendar.update",
  payload: {},
  fallbackReason
}
```

## Holidays

### `GET /api/holidays?year=2026`

Returns Korean public holidays for the requested year. Uses the configured
public API key when available, otherwise a limited fixed-solar-holiday fallback.

## Admin And Notebooks

Management UI lives under the main gear button:

```text
Settings
|- Personal Settings
`- Admin Console
   |- Department Notebook Management
   |- Access Management
   |  |- Group Management
   |  `- Super Access
   |- RAG Status
   |- RAG Quality
   |  |- Golden Set -> Run -> Results
   |  `- Operations Health
   `- Usage Statistics
```

The Admin Console uses `ADMIN_TOKEN` for management routes. Normal notebook
read access uses `/api/access/login` tokens instead.

## Access Control

Department notebook access control is inactive until at least one group level or
Super password is configured. Once active, notebook reads and chat requests that
include `notebookId` require `Authorization: Bearer <access token>`. `ADMIN_TOKEN`
continues to protect management APIs only; it is not a user notebook-read token.

### `GET /api/access/options`

Public. Returns enabled login choices:

```js
{ groups: [{ id, name, description, levels: [1, 2, 3] }], super: { enabled } }
```

### `GET /api/access/status`

Public. With an access token, returns the current group/level or Super session:

```js
{ configured: boolean, authenticated: boolean, access: object | null }
```

### `POST /api/access/login`

Public. Authenticates a group/level password:

```js
{ groupId: "finance", level: 2, password: "..." }
```

or Super:

```js
{ super: true, password: "..." }
```

Returns `{ ok, access, token }` on success.

### `POST /api/access/logout`

Public. Stateless acknowledgement; the browser discards its session token.

### `GET /api/admin/access/groups`

Admin. Lists groups, per-level enabled/password-set flags, and Super status.
Password hashes are never returned.

### `POST /api/admin/access/groups`

Admin. Creates an access group.

### `PATCH /api/admin/access/groups/:groupId`

Admin. Updates group name, description, or enabled state.

### `DELETE /api/admin/access/groups/:groupId`

Admin. Deletes an access group.

### `POST /api/admin/access/groups/:groupId/levels/:level/password`

Admin. Replaces a Level 1-3 password. Existing passwords are not readable.

### `DELETE /api/admin/access/groups/:groupId/levels/:level/password`

Admin. Deletes a Level 1-3 password and disables that level, returning it to
the unset state.

### `PATCH /api/admin/access/groups/:groupId/levels/:level`

Admin. Enables or disables a level.

### `POST /api/admin/access/super/password`

Admin. Replaces the Super read-access password. When a Super password already
exists, the request must include the existing password:

```js
{ currentPassword: string, password: string, confirmPassword: string }
```

For first-time setup, `currentPassword` may be omitted. Existing passwords are
never returned by the API. `confirmPassword` must match `password`; the browser
checks this before sending, and the server validates it again.

### `PATCH /api/admin/access/super`

Admin. Enables or disables Super login.

### `GET /api/admin/status`

Public. Returns whether `ADMIN_TOKEN` is configured:

```js
{ configured: boolean }
```

### `POST /api/admin/verify`

Requires `Authorization: Bearer <ADMIN_TOKEN>`.

## Admin RAG Evaluation

All endpoints under `/api/admin/rag-eval` require
`Authorization: Bearer <ADMIN_TOKEN>`.

### `GET /api/admin/rag-eval/golden`

Returns the persisted golden set used for department RAG quality checks.

### `PUT /api/admin/rag-eval/golden`

Replaces the full golden set:

```js
{ golden: { suites: [...] } }
```

### `PUT /api/admin/rag-eval/golden/case`

Creates or updates one golden case:

```js
{ suiteId, case: { id, query, relevantChunkKeys, ... } }
```

### `DELETE /api/admin/rag-eval/golden/case?suiteId=...&caseId=...`

Deletes one golden case.

### `GET /api/admin/rag-eval/runs?limit=50`

Lists active and persisted RAG evaluation runs.

### `POST /api/admin/rag-eval/runs`

Starts a background evaluation run and returns `202`:

```js
{
  filter: { quick: true },
  k: 10,
  variants: [{ label: "default" }]
}
```

Progress can be watched through the stream endpoint below.

### `GET /api/admin/rag-eval/runs/:id`

Returns active progress, a completed run payload, or `404` when the run is not
known.

### `GET /api/admin/rag-eval/runs/:id/stream`

Server-Sent Events stream for an active run. Events include `hello`,
`progress`, `done`, and `error`.

### `DELETE /api/admin/rag-eval/runs/:id`

Aborts an active run when possible and removes the persisted run record.

### `GET /api/admin/rag-eval/retrieval-log/summary?days=7&profile=department&notebookId=...`

Summarizes privacy-safe retrieval telemetry for the Admin Console RAG
Evaluation panel.

## Admin Statistics

All endpoints under `/api/admin/stats` require
`Authorization: Bearer <ADMIN_TOKEN>` and read from privacy-safe usage logs
under `data/logs/usage-YYYY-MM-DD.jsonl` written by `server/stats/statsLogger.js`.
The `range` query parameter accepts a `<N>d` form (default `7d`, clamped to
1–365 days).

### `GET /api/admin/stats/summary?range=7d`

Returns KPI-style aggregates for the requested window:

```js
{
  ok: true,
  range: "7d",
  kpi: {
    totalSessions, totalQueries, activeGroups, avgLatencyMs,
    lawQueries, complianceRuns, studioOpens, studioExports, errorCount
  }
}
```

### `GET /api/admin/stats/groups?range=7d`

Returns per-group activity ranking (group id, query count, session count,
avg latency).

### `GET /api/admin/stats/notebooks?range=7d`

Returns per-notebook activity ranking (notebook id, query count, citation
count, last activity).

### `GET /api/admin/stats/sessions?range=7d&page=1&pageSize=50`

Returns a paginated list of recent sessions with query count, total
latency, and first/last timestamps. `pageSize` is clamped to 1–200.

## Admin Knowledge Graph

All endpoints under `/api/admin/graph` require
`Authorization: Bearer <ADMIN_TOKEN>`. These endpoints are for graph
inspection and moderation; normal users should use `/api/studio/graph`.

### `GET /api/admin/graph/ontology`

Returns the configured graph ontology.

### `GET /api/admin/graph/:notebookId/stats`

Returns counts and ontology version for a notebook graph.

### `GET /api/admin/graph/:notebookId/nodes?type=...&q=...&limit=50&offset=0&enabledOnly=1`

Lists graph nodes, optionally including disabled nodes when `enabledOnly=0`.

### `GET /api/admin/graph/:notebookId/search?q=term&limit=20`

Searches graph nodes by alias/label, including admin-visible records.

### `GET /api/admin/graph/:notebookId/subgraph`

Returns a renderable graph. It supports the same `mode`, `type`, `limit`,
`nodeId`, and `hops` parameters as the Studio endpoint, plus
`includeDisabled=1`.

### `GET /api/admin/graph/:notebookId/node/:nodeId`

Returns one node, neighbors, and source references.

### `GET /api/admin/graph/:notebookId/edge/:edgeId`

Returns one edge and source references.

### `POST /api/admin/graph/:notebookId/node/:nodeId/toggle`

Enables or disables a node:

```js
{ enabled: boolean }
```

### `POST /api/admin/graph/:notebookId/node/:nodeId/clear-override`

Clears the manual override and restores confidence-threshold based node
enablement.

### `POST /api/admin/graph/:notebookId/edge/:edgeId/toggle`

Enables or disables an edge:

```js
{ enabled: boolean }
```

### `POST /api/admin/graph/:notebookId/edge/:edgeId/clear-override`

Clears the manual override and restores confidence-threshold based edge
enablement.

### `POST /api/admin/graph/:notebookId/rebuild`

Starts a background rebuild of one notebook knowledge graph and returns `202`:

```js
{ model: "gemma4:e2b", concurrency: 1 }
```

`model` is optional and falls back to `KG_EXTRACT_MODEL` or the graph
extractor default. `concurrency` is clamped by the server. Rebuilds are written
to a temporary graph, validated, then swapped into place.

### `GET /api/admin/graph/:notebookId/rebuild/status`

Returns the latest rebuild job snapshot for the notebook, including persisted
history from `data/notebooks/<notebookId>/graph-jobs/`, or `job: null` when no
rebuild has been recorded.

### `GET /api/admin/graph/:notebookId/rebuild/jobs?limit=20`

Returns recent persisted rebuild job snapshots for the notebook.

### `GET /api/notebooks`

Notebook summaries. When access control is active, returns only notebooks the
access token can read. Admin requests include access policies for management.

### `GET /api/notebooks/:id`

Notebook detail. When access control is active, unauthorized users receive 401
or 403. Admin requests include access policies for management.

### `POST /api/notebooks`

Admin. Creates a notebook.

### `PATCH /api/notebooks/:id`

Admin. Updates notebook metadata.

### `PATCH /api/notebooks/:id/access`

Admin. Updates notebook access policy:

```js
{ access: { groups: ["finance", "planning"], minLevel: 2 } }
```

`minLevel` uses Level 1 as the highest privilege. A user authenticated as
Level 1 can read notebooks that require Level 1, 2, or 3; Level 2 can read
notebooks that require Level 2 or 3; Level 3 can read only Level 3 notebooks.

### `DELETE /api/notebooks/:id`

Admin. Deletes a notebook and invalidates related indexes/cache.

### `POST /api/notebooks/:id/documents`

Admin. Synchronous document upload endpoint kept for compatibility.

### `POST /api/notebooks/:id/ingest-jobs`

Admin. Preferred async notebook ingest path. Creates a persistent ingest job
with retry and startup recovery.

### `GET /api/notebooks/:id/ingest-jobs`

Admin. Lists notebook ingest jobs.

### `GET /api/notebooks/:id/ingest-jobs/:jobId`

Admin. Gets one ingest job.

### `POST /api/notebooks/:id/ingest-jobs/:jobId/retry`

Admin. Retries a failed ingest job when the preserved upload file is available.

### `DELETE /api/notebooks/:id/documents/:documentId`

Admin. Deletes a notebook document and removes related index entries.
