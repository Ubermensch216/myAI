# PRD: Studio Document Editor

## 1. Purpose

Build a new Studio feature that lets users send an AI answer from a chat room into Studio, edit it as a structured document, apply a document template, and export the edited document as HWPX, DOCX, PDF, or Markdown.

This feature upgrades myAI from an answer-generation system into a public-sector document-production system.

Target user flow:

```text
AI answer
-> Send to Studio
-> Select template
-> Convert answer into structured draft
-> Edit in Studio
-> Export as HWPX / DOCX / PDF
```

## 2. Product Positioning

This feature should support myAI's identity as:

```text
An on-premise public-sector AI knowledge system that turns grounded answers, legal reviews, RAG results, and evidence into editable official work documents.
```

Current myAI already supports:

- Studio tools: mind map, notebook graph, Law Explorer
- answer export: MD, PDF, XLSX, DOCX, HWPX
- department notebook RAG
- Korean Law Engine
- legal compliance review workflow
- source-separated citations

The Studio Document Editor should reuse this foundation, not create a separate app.

## 3. Feature Name

Recommended user-facing Korean name:

```text
Studio 문서편집기
```

Alternative labels:

```text
문서 작성 Studio
Report Studio
```

Recommended button label in chat message actions:

```text
스튜디오로 보내기
```

Recommended Studio tab label:

```text
문서
```

## 4. Core User Stories

### 4.1 Answer to report

As a user, I want to send an AI answer to Studio so that I can refine it into a formal report and download it as HWPX, DOCX, or PDF.

### 4.2 Template-based drafting

As a public-sector user, I want to choose a template such as 기획서, 검토보고서, 일일보고, 회의록, or 감사 체크리스트 so that AI answers are reorganized into familiar work-document structures.

### 4.3 Personal templates

As a user, I want to create or copy templates so that my department's preferred report structure can be reused.

### 4.4 Evidence-preserving editing

As a user, I want citations from the original answer to remain available in the document so that the exported file retains source traceability.

## 5. Non-Goals for MVP

Do not implement these in the first version:

- full Word/HWP-level rich text editor
- collaborative multi-user editing
- server-side saved drafts
- complex page layout controls
- image positioning
- headers/footers
- auto table of contents
- approval workflow
- electronic signature
- official document-number issuance
- complex HWPX section/paragraph style editor

MVP should focus on reliable structured drafting and export.

## 6. Existing myAI Capabilities To Reuse

### 6.1 Studio

Studio already has multiple tools. Add a new tool/tab:

```text
Studio
├─ 문서
├─ 마인드맵
├─ 지식그래프
└─ 법령
```

The document tool should be implemented in a separate frontend module instead of expanding `public/modules/studio.js` too much.

Recommended new frontend file:

```text
public/modules/documentStudio.js
```

### 6.2 Export system

`server/exportFiles.js` already supports:

```text
md
pdf
xlsx
docx
hwpx
```

The new feature should not break existing answer export.

Important distinction:

```text
Existing export:
message markdown -> export file

New export:
message markdown -> Studio document model -> edit -> export file
```

### 6.3 Persistence

Personal drafts and personal templates should be saved in browser IndexedDB through the existing room/persistence model.

MVP should not add server-side document storage.

## 7. High-Level Design

### 7.1 New document model

Do not store the edited document as raw HTML only. Use a structured JSON model.

Recommended shape:

```js
{
  id: "draft_...",
  title: "개인정보 처리 위탁 지침 검토 보고서",
  templateId: "review_report",
  source: {
    roomId: "room_...",
    messageId: "msg_...",
    sourceType: "assistant_answer"
  },
  blocks: [
    {
      id: "block_1",
      type: "heading",
      level: 1,
      text: "1. 검토 개요"
    },
    {
      id: "block_2",
      type: "paragraph",
      text: "..."
    },
    {
      id: "block_3",
      type: "table",
      columns: ["항목", "내용", "근거"],
      rows: [
        ["위탁 관리", "일부 보완 필요", "[N1], [L1]"]
      ]
    },
    {
      id: "block_4",
      type: "checklist",
      items: [
        { text: "재위탁 승인 절차 명시", checked: false }
      ]
    }
  ],
  citations: {
    notebook: [],
    law: [],
    precedent: [],
    interpretation: [],
    adminRule: [],
    ordinance: [],
    web: []
  },
  createdAt: "...",
  updatedAt: "..."
}
```

