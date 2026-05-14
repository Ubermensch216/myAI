# PRD: NotebookLM-style Source Workflow for myAI

## 1. Purpose

This PRD defines the next product direction for myAI as a NotebookLM-inspired public-sector knowledge system.

The main goal is to make AI outputs reusable as knowledge sources inside the same room/notebook workflow.

Current myAI already supports:

- chat over uploaded files and department notebooks
- Korean Law Engine
- Compliance Review
- Studio Document Editor
- export to HWPX / DOCX / PDF / MD
- notebook knowledge graphs
- Admin usage statistics

The next step is:

```text
AI answer / Studio document / user memo
-> save as room source
-> analyze/query again
-> turn into another output
```

This creates a source-output-source loop similar to NotebookLM, while preserving myAI's public-sector identity: internal documents, official legal grounding, evidence reports, and exportable work products.

## 2. Product Positioning

NotebookLM is useful because users can gather sources, ask questions over them, and generate derivative outputs such as summaries, reports, maps, and briefings.

myAI should not simply copy NotebookLM. It should adapt the pattern to public-sector workflows:

```text
Public-sector documents
+ department notebooks
+ Korean law grounding
+ citations
+ Studio work products
+ group/level access
+ usage telemetry
```

Target positioning:

```text
myAI is a law-grounded public-sector notebook system where internal documents, AI-generated reports, legal reviews, memos, and Studio outputs can become reusable sources for continuous analysis and document production.
```

## 3. Core Problems

### 3.1 AI answers are currently one-off outputs

An assistant answer can be copied, downloaded, or sent to Studio, but it is not yet naturally reintroduced as a room source.

Needed behavior:

```text
Assistant answer
-> convert to selected file format
-> attach to current room
-> use in later chat as a source
```

### 3.2 Studio Document Editor exposes Markdown syntax

Current Studio Document Editor is textarea-backed and markdown-based. This is technically simple but confusing to non-technical users because they see syntax such as:

```text
## Heading
| table | header |
- [ ] checklist
```

Needed behavior:

```text
Show a normal document editing view by default.
Hide Markdown under an advanced/raw mode.
```

### 3.3 NotebookLM-style outputs need myAI-specific adaptation

NotebookLM-style features should be introduced selectively:

- source guide
- generated notes as sources
- Studio output library
- reports
- tables
- mind maps
- briefings
- quizzes/training sets
- audio/video style overviews, adapted as public-sector briefings

## 4. Goals

### 4.1 MVP goals

1. Add an assistant-message action: **자료로 추가**.
2. Let users choose output format when saving an answer as a source.
3. Add generated answer files to the current room attachments/material context.
4. Mark generated files as **AI 생성** and **검증 필요**.
5. Ensure generated source files can be analyzed and queried in later chat turns.
6. Add a user-friendly Studio document editing mode that does not expose Markdown syntax by default.
7. Add NotebookLM-style source workflow documentation and UI terminology.

### 4.2 Later goals

1. Add Source Guide for uploaded files and department notebooks.
2. Add Studio Output Library to keep generated outputs in a room/notebook.
3. Add Data Table Generator.
4. Add Briefing Deck Generator.
5. Add Quiz/Training Set Generator.
6. Add Audio Briefing script generation and optional local TTS integration.
7. Add controlled promotion from room-generated source to department notebook source.

## 5. Non-Goals for MVP

Do not implement in MVP:

- automatic promotion of AI-generated files to department notebooks
- server-side permanent storage of personal generated files
- collaborative document editing
- full Word/HWP-level rich text editing
- NotebookLM-style audio generation with TTS
- video generation
- automatic trust of AI-generated files as official sources

## 6. Feature 1: Save AI Answer as Room Source

### 6.1 User-facing names

Recommended button label:

```text
자료로 추가
```

Alternative labels:

```text
첨부로 저장
소스로 저장
이 답변을 자료로 추가
```

Recommended placement:

```text
Assistant message actions:
[복사] [다운로드] [스튜디오로 보내기] [자료로 추가]
```

### 6.2 User flow

```text
1. User receives an AI answer.
2. User clicks [자료로 추가].
3. Modal opens.
4. User chooses file name and format.
5. myAI converts answer into selected format.
6. Generated file is added to current room attachments/materials.
7. Material panel shows it with [AI 생성].
8. Later chat requests can use it as a source.
```

### 6.3 Modal design

