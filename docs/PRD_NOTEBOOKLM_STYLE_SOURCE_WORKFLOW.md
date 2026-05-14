# PRD: NotebookLM-Style Source Workflow

## Purpose

myAI should support a source-output-source loop:

```text
assistant answer / Studio document / user memo
-> room source
-> later analysis or query
-> another exportable work product
```

The implementation should adapt NotebookLM-style source reuse to public-sector
work: internal documents, department notebooks, Korean law grounding, citations,
Studio outputs, access policy, and evidence-aware exports.

## Current Implementation Status

MVP 1 is implemented for assistant answers:

- Assistant messages expose a `자료로 추가` action.
- The user can choose `md`, `pdf`, `docx`, or `hwpx`.
- The browser calls `POST /api/source-workflow/from-answer`.
- The server reuses `server/exportFiles.js` to create the requested format.
- The returned generated source is pushed into `room.documents`.
- The generated source is persisted with the room in encrypted IndexedDB.
- The material panel displays generated sources under `AI 생성 자료`.
- Generated sources are labeled `AI 생성` and `검증 필요`.
- Later `/api/chat` requests include generated source text as document context.
- `server/ollama.js` treats generated sources as secondary references and
  prefixes their chunks with `[AI 생성 참고자료]`.
- Generated sources are not promoted to department notebooks.

The implementation files are:

- `server/sourceWorkflow/generatedSourceApi.js`
- `server/sourceWorkflow/generatedSourceModel.js`
- `public/modules/sourceWorkflow.js`
- `public/modules/chat.js`
- `public/app.js`
- `public/modules/persistence.js`
- `server/ollama.js`

## Generated Source Model

Generated room sources are document-like entries in `room.documents`:

```js
{
  id: "generated_doc_...",
  kind: "document",
  fileName: "검토 보고서.docx",
  fileType: "docx",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  text: "...",
  textLength: 1234,
  preview: "...",
  origin: "assistant_answer",
  sourceMessageId: "msg_...",
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
```

`text` is always the analyzable source. `dataBase64` is returned only when the
generated binary is below `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES`.

## Trust Policy

Generated sources are working artifacts, not original evidence. When they are
included in chat context, the prompt instructs the model to treat them as
secondary references and to prefer original uploads, department notebook
evidence, and official law sources when available.

Generated sources must not be labeled as official law, department-approved
policy, or original evidence.

## Storage Policy

MVP storage is browser-only:

- Generated room sources persist in encrypted IndexedDB with the room.
- The server performs conversion and returns the generated payload.
- The server does not permanently store personal generated sources.
- Department notebook promotion is out of scope for MVP.

## Implemented API

### `POST /api/source-workflow/from-answer`

Request:

```js
{
  messageId: "msg_...",
  title: "검토 보고서",
  answerMarkdown: "...",
  format: "docx",
  metadata: {
    notebook: {},
    law: {},
    compliance: {},
    webSearch: {},
    citations: []
  }
}
```

Response:

```js
{
  ok: true,
  generatedSource: {}
}
```

## Remaining Product Work

### Phase 2: Studio Editor UX

- Add `문서 편집` / `원문 보기` mode switch.
- Keep Markdown as the internal source of truth.
- Render a visual editing mode by default.
- Support limited editing for headings, paragraphs, lists, checklists, and
  simple tables.

### Phase 3: Source Guide

- Generate source guides for uploaded files and selected department notebooks.
- Include summary, key issues, related laws, recommended questions, and possible
  outputs.

### Phase 4: Studio Output Library

- Store generated documents, maps, tables, briefings, and memos under room-level
  Studio outputs.
- Allow Studio outputs to become room sources.

### Phase 5: Department Notebook Promotion

- Add an admin-reviewed promotion workflow.
- Required metadata: source title, summary, source room/message ID, generation
  time, citations, review status, approved by.

## Verification

Current dedicated regression command:

```powershell
npm.cmd run test:source-workflow
```

This covers source-workflow API validation, supported formats, generated source
metadata, frontend wiring, material display expectations, prompt trust markers,
and persistence metadata compatibility.