### 7.2 Supported block types for MVP

Support only these block types initially:

```text
heading
paragraph
bullet_list
numbered_list
table
checklist
quote
source_list
spacer
```

Avoid complex nested blocks in MVP.

### 7.3 Template-driven transformation

The template structure should be deterministic. The AI should fill sections, not invent a new layout each time.

Flow:

```text
selected template blocks
+ original answer markdown
+ answer metadata/citations
-> server transform
-> document model blocks
```

The prompt should require JSON output matching the document model.

## 8. Default Templates

Provide five built-in templates.

### 8.1 기획서

Template ID:

```text
planning_proposal
```

Sections:

```text
1. 추진 배경
2. 현황 및 문제점
3. 추진 목표
4. 주요 추진 내용
5. 세부 추진 계획
6. 기대 효과
7. 향후 일정
8. 검토 및 협조 사항
```

Use cases:

```text
신규 사업 기획
업무 개선 계획
AI 활용 계획
시스템 도입 계획
```

### 8.2 검토보고서

Template ID:

```text
review_report
```

Sections:

```text
1. 검토 개요
2. 검토 대상
3. 관련 근거
4. 주요 검토 내용
5. 쟁점 및 판단
6. 리스크
7. 조치 의견
8. 참고 자료
```

Use cases:

```text
법령 적합성 검토
민원 답변 검토
내부 지침 검토
계약/용역 문서 검토
```

This should be the default template for legal compliance review answers.

### 8.3 일일보고

Template ID:

```text
daily_report
```

Sections:

```text
1. 금일 주요 업무
2. 진행 현황
3. 이슈 및 대응
4. 내일 계획
5. 협조 요청
6. 참고 사항
```

Use cases:

```text
팀 업무 보고
프로젝트 일일 현황
운영 상황 보고
```

### 8.4 회의록

Template ID:

```text
meeting_minutes
```

Sections:

```text
1. 회의 개요
   - 일시
   - 장소
   - 참석자
   - 안건
2. 주요 논의 내용
3. 결정 사항
4. 후속 조치
5. 담당자 및 기한
6. 첨부/참고 자료
```

Use cases:

```text
내부 회의
착수보고
협의체 회의
민관 협의
```

### 8.5 감사·점검 체크리스트

Template ID:

```text
audit_checklist
```

Sections:

```text
1. 점검 개요
2. 점검 기준
3. 점검 항목
4. 확인 결과
5. 미흡 사항
6. 개선 권고
7. 후속 조치 일정
```

Main table:

```text
| 점검 항목 | 기준/근거 | 확인 내용 | 결과 | 조치 필요 |
```

Use cases:

```text
감사 대응
개인정보 점검
보안 점검
내부통제 점검
```

## 9. User Templates

### 9.1 Scope

MVP supports personal templates only.

```text
Personal templates: browser IndexedDB
Department-shared templates: later phase
```

### 9.2 User template shape

```js
{
  id: "tpl_custom_...",
  scope: "personal",
  name: "우리 부서 검토보고서",
  description: "내부 법령 검토용 보고서",
  baseTemplateId: "review_report",
  blocks: [
    {
      type: "section",
      title: "1. 검토 개요",
      instruction: "검토 목적과 대상을 간단히 작성"
    },
    {
      type: "table",
      title: "3. 검토 결과",
      columns: ["항목", "내부 근거", "법령 근거", "판단", "조치"]
    }
  ],
  createdAt: "...",
  updatedAt: "..."
}
```

### 9.3 User template UI

MVP should allow:

```text
- copy built-in template
- rename template
- edit section titles
- add/remove sections
- reorder sections
- edit table columns
- delete personal template
```

Suggested location:

```text
Settings -> Personal Settings -> 문서 템플릿
```

A full visual template designer is not required for MVP.

## 10. User Experience

### 10.1 Chat message action

Add a new action to assistant messages:

```text
스튜디오로 보내기
```

Expected behavior:

```text
1. Capture answer markdown.
2. Capture answer metadata, including notebook/law/web citations.
3. Switch Studio to Document tool.
4. Open template selection view.
5. Convert answer to draft using selected template.
```

### 10.2 Studio document view

Recommended layout:

```text
[문서] [마인드맵] [지식그래프] [법령]

Title input
Template selector
Toolbar: [AI로 재구성] [미리보기] [다운로드 ▼]

Block editor:
- section blocks
- paragraphs
- tables
- checklist
- source list
```

### 10.3 Minimal block editor behavior

Each block should support:

```text
edit text
move up/down
delete
add paragraph below
add table below
```

For tables:

```text
edit cell text
add row
delete row
```

For checklist:

```text
edit item text
toggle checked
delete item
add item
```

### 10.4 Export controls

Export menu:

```text
HWPX
DOCX
PDF
Markdown
```

MVP may hide XLSX in the document editor export menu.

## 11. Backend API

### 11.1 Template list

```text
GET /api/studio/document/templates
```

Response:

```js
{
  ok: true,
  templates: [
    {
      id: "review_report",
      name: "검토보고서",
      builtIn: true,
      description: "법령·문서 검토 결과 보고서",
      blocks: []
    }
  ]
}
```

### 11.2 Answer to document

```text
POST /api/studio/document/from-answer
```

Request:

```js
{
  title: "개인정보 처리 위탁 지침 검토 보고서",
  answerMarkdown: "...",
  templateId: "review_report",
  template: {},
  metadata: {
    notebook: {},
    law: {},
    compliance: {},
    webSearch: {}
  },
  model: "gemma3n:e2b"
}
```

Response:

```js
{
  ok: true,
  document: {
    id: "draft_...",
    title: "...",
    templateId: "review_report",
    blocks: [],
    citations: {},
    createdAt: "...",
    updatedAt: "..."
  }
}
```

### 11.3 Document export

```text
POST /api/studio/document/export
```

Request:

```js
{
  format: "docx",
  document: {
    title: "...",
    blocks: [],
    citations: {}
  },
  options: {
    includeCitations: true,
    includeGeneratedAt: true
  }
}
```

Response:

```text
binary file download
```

Supported formats:

```text
hwpx
docx
pdf
md
```

### 11.4 Rewrite block, later MVP extension

```text
POST /api/studio/document/rewrite
```

Request:

```js
{
  document: {},
  blockId: "block_...",
  instruction: "더 공식적인 보고서 문체로 다듬어줘."
}
```

MVP may skip this endpoint. If implemented, support selected-block rewrite before full-document rewrite.

## 12. Backend Module Design

Recommended files:

```text
server/studioDocument/
  studioDocumentApi.js
  defaultTemplates.js
  documentModel.js
  answerToDocument.js
  documentRenderer.js
  documentExport.js
```

### 12.1 `defaultTemplates.js`

Owns built-in templates.

### 12.2 `documentModel.js`

Validates and normalizes document model.

Responsibilities:

```text
sanitize title
normalize block IDs
limit max blocks
limit max chars
validate table shapes
remove unsupported block types
```

### 12.3 `answerToDocument.js`

Uses Ollama to convert answer markdown into template-structured JSON.

Rules:

```text
- template sections are fixed
- AI fills content into sections
- do not invent citations
- preserve citation markers such as [N1], [L1], [P1]
- if source answer lacks content for a section, write "작성 필요"
```

### 12.4 `documentRenderer.js`

Converts document model to markdown-like canonical text for export.

Example:

```text
Document model -> markdown
Document model -> plain blocks for DOCX/HWPX/PDF renderer
```