```text
이 답변을 자료로 추가

파일 이름:
[개인정보 처리 위탁 지침 검토보고서]

파일 형식:
( ) Markdown (.md)
( ) PDF (.pdf)
( ) Word (.docx)
( ) HWPX (.hwpx)

추가 위치:
● 현재 대화방 첨부자료
○ Studio 문서 초안에도 추가, later

[취소] [자료로 추가]
```

### 6.4 Supported formats

MVP:

```text
md
pdf
docx
hwpx
```

Use existing export infrastructure where possible:

```text
server/exportFiles.js
server/studioDocument/studioDocumentApi.js
```

### 6.5 Generated source metadata

Generated room attachment shape should include metadata similar to:

```js
{
  id: "generated_doc_...",
  name: "AI생성_검토보고서.hwpx",
  type: "generated_answer",
  origin: "assistant_answer",
  format: "hwpx",
  sourceMessageId: "msg_...",
  generatedBy: "assistant",
  generatedAt: "2026-05-14T...",
  trustLevel: "generated",
  sourceTrust: 0.5,
  labels: ["AI 생성", "검증 필요"],
  contentText: "...",
  citations: {
    notebook: [],
    law: [],
    precedent: [],
    interpretation: [],
    adminRule: [],
    ordinance: [],
    web: []
  }
}
```

### 6.6 Storage policy

MVP stores generated sources with the current room in browser IndexedDB.

```text
Room-level generated source:
- personal working artifact
- immediately usable in the same room
- not server-persisted as official department knowledge
```

Do not write generated sources directly into department notebooks in MVP.

### 6.7 Department notebook promotion, later phase

Add a later controlled workflow:

```text
Room generated source
-> submit as notebook candidate
-> admin review
-> metadata check
-> ingest into department notebook
```

Required fields for promotion:

```text
source title
summary
author/source room
original answer message ID
generation time
review status
approved by
source citations
```

## 7. Trust and Citation Policy for Generated Sources

### 7.1 Why trust separation matters

If AI-generated answers become sources, there is a risk of recursive grounding:

```text
AI answer
-> saved as source
-> later AI answer cites previous AI answer as if original evidence
```

This can amplify hallucinations or weak reasoning.

### 7.2 Trust levels

Add or reserve source trust types:

```text
uploaded_original       1.0
department_notebook     1.0
official_law            1.0
web_search              0.8
generated_answer        0.4-0.6
user_memo               0.5-0.7
```

MVP may not implement numeric weighting immediately, but metadata must distinguish generated sources.

### 7.3 Prompt instruction

When generated answer sources are included in context, add an instruction similar to:

```text
Some provided sources are AI-generated working documents. Treat them as secondary references. Prefer original uploaded documents, department notebooks, and official legal sources when available. Do not treat AI-generated sources as independent proof of legal or factual claims.
```

### 7.4 Source panel display

Generated files should be visibly marked:

```text
[AI 생성]
[검증 필요]
```

If a generated source includes original citations, preserve them in metadata and exported body where possible.

## 8. Feature 2: Replace Markdown-first Studio Editor with User-friendly Editing

### 8.1 Current state

The current Studio Document Editor is a markdown textarea editor.

Strengths:

- simple implementation
- stable export path
- compatible with HWPX/DOCX/PDF/MD export

Weaknesses:

- Markdown syntax is unfamiliar to ordinary users
- tables and checklists look like code
- public-sector users expect a document-like editor

### 8.2 Recommended direction

Do not remove Markdown internally immediately.

Instead:

```text
Internal representation: Markdown or document model
Default UI: WYSIWYG-like document editing
Advanced UI: Raw Markdown view
```

### 8.3 MVP: split modes

Add two tabs or a segmented control:

```text
[문서 편집] [원문 보기]
```

Default:

```text
문서 편집
```

Advanced:

```text
원문 보기
```

### 8.4 Document editing mode behavior

Render Markdown into editable visual sections:

```text
heading -> large section title
paragraph -> editable text area or contenteditable paragraph
table -> HTML table editor
checklist -> checkbox list
bullet list -> list editor
numbered list -> list editor
quote -> quote block
```

MVP may support limited visual editing:

```text
- edit heading text
- edit paragraph text
- edit table cell text
- add/delete table row
- edit checklist item
- toggle checklist item
```

If a structure cannot be edited safely, allow editing through Raw Markdown view.

### 8.5 Editor implementation options

#### Option A: lightweight custom visual editor

Pros:

- no heavy dependency
- easier internal-network deployment
- full control over allowed blocks

Cons:

- table editing and selection management are hard
- maintenance burden grows over time

Use only for MVP visual editing.

#### Option B: Markdown WYSIWYG editor library

Examples:

```text
Toast UI Editor
EasyMDE-style editor
```

Pros:

- compatible with current Markdown storage
- easier transition from textarea

Cons:

- external dependency
- export styling still needs normalization

Good transitional option.

#### Option C: ProseMirror / TipTap-style block editor

Pros:

- best long-term editor architecture
- JSON document model compatible
- good for tables, checklists, structured templates

Cons:

- larger implementation change
- may require build/bundling changes

Recommended long-term direction if myAI becomes a document-production platform.

### 8.6 Recommended phased path

```text
Phase 1:
- Add [문서 편집] / [원문 보기]
- Default to visual preview/edit mode
- Keep Markdown as source of truth

Phase 2:
- Add Markdown <-> block conversion
- Support section navigator
- Support table/checklist editing

Phase 3:
- Move to document-model-first editor
- Markdown becomes import/export format

Phase 4:
- Add public-sector document widgets
  - approval box
  - document number
  - department/author fields
  - security level
  - official report title page
```

## 9. Feature 3: NotebookLM-style Functions Suitable for myAI

### 9.1 Selection principle

myAI should adapt NotebookLM-style functions to public-sector workflows.

Do not copy features literally. Convert them into:

```text
source-grounded public-sector work outputs
```

### 9.2 Feature candidates and myAI adaptations

#### 1. Answer / memo / document as source

NotebookLM-style idea:

```text
generated outputs and notes stay inside the notebook workflow
```

myAI adaptation:

```text
AI answer -> generated room source
Studio document -> generated room source
User memo -> room source
```

Priority: Very high.

#### 2. Source Guide

myAI adaptation:

When a source is uploaded or a department notebook is selected, generate:

```text
summary
key issues
main entities
related laws
workflow steps
forms/templates
recommended questions
possible outputs
```

UI location:

```text
Material panel -> Source Guide tab
Notebook selector -> Notebook Guide
Studio -> Guide tile
```

Priority: Very high.

#### 3. Studio Output Library

myAI adaptation:

Add a room-level or notebook-level library of generated outputs:

```text
Documents
Mind maps
Law impact maps
Checklists
Tables
Briefings
Quizzes
Memos
```

UI:

```text
Studio -> Outputs
```

Priority: High.

#### 4. Reports / custom formats

myAI adaptation:

Use Studio Document Editor and templates:

```text
review report
legal compliance report
audit checklist
civil complaint review
manual
meeting minutes
daily report
```

Priority: Very high.

#### 5. Data Table Generator

myAI adaptation:

Convert sources into structured tables:

```text
audit finding table
legal basis table
education target table
action plan table
risk-control table
resource inventory table
```

Outputs:

```text
Studio table
XLSX
CSV
```

Priority: Very high.

#### 6. Mind Map and knowledge maps

myAI already has mind maps and notebook KG.

Recommended extension:

```text
source concept map
workflow map
law-internal-rule map
risk-control map
task-law-form-system map
```

Priority: High.

#### 7. Briefing Deck

NotebookLM-style video overview should become a public-sector briefing deck.

myAI adaptation:

```text
source set / answer / report
-> 5-10 page briefing deck outline
-> PPTX/PDF later
```

Initial output:

```text
slide title
key bullets
speaker notes
source citations
```

Priority: High.

#### 8. Quiz / Training Set

myAI adaptation:

```text
source or notebook
-> training questions
-> answer key
-> explanation
-> checklist for education completion
```

Use cases:

```text
safety training
integrity training
new employee onboarding
manual comprehension check
```

Priority: Medium-high.

#### 9. Audio Briefing

myAI adaptation:

MVP:

```text
briefing script
2-person dialogue script
short oral briefing script
```

Later:

```text
local TTS -> mp3 -> generated room source
```

Priority: Medium.

#### 10. Video Overview

myAI adaptation:

Do not start with video generation.

Instead:

```text
Briefing Deck Generator
Narrated slide script
```

Priority: Medium.

## 10. Recommended Roadmap

### Phase 1: Source loop MVP

```text
- Add [자료로 추가] to assistant messages
- Convert answer to MD/PDF/DOCX/HWPX
- Add generated file to current room attachments
- Mark generated source as [AI 생성]
- Preserve citations metadata
- Use generated source in later chat context
```