### 12.5 `documentExport.js`

Exports structured document using existing `server/exportFiles.js` where possible.

Do not modify the existing message export behavior unless necessary.

## 13. Frontend Module Design

Recommended files:

```text
public/modules/documentStudio.js
public/modules/documentTemplates.js
```

### 13.1 `documentStudio.js`

Responsibilities:

```text
render document Studio tab
handle answer import
handle template selection
render block editor
persist drafts into room state
call export API
```

### 13.2 Room state extension

Store drafts in active room state:

```js
room.studio.documents = [
  {
    id: "draft_...",
    title: "...",
    templateId: "review_report",
    blocks: [],
    citations: {},
    sourceMessageId: "msg_...",
    updatedAt: "..."
  }
]
```

Store active draft:

```js
room.studio.activeDocumentId = "draft_..."
```

### 13.3 Personal templates in IndexedDB

Use existing persistence path for settings or user state.

Suggested shape:

```js
state.documentTemplates = {
  personal: []
}
```

## 14. Export Rendering Requirements

### 14.1 Supported formatting

MVP export should preserve:

```text
title
headings
paragraphs
bullets
numbered lists
tables
checklists
source list
simple spacing
```

### 14.2 Avoid in MVP

Do not promise reliable support for:

```text
images
complex merged tables
headers/footers
footnotes
multi-column layout
automatic table of contents
institution logos
approval stamp boxes
```

### 14.3 Citation handling

If `includeCitations=true`, append a source section:

```text
## 출처

### 내부 문서/부서노트북
[N1] ...

### 법령
[L1] ...

### 판례/해석례/행정규칙/자치법규
[P1] ...
[I1] ...
[R1] ...
[O1] ...

### 웹
[W1] ...
```

If the document already has a source block, update it rather than duplicate it.

## 15. Prompt Requirements for Answer-to-Document

The server prompt for `/from-answer` should include:

```text
You convert an AI answer into a structured public-sector work document.
Use the selected template exactly.
Do not invent facts or citations.
Preserve citation markers exactly, including [N1], [L1], [P1], [I1], [R1], [O1], [W1].
If a template section has no source content, write "작성 필요".
Return strict JSON only.
```

Expected JSON:

```js
{
  "title": "...",
  "blocks": [
    { "type": "heading", "level": 1, "text": "1. 검토 개요" },
    { "type": "paragraph", "text": "..." },
    {
      "type": "table",
      "columns": ["항목", "내용", "근거"],
      "rows": [["...", "...", "[N1]"]]
    }
  ]
}
```

## 16. Data Safety

### 16.1 Browser storage

Drafts and personal templates are personal work artifacts. Store them client-side in IndexedDB in MVP.

### 16.2 Server processing

When converting answer to document, send only:

```text
answer markdown
selected template
citation metadata needed for source rendering
```

Do not send unrelated room history.

### 16.3 Size limits

Add limits:

```text
answerMarkdown max chars: 120,000
result document max chars: 180,000
max blocks: 120
max table rows per table: 200
```

Reuse `EXPORT_MAX_CHARS` where possible, or add:

```env
STUDIO_DOCUMENT_MAX_CHARS=180000
STUDIO_DOCUMENT_MAX_BLOCKS=120
```

## 17. Error Handling

### 17.1 Empty answer

```text
문서로 보낼 답변 내용이 없습니다.
```

### 17.2 Template conversion failure

Fallback behavior:

```text
If AI JSON conversion fails, create a simple document:
- title
- one heading: 원문 답변
- one paragraph block containing original answer markdown converted to plain text
```

### 17.3 Export failure

```text
문서 내보내기에 실패했습니다. 형식을 바꾸거나 문서 길이를 줄인 뒤 다시 시도하세요.
```

### 17.4 Unsupported format

```text
지원하지 않는 문서 형식입니다.
```

## 18. Testing Plan

### 18.1 Server tests

Add script:

```json
"test:studio-document": "node scripts/studio-document-test.mjs"
```

Test cases:

```text
- list built-in templates
- convert simple markdown answer to document model
- fallback conversion when invalid AI JSON is returned
- validate document model with unsupported block types removed
- export document model to docx
- export document model to hwpx
- export document model to pdf
- reject empty document
- reject too-large document
```

### 18.2 Frontend/manual tests

```text
- assistant message shows 스튜디오로 보내기
- clicking it opens Studio document tab
- template selection appears
- generated draft appears
- user can edit a paragraph block
- user can edit a table cell
- export dropdown downloads DOCX/HWPX/PDF
- existing Mindmap/Graph/Law Studio tools still work
```

### 18.3 Regression tests

Ensure these continue to work:

```text
existing answer export
Studio mindmap
Studio graph
Studio Law Explorer
chat message rendering
source panel rendering
```

## 19. Acceptance Criteria

MVP is complete when all are true:

```text
1. Assistant messages have a visible "스튜디오로 보내기" action.
2. Clicking the action opens Studio document editor.
3. User can choose one of five built-in templates.
4. The selected answer is converted into a structured document draft.
5. User can edit title and basic block contents.
6. User can edit table cell contents.
7. Draft persists in the current room after render/save cycle.
8. User can export the edited draft as DOCX.
9. User can export the edited draft as HWPX.
10. User can export the edited draft as PDF.
11. Citation markers such as [N1] and [L1] are preserved in generated draft text.
12. If citation metadata exists, export can append a source section.
13. Existing direct message export still works.
14. Existing Studio mindmap, graph, and law tools still work.
15. User can create at least one personal template by copying a built-in template and renaming/editing sections.
```

## 20. Implementation Sequence for AI Agent

Follow this sequence.

```text
1. Read this PRD.
2. Inspect server/exportFiles.js.
3. Inspect public/modules/studio.js and current Studio tab handling.
4. Inspect public/modules/chat.js assistant message action rendering.
5. Inspect public/modules/state.js and persistence.js for room/studio state shape.
6. Add server/studioDocument/defaultTemplates.js.
7. Add server/studioDocument/documentModel.js.
8. Add server/studioDocument/documentRenderer.js.
9. Add server/studioDocument/studioDocumentApi.js with templates/from-answer/export endpoints.
10. Mount the API in server/index.js.
11. Add public/modules/documentStudio.js.
12. Add Studio document tab wiring in studio.js.
13. Add "스튜디오로 보내기" action in chat message UI.
14. Add minimal block editor.
15. Add export dropdown.
16. Add personal template copy/rename/edit-section MVP.
17. Add tests.
18. Run existing smoke tests and new studio-document tests.
```

Do not begin with complex rich-text editing. Build a reliable structured document workflow first.

## 21. Future Roadmap

### Phase 2: AI block rewrite

Support:

```text
선택 블록 다듬기
보고서 문체로 변경
더 간결하게
공식 문서체로 변경
```

### Phase 3: Dedicated public-sector styles

Add optional style presets:

```text
공문형
보고서형
회의자료형
감사자료형
```

### Phase 4: Department-shared templates

Add admin-managed templates stored server-side.

```text
Admin Console -> 문서 템플릿 관리
```

### Phase 5: Advanced HWPX/DOCX layout

Add:

```text
결재란
문서번호
담당부서
작성자
시행일
보안등급
기관명/로고
머리말/꼬리말
```

### Phase 6: Evidence report mode

Integrate tightly with legal compliance review so that:

```text
법령 적합성 검토 answer
-> default review_report template
-> source-aware evidence report
-> HWPX/DOCX/PDF export
```

## 22. Final Product Statement

This feature should make myAI feel like a public-sector work-product system:

```text
AI 답변을 스튜디오로 보내면, myAI가 기획서·검토보고서·일일보고·회의록·점검표 같은 업무문서 초안으로 재구성하고, 사용자는 이를 편집해 HWPX, DOCX, PDF로 내려받을 수 있다.
```