### Phase 2: Studio editor UX upgrade

```text
- Add [문서 편집] / [원문 보기]
- Hide Markdown by default
- Add visual rendering and limited editing
- Keep Markdown as source of truth
```

### Phase 3: Source Guide

```text
- Generate source guide for uploaded files
- Generate notebook guide for selected department notebooks
- Include recommended questions and possible outputs
```

### Phase 4: Studio Output Library

```text
- Store generated documents, maps, tables, briefings in room.studio.outputs
- Allow reopening and saving outputs as sources
```

### Phase 5: Data Tables and public-sector outputs

```text
- Add table generator
- Add evidence table
- Add audit finding table
- Add action plan table
- Export to XLSX/CSV
```

### Phase 6: Advanced NotebookLM-style outputs

```text
- briefing deck
- quiz/training set
- audio briefing scripts
- optional local TTS integration
```

### Phase 7: Department notebook promotion

```text
- Submit generated source as department notebook candidate
- Admin review/approval
- Ingest into department notebook
- Preserve provenance and citations
```

## 11. Backend Architecture

### 11.1 New module proposal

```text
server/sourceWorkflow/
  generatedSourceApi.js
  generatedSourceModel.js
  answerToSource.js
  sourceTrust.js
  sourceGuide.js
```

### 11.2 Suggested APIs

#### Convert answer to room source

```text
POST /api/source-workflow/from-answer
```

Request:

```js
{
  messageId: "msg_...",
  title: "개인정보 처리 위탁 지침 검토보고서",
  answerMarkdown: "...",
  format: "docx",
  metadata: {
    notebook: {},
    law: {},
    compliance: {},
    webSearch: {}
  }
}
```

Response:

```js
{
  ok: true,
  generatedSource: {
    id: "generated_doc_...",
    name: "AI생성_검토보고서.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    format: "docx",
    contentText: "...",
    dataBase64: "...",
    labels: ["AI 생성", "검증 필요"],
    sourceTrust: 0.5,
    metadata: {}
  }
}
```

The frontend should then add the returned object to the current room attachments/material state and persist it in IndexedDB.

#### Generate source guide

```text
POST /api/source-workflow/source-guide
```

Request:

```js
{
  sourceId: "...",
  sourceText: "...",
  sourceType: "uploaded_file" | "department_notebook" | "generated_source"
}
```

Response:

```js
{
  ok: true,
  guide: {
    summary: "...",
    keyIssues: [],
    relatedLaws: [],
    recommendedQuestions: [],
    possibleOutputs: []
  }
}
```

MVP may skip this endpoint and implement Phase 1 only.

## 12. Frontend Architecture

### 12.1 New module proposal

```text
public/modules/sourceWorkflow.js
```

Responsibilities:

```text
- render [자료로 추가] action
- open save-as-source modal
- call /api/source-workflow/from-answer
- add generated source to room materials
- mark generated sources in material panel
- preserve citation metadata
```

### 12.2 Room state extension

Generated sources should live alongside uploaded room files, but with type metadata.

```js
room.generatedSources = [
  {
    id: "generated_doc_...",
    name: "AI생성_검토보고서.docx",
    format: "docx",
    origin: "assistant_answer",
    sourceMessageId: "msg_...",
    contentText: "...",
    dataBase64: "...",
    labels: ["AI 생성", "검증 필요"],
    sourceTrust: 0.5,
    createdAt: "..."
  }
]
```

Material panel should merge:

```text
uploaded documents
generated sources
selected department notebook
```

### 12.3 Material panel UI

Display generated sources separately or with badges:

```text
자료(4개)
|- 첨부(2)
|  |- 현장점검표.pdf
|  |- 교육이수현황.xlsx
|- AI 생성 자료(1)
|  |- 개인정보 검토보고서.docx [AI 생성] [검증 필요]
|- 부서노트북(1)
   |- 안전감사팀 업무노트북
```

## 13. Source Ranking and Prompt Integration

When generated sources are included in chat context:

1. Include them after original uploaded documents and department notebook evidence when possible.
2. Add a metadata marker indicating generated source.
3. Add source trust instruction to the prompt.
4. Avoid using generated sources as sole basis for legal/factual claims if original evidence exists.

Recommended context label:

```text
[AI 생성 참고자료]
```

Example prompt note:

```text
The following source is AI-generated from a previous answer. Use it as a working note, not as primary evidence. Prefer original documents and official legal sources when available.
```

## 14. Safety and Privacy

### 14.1 Privacy

Generated room sources are personal room artifacts.

MVP storage:

```text
browser IndexedDB only
```

Do not upload generated files to server persistence unless exporting or converting.

### 14.2 Provenance

Always preserve:

```text
sourceMessageId
generatedAt
origin
format
citations metadata
sourceTrust
```

### 14.3 AI-generated content warning

Generated files must be visibly labeled:

```text
AI 생성
검증 필요
```

### 14.4 Avoid official-source confusion

Never label AI-generated files as official law, department-approved policy, or original evidence.

Department notebook promotion requires separate review.

## 15. Testing Plan

### 15.1 Unit / API tests

Add tests for:

```text
answer to generated source conversion
each format: md/pdf/docx/hwpx
empty answer rejection
large answer rejection
citation metadata preservation
generated source metadata shape
```

Suggested script:

```json
"test:source-workflow": "node scripts/source-workflow-test.mjs"
```

### 15.2 Frontend/manual tests

```text
- Assistant message shows [자료로 추가]
- Save modal opens
- User can choose DOCX/PDF/HWPX/MD
- Generated source appears in material panel
- Generated source has [AI 생성] badge
- Later chat can cite/analyze the generated source
- Source is persisted after page reload
```

### 15.3 Regression tests

Ensure these still work:

```text
message export
Studio document export
uploaded file chat
department notebook RAG
law citations
source panel rendering
```

## 16. Acceptance Criteria

MVP is complete when all are true:

1. Assistant answers have a visible **자료로 추가** action.
2. User can choose MD/PDF/DOCX/HWPX as save format.
3. Generated source is added to current room material state.
4. Generated source persists in IndexedDB with the room.
5. Generated source is visible in the material panel with **AI 생성** badge.
6. Later chat requests include generated source text as analyzable context.
7. Generated source metadata preserves original message ID and citations.
8. Generated source is not automatically added to department notebooks.
9. Prompt includes instruction that AI-generated sources are secondary references.
10. Existing direct export and Studio Document export still work.
11. Studio Document Editor no longer exposes raw Markdown by default once the editor UX phase is complete.

## 17. Implementation Sequence for AI Agent

### Phase 1: Save answer as source

1. Inspect current message action rendering in `public/modules/chat.js`.
2. Inspect room material state in `public/modules/state.js` and persistence flow.
3. Inspect upload-file material integration in chat requests.
4. Add `public/modules/sourceWorkflow.js`.
5. Add **자료로 추가** button to assistant message actions.
6. Add save-as-source modal.
7. Add server endpoint for converting answer to selected format.
8. Reuse `server/exportFiles.js` where possible.
9. Add generated source to room state.
10. Update material panel to display generated sources with badges.
11. Ensure generated source text is included in later `/api/chat` requests.
12. Add tests.

### Phase 2: Studio editor UX

1. Add `[문서 편집] / [원문 보기]` mode switch.
2. Render markdown as visual document by default.
3. Add limited visual editing for headings, paragraphs, tables, and checklists.
4. Keep raw markdown mode for advanced editing.
5. Preserve export compatibility.

### Phase 3: Source Guide

1. Add source guide API and frontend panel.
2. Generate summary, key issues, laws, recommended questions, possible outputs.
3. Integrate with material panel and department notebook selector.

### Phase 4: Studio Output Library

1. Add room.studio.outputs.
2. Store generated documents, tables, maps, and briefings.
3. Allow output-to-source conversion.

## 18. Relationship to Existing PRDs

This PRD extends:

```text
docs/PRD_STUDIO_DOCUMENT_EDITOR.md
docs/PRD_LEGAL_COMPLIANCE_REVIEW.md
docs/USAGE_TELEMETRY.md
```

It should not replace them.

It defines the connective layer that makes outputs reusable as sources, creating the NotebookLM-style loop.

## 19. Final Product Statement

The desired product behavior:

```text
사용자가 AI 답변이나 Studio 문서를 대화방 자료로 저장하면, myAI는 이를 AI 생성 자료로 표시하고 이후 대화에서 다시 분석·조회할 수 있게 한다. 사용자는 Markdown 문법을 몰라도 일반 문서처럼 편집하고, 자료·답변·보고서·표·브리핑을 하나의 노트북형 업무 지식 흐름 안에서 계속 재사용할 수 있다.
```

This is the next major step toward a NotebookLM-inspired myAI.
