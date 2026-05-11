# PRD: Legal Compliance Review and Evidence Report

> **Implementation status — MVP shipped.** All 12 acceptance-criteria items in
> section 19 are met. The deferred items below are flagged in-place with
> `Status:` callouts.
>
> | Track | Status |
> |---|---|
> | Backend module (`server/compliance/`) | ✅ `complianceTypes.js`, `complianceIntent.js`, `compliancePrompt.js` (the optional `complianceContextBuilder.js` / `complianceReport.js` / `complianceApi.js` files in §10.1 were folded into `lawContextBuilder.buildComplianceLawContext` and the existing export pipeline) |
> | Intent / review-type classification | ✅ 7 types (privacy, civil_complaint, contract_outsourcing, audit, administrative_procedure, internal_rule, general) |
> | Chat orchestration (`server/ollama.js`) | ✅ Guard rails for missing internal material / missing `LAW_OC`; parallel `compliance` envelope in `X-Notebook-Meta`; notebook RAG query override |
> | Law context branch (`server/law/lawContextBuilder.js`) | ✅ `department_legal_review` mode carries `reviewType` / `outputStyle` / `focusLawNames`; tier 1–3 retrieval; detailed-report mode pulls precedents/해석례/admin-rules/ordinances |
> | Frontend launcher + source panel | ✅ `#complianceReviewButton` in the material panel pre-fills a compliance prompt; source panel uses an "내부 자료" group when `compliance.mode === "department_legal_review"`; short disclaimer renders via `renderLawDisclaimer` |
> | Tests | ✅ `scripts/compliance-unit-test.mjs` (npm `test:law:compliance` / `test:compliance`) — 6 cases: review-type classification, intent fields, prompt construction, query expansion, LAW_OC missing, metadata shape. ❌ Smoke + Playwright coverage for compliance scenarios still pending. |
> | Future phases (Phase 2 modal, Phase 3 report exporter, Phase 4 impact review, Phase 6 checklist) | ❌ Not started — Phase 5 KG legal integration **was completed in a separate cycle** (see `docs/KOREAN_LAW_ENGINE.md`, Knowledge graph track) |

## 1. Purpose

Build a public-sector focused kick function for myAI:

```text
법령 적합성 검토 + 근거 보고서 생성
```

This feature lets a user select a department notebook or upload a document, choose a review type, and ask myAI to compare internal material against official Korean legal sources. The output must separate internal evidence from official legal evidence, identify gaps or risks, and produce an export-ready evidence report.

This is the flagship function that positions myAI as a public-sector AI knowledge system, not just a document chatbot.

## 2. Product Identity

myAI should be positioned as:

```text
An on-premise public-sector AI knowledge system that connects internal agency documents with official Korean law, precedents, interpretations, administrative rules, ordinances, and knowledge graphs to produce cited answers, compliance reviews, checklists, and evidence reports.
```

The feature must demonstrate four strengths already present in myAI:

```text
1. Department notebook RAG
2. Korean Law Engine
3. Source-separated citation rendering
4. Exportable answer/report generation
```

## 3. Feature Name

User-facing Korean name:

```text
법령 적합성 검토
```

Optional English/internal name:

```text
Compliance Review
```

Export/report name:

```text
근거 보고서
```

Recommended UI label:

```text
[법령 적합성 검토]
```

## 4. Core User Story

As a public-sector officer, I want to check whether an internal guideline, civil complaint response, contract document, task manual, or department notebook content complies with relevant laws and official interpretations, so that I can identify legal risks, missing clauses, and recommended corrections with evidence.

Example prompts:

```text
이 개인정보 처리 위탁 지침이 개인정보보호법에 맞는지 검토해줘.
이 민원 답변서가 행정절차법상 문제가 없는지 봐줘.
이 용역 과업지시서에 개인정보/보안 관련 누락 조항이 있는지 검토해줘.
이 내부 규정이 상위 법령과 충돌하는 부분을 찾아줘.
이 감사 지적사항에 대한 재발방지 대책이 관련 법령에 부합하는지 확인해줘.
```

## 5. Non-Goals for MVP

MVP must not attempt to solve every legal-review case.

Do not implement in MVP:

```text
- automatic legal advice beyond evidence-based information
- user-specific legal strategy
- litigation strategy
- fully autonomous final approval of documents
- automatic modification of source notebooks
- separate legal KG store
- complex multi-step action_plan mode
```

The feature produces a review draft and evidence report, not a final legal opinion.

## 6. Existing myAI Capabilities To Reuse

Reuse existing systems rather than duplicating infrastructure.

### 6.1 Department notebook RAG

Use existing department notebook retrieval to collect internal evidence.

Relevant existing concepts:

```text
notebookId
notebook citations [N1]
NOTEBOOK_QUERY_BUDGET
source panel
X-Notebook-Meta
```

### 6.2 Korean Law Engine

Use existing native law engine under `server/law/`:

```text
/api/law/article
/api/law/search
/api/law/verify-citations
/api/law/precedents/search
/api/law/interpretations/search
/api/law/admin-rules/search
/api/law/ordinances/search
/api/law/history
/api/law/article/diff
```

Legal evidence must remain separate from internal evidence:

```text
[N] internal notebook/document evidence
[L] statute article evidence
[P] precedent evidence
[I] interpretation evidence
[R] admin-rule evidence
[O] ordinance evidence
[W] web evidence, if explicitly requested
```

### 6.3 Export system

Use existing answer export flows for:

```text
MD
PDF
DOCX
HWPX
XLSX
```

The feature should initially produce a structured answer that can be exported through current message actions. Later phases may add a dedicated report template.

### 6.4 Access control

Follow existing notebook read-access rules.

```text
If the user cannot read a department notebook, they cannot run compliance review against it.
Super may read all notebooks.
ADMIN_TOKEN is not a notebook-read identity.
```

## 7. Review Types

MVP should expose a small set of review types. Each type provides query hints, law search hints, and output emphasis.

### 7.1 Review type list

```js
[
  {
    id: "privacy",
    label: "개인정보",
    description: "개인정보 수집, 이용, 제공, 위탁, 보관, 파기 관련 검토"
  },
  {
    id: "civil_complaint",
    label: "민원 답변",
    description: "민원 답변의 법적 근거, 표현 위험, 불복/구제절차 안내 검토"
  },
  {
    id: "contract_outsourcing",
    label: "계약/용역",
    description: "용역, 위탁, 보안, 개인정보, 성과물 귀속, 수탁자 의무 검토"
  },
  {
    id: "audit",
    label: "감사/점검",
    description: "감사 지적 위험, 증빙, 재발방지 대책, 점검 체크리스트 검토"
  },
  {
    id: "administrative_procedure",
    label: "행정절차",
    description: "처분, 통지, 의견제출, 청문, 불복절차, 기간 준수 검토"
  },
  {
    id: "internal_rule",
    label: "내부 규정/지침",
    description: "상위 법령, 행정규칙, 조례와의 충돌·누락·개정 필요성 검토"
  }
]
```

### 7.2 Review type behavior

Each review type should influence:

```text
- default legal search queries
- output sections
- risk categories
- checklist items
- report title
```

Do not hard-code legal conclusions. Use review type only as retrieval and formatting hints.

## 8. User Experience

### 8.1 Entry points

Provide two entry points.

#### A. Chat prompt activation

If a user asks a compliance-style question while a department notebook or uploaded document is active, the system should detect `department_legal_review` mode.

Examples:

```text
이 문서가 개인정보보호법에 맞는지 검토해줘.
이 내부 규정이 상위 법령과 충돌하지 않는지 봐줘.
이 민원 답변서의 법적 리스크를 검토해줘.
```

#### B. Explicit UI action

Add a button or menu item near the material context controls:

```text
+ 또는 자료 패널 → 법령 적합성 검토
```

This opens a small modal.

### 8.2 Review modal

Fields:

```text
검토 대상:
- 현재 선택된 부서노트북
- 현재 업로드 문서
- 직접 붙여넣은 텍스트, later phase

검토 유형:
- 개인정보
- 민원 답변
- 계약/용역
- 감사/점검
- 행정절차
- 내부 규정/지침

중점 법령, optional:
- 예: 개인정보 보호법, 행정절차법, 민법 제750조

추가 질문, optional:
- 예: 위탁계약서 필수 조항 누락 여부를 중점적으로 봐줘.

출력 형식:
- 요약 검토
- 상세 근거 보고서
```

MVP may skip the modal and rely on chat prompt activation, but the implementation should prepare the data contract so the modal can be added later.

### 8.3 Processing indicator

When active, the chat should show a distinct processing indicator:

```text
공식 법령과 내부 자료를 대조하는 중...
```

If law.go.kr is not configured:

```text
법령 적합성 검토를 실행하려면 LAW_OC 설정이 필요합니다.
```

## 9. System Behavior

### 9.1 High-level flow

```text
User prompt or UI review request
-> determine review type and target material
-> retrieve internal evidence from notebook/uploaded documents
-> detect or infer relevant legal topics
-> call Korean Law Engine
-> build separated evidence context
-> generate structured compliance review
-> attach metadata and citations
-> render report-style answer
-> allow export
```

### 9.2 Evidence separation rule

Never merge evidence families.

Output and metadata must preserve:

```text
Internal evidence:
[N1], [N2], uploaded file references

Official legal evidence:
[L1] statute
[P1] precedent
[I1] interpretation
[R1] admin rule
[O1] ordinance

Web evidence:
[W1], only if explicitly requested
```

### 9.3 No citation, no finding

Every risk, compliance gap, or recommendation must be supported by at least one internal evidence citation or one official legal citation.

Allowed unsupported content:

```text
- high-level summary
- explanation of methodology
- clear statement that evidence is insufficient
```

Not allowed without citation:

```text
- “위반 가능성이 큽니다”
- “법령상 반드시 필요합니다”
- “해당 조항은 누락되어 있습니다”
```

### 9.4 Legal disclaimer

This mode must use a short disclaimer, metadata-driven:

```js
disclaimer: "short"
```

Recommended text:

```text
이 검토는 제공된 내부 자료와 공식 법령 정보에 기반한 업무 참고용 검토이며, 최종 법률 판단은 관련 부서 또는 전문가 검토가 필요합니다.
```

The model should not generate its own custom disclaimer.

## 10. Backend Architecture

### 10.1 New module

> **Status: ✅ shipped.** Three files present:
>
> ```text
> server/compliance/complianceTypes.js   ✅ REVIEW_TYPES catalog + getReviewType + buildComplianceSearchQuery + COMPLIANCE_DISCLAIMER + COMPLIANCE_FINDING_LABELS
> server/compliance/complianceIntent.js  ✅ classifyComplianceIntent + classifyReviewType + extractFocusLawNames
> server/compliance/compliancePrompt.js  ✅ buildCompliancePromptBlock (summary + detailed_report) + buildComplianceUnavailableMessage
> ```
>
> `complianceContextBuilder.js`, `complianceReport.js`, `complianceApi.js`
> were not added as separate files; their responsibilities live inside
> `server/law/lawContextBuilder.js#buildComplianceLawContext` and the existing
> export pipeline. This keeps the orchestration in one place while still
> isolating compliance-specific catalogs/prompts in `server/compliance/`.

### 10.2 Why separate from `server/law/`

`server/law/` owns official legal retrieval.

`server/compliance/` owns the orchestration that combines:

```text
internal material + legal sources + structured review template
```

Do not put compliance-specific output templates into `server/law/`.

### 10.3 Compliance request object

Internal shape:

```js
{
  mode: "department_legal_review",
  reviewType: "privacy" | "civil_complaint" | "contract_outsourcing" | "audit" | "administrative_procedure" | "internal_rule" | "general",
  target: {
    type: "notebook" | "uploaded_documents" | "mixed",
    notebookId: "",
    uploadedDocumentIds: []
  },
  userQuestion: "",
  focusLawNames: ["개인정보 보호법"],
  outputStyle: "summary" | "detailed_report"
}
```

### 10.4 Compliance result object

```js
{
  ok: true,
  mode: "department_legal_review",
  reviewType: "privacy",
  reportTitle: "개인정보 처리 위탁 지침 법령 적합성 검토",
  contextText: "...",
  citations: {
    notebook: [],
    law: [],
    precedent: [],
    interpretation: [],
    adminRule: [],
    ordinance: []
  },
  findings: [],
  disclaimer: "short",
  error: ""
}
```

MVP may generate findings inside the LLM answer rather than as structured JSON. However, metadata must still preserve citations.

## 11. Retrieval Strategy

### 11.1 Internal evidence retrieval

For department notebook:

```text
Use existing department RAG with the user prompt plus review-type query hints.
```

Recommended retrieval query composition:

```text
userQuestion
+ reviewType keywords
+ focusLawNames
+ required checklist terms
```

For uploaded documents:

```text
Use existing uploaded document context path.
```

### 11.2 Review type query hints

#### privacy

```text
개인정보 수집 이용 제공 위탁 재위탁 보유기간 파기 안전성 확보 수탁자 관리 감독 정보주체 동의
```

Suggested law sources:

```text
개인정보 보호법
개인정보 보호법 시행령
개인정보의 안전성 확보조치 기준
```

#### civil_complaint

```text
민원 답변 처분 통지 불복 이의신청 행정절차 의견제출 처리기간 고지 안내
```

Suggested law sources:

```text
민원 처리에 관한 법률
행정절차법
행정심판법
```

#### contract_outsourcing

```text
용역 위탁 수탁자 계약 보안 성과물 개인정보 재위탁 손해배상 비밀유지
```

Suggested law sources:

```text
개인정보 보호법
국가계약법
지방계약법
전자정부법
```

#### audit

```text
감사 점검 증빙 재발방지 내부통제 책임 권한 기록 보관
```

Suggested law sources:

```text
공공감사에 관한 법률
감사원법
행정규칙
```

#### administrative_procedure

```text
처분 사전통지 의견제출 청문 이유제시 송달 기간 불복절차
```

Suggested law sources:

```text
행정절차법
행정심판법
행정소송법
```

#### internal_rule

```text
상위 법령 위임 근거 충돌 폐지 개정 인용 조문 시행일 서식 별표
```

Suggested law sources:

```text
사용자가 언급한 법령명 우선
내부 문서에서 추출된 법령명 우선
```

### 11.3 Legal retrieval strategy

Use a tiered approach.

#### Tier 1: Explicit law references

If the user or internal evidence contains explicit statute/article citations:

```text
verify citations
fetch article text
```

#### Tier 2: Review-type source hints

If no explicit article exists, search by review type and focus law names.

```text
searchLaw(focusLawNames)
article lookup if article detected
search admin rules for review-specific terms
```

#### Tier 3: Research expansion

For detailed reports, optionally query:

```text
precedents
interpretations
admin rules
ordinances
```

MVP should keep Tier 3 conservative to avoid noisy results.

### 11.4 Web search policy

Naver Search remains off by default when a notebook or uploaded document is active.

Exception:

```text
If the user explicitly asks for news/web coverage, Naver Search may run as a separate evidence family [W]. It must not be used to establish statute existence or article text.
```

## 12. Prompt Design

### 12.1 System instructions for compliance mode

Add a compliance-specific prompt block when `department_legal_review` mode is active.

```text
You are performing a public-sector compliance review.
Use only the provided internal evidence and official legal evidence.
Separate internal evidence from official legal evidence.
Do not invent statutes, articles, precedents, interpretations, or internal document content.
If evidence is insufficient, say exactly what is missing.
Every risk or recommendation must cite at least one evidence item.
Do not provide final legal advice; provide an evidence-based working review.
```

### 12.2 Required answer structure

For summary mode:

```text
## 검토 결과
- 적합 / 일부 보완 필요 / 추가 확인 필요 / 판단 보류 중 하나

## 핵심 판단
- 3~5개 bullet

## 주요 리스크 및 보완 권고
| 항목 | 내부 근거 | 법령 근거 | 판단 | 보완 권고 |

## 확인이 필요한 사항
- 부족한 자료나 추가 확인 필요 사항

## 출처
- source panel handles actual citation list
```

For detailed report mode:

```text
# 법령 적합성 검토 근거 보고서

## 1. 검토 개요
- 검토 대상
- 검토 유형
- 사용한 자료
- 한계

## 2. 내부 문서 기준
- 내부 지침/문서에서 확인된 주요 내용

## 3. 공식 법령 기준
- 관련 법령 조문
- 판례/해석례/행정규칙/자치법규, if used

## 4. 대조 결과
| 검토 항목 | 내부 자료 내용 | 공식 근거 | 판단 | 리스크 |

## 5. 보완 권고
| 우선순위 | 보완 사항 | 근거 | 제안 문구 |

## 6. 체크리스트
- [ ] 항목

## 7. 추가 확인 필요 사항

## 8. 참고 고지
short disclaimer
```

### 12.3 Finding labels

Use only these labels:

```text
적합
일부 보완 필요
충돌 가능성
근거 부족
추가 확인 필요
판단 보류
```

Avoid absolute labels like:

```text
위법 확정
무효 확정
반드시 위반
```

unless the supplied legal evidence explicitly says so.

## 13. Frontend Requirements

### 13.1 Minimal MVP

MVP may rely on chat.

When a compliance review is detected:

```text
- show Korean Law Engine processing indicator
- render structured answer
- show source panel with separated groups
- render short disclaimer
- allow export from message action menu
```

### 13.2 Review launcher, recommended

Add a small action in the material panel:

```text
법령 적합성 검토
```

When clicked, generate a prefilled prompt:

```text
현재 자료를 기준으로 [검토유형] 법령 적합성 검토를 수행해줘. 내부 근거와 공식 법령 근거를 분리하고, 리스크와 보완 권고를 표로 정리해줘.
```

This avoids building a full modal at first.

### 13.3 Later modal

Add modal after MVP if needed.

Fields:

```text
검토 유형
중점 법령
추가 질문
출력 형식
```

### 13.4 Source panel

Ensure source panel groups display:

```text
내부 문서/부서노트북
법령
판례
해석례
행정규칙
자치법규
웹
```

## 14. Metadata Requirements

> **Status: ✅ shipped.** The shape below matches what `server/ollama.js#buildComplianceMeta`
> emits and what `public/modules/chat.js` consumes for source-panel grouping
> and disclaimer rendering. The `compliance.error` field carries
> `"NO_INTERNAL_MATERIAL"`, `"LAW_NOT_CONFIGURED"`, or `"NO_LEGAL_EVIDENCE"`
> in the corresponding guard-rail paths.

Extend `X-Notebook-Meta` with a compliance section.

```js
compliance: {
  ok: true,
  mode: "department_legal_review",
  reviewType: "privacy",
  outputStyle: "summary",
  title: "개인정보 법령 적합성 검토",
  disclaimer: "short",
  evidenceFamilies: ["notebook", "law", "admin_rule"],
  error: ""
}
```

Law citations should continue to live under `law` metadata. Do not duplicate the full citation arrays under `compliance`.

## 15. Backend Integration Points

### 15.1 `server/ollama.js`

Likely integration point for chat prompt construction.

Required behavior:

```text
- detect compliance review intent
- build law context through `lawContextBuilder`
- build internal notebook/uploaded document context through existing path
- inject compliance prompt block
- attach compliance metadata to X-Notebook-Meta
```

### 15.2 `server/law/lawContextBuilder.js`

Current `department_legal_review` mode already exists. Extend it to support:

```text
- reviewType
- focusLawNames
- outputStyle
- review type query hints
- richer legal research when detailed_report is requested
```

Do not break existing law_article / legal_research modes.

### 15.3 `server/law/lawIntent.js`

Extend detection to classify review type.

Examples:

```text
개인정보 처리 위탁 -> privacy
민원 답변 -> civil_complaint
용역/위탁/계약 -> contract_outsourcing
감사/점검/재발방지 -> audit
처분/통지/의견제출/청문 -> administrative_procedure
내부 규정/지침/상위 법령 -> internal_rule
```

If no type is clear:

```text
reviewType = "general"
```

### 15.4 Export

MVP can use existing export. Later add dedicated report export template.

Potential future file:

```text
server/exportComplianceReport.js
```

## 16. Data Safety and Logging

### 16.1 External API privacy

When calling law.go.kr:

```text
- send only normalized law names, article refs, and search terms
- do not send full internal document text
- do not send full user prompt unless necessary for citation verification, and even then prefer extracted citations
```

### 16.2 Logs

Do not log:

```text
- full internal document text
- full user prompt when it contains internal material
- API keys
- upstream OC parameter
- full upstream URL
```

Safe log shape:

```js
{
  tool: "compliance_review",
  reviewType: "privacy",
  hasNotebook: true,
  hasDocuments: false,
  legalTools: ["article", "admin_rules"],
  citationCounts: { notebook: 3, law: 2, adminRule: 1 },
  latencyMs: 1234,
  errorMarker: ""
}
```

## 17. Error Handling

### 17.1 Law engine not configured

If `LAW_OC` is missing:

```text
- do not run fake compliance review
- explain that official law lookup is unavailable
- internal document summary may still be possible, but mark legal review as unavailable
```

Response guidance:

```text
공식 법령 조회 설정이 없어 법령 적합성 검토를 완료할 수 없습니다. LAW_OC 설정 후 다시 실행하세요.
```

### 17.2 Internal evidence missing

If no notebook/uploaded document is active:

```text
검토할 내부 자료가 필요합니다. 부서노트북을 선택하거나 문서를 업로드한 뒤 다시 실행하세요.
```

### 17.3 Law evidence missing

If internal evidence exists but law lookup returns no law evidence:

```text
관련 공식 법령 근거를 확인하지 못했습니다. 법령명이나 조문을 명시해 다시 요청하세요.
```

### 17.4 Conflicting evidence

If internal document and law evidence conflict, do not overstate.

Use:

```text
충돌 가능성
추가 확인 필요
```

and cite both sides.

## 18. Testing Plan

### 18.1 Unit tests

> **Status: ✅ shipped.** Implemented in `scripts/compliance-unit-test.mjs`,
> wired into `npm run test:compliance` and bundled into `npm run test:law`
> (see `package.json` scripts). Six cases cover review-type classification,
> intent compliance fields, prompt construction, query expansion, LAW_OC
> missing handling, and the metadata shape.

Add tests for:

```text
review type classification          ✅ testReviewTypeClassification
compliance prompt construction      ✅ testCompliancePromptConstruction
metadata shape                      ✅ testComplianceLawContextShape
safe logging shape                  ⚠️  not directly asserted — re-uses existing API key masking tests
LAW_OC missing handling             ✅ testLawOcMissing
```

Suggested script:

```text
scripts/compliance-unit-test.mjs    ✅ implemented
```

Add npm script:

```json
"test:compliance": "node scripts/compliance-unit-test.mjs"  ✅ wired
```

### 18.2 Smoke tests

> **Status: ❌ not yet added.** `scripts/smoke-test.mjs` doesn't have a
> compliance-specific path. `npm run test:law` covers the unavailable-message
> contract via the unit test, but a true HTTP-layer assertion would be a
> useful follow-up.

Extend smoke test:

```text
- with LAW_OC missing, compliance request returns structured unavailable message
- no API key/cache path leak
```

### 18.3 Live tests, optional

> **Status: ❌ not yet added.** Documented for future work.

With `MYAI_SMOKE_LAW_LIVE=1` and LAW_OC configured:

```text
- prompt: 현재 자료를 기준으로 개인정보 법령 적합성 검토를 수행해줘
- assert X-Notebook-Meta has compliance.mode = department_legal_review
- assert law metadata contains at least one citation when prompt includes 개인정보 보호법 제26조
```

### 18.4 Frontend tests

> **Status: ❌ not yet added.** No Playwright coverage in this repo yet.

When Playwright coverage is available:

```text
- select notebook
- click 법령 적합성 검토 launcher
- send generated prompt
- verify processing indicator
- verify source panel groups [N] and [L]
- verify disclaimer rendering
```

## 19. Acceptance Criteria

> **Status: ✅ MVP shipped — all 12 items met.**

| # | Criterion | Status | Where |
|---|---|---|---|
| 1 | User can trigger compliance review from chat with active notebook or uploaded document | ✅ | `#complianceReviewButton` launcher + `prefillComplianceReviewPrompt()` in `public/app.js`; chat prompt also works via `classifyComplianceIntent` |
| 2 | System detects `department_legal_review` mode | ✅ | `server/law/lawIntent.js` branch wired to `classifyComplianceIntent` |
| 3 | Classifies review type for privacy / civil_complaint / contract_outsourcing / audit / administrative_procedure / internal_rule / general | ✅ | `REVIEW_TYPES` in `server/compliance/complianceTypes.js` + `classifyReviewType` |
| 4 | Internal and legal evidence retrieved separately | ✅ | `searchNotebook` for internal; `buildComplianceLawContext` for legal; never merged |
| 5 | Answer follows required compliance-review structure | ✅ | `buildCompliancePromptBlock` injects `summary` or `detailed_report` template |
| 6 | Source panel separates [N] internal from [L]/[P]/[I]/[R]/[O] legal | ✅ | `groupCitationsByType` in `public/modules/chat.js` w/ "내부 자료" label when compliance mode is active |
| 7 | Short metadata-driven disclaimer | ✅ | `disclaimerForLawMode("department_legal_review")` → `"short"`; `renderLawDisclaimer` renders the standard text |
| 8 | Missing LAW_OC → structured unavailable response | ✅ | `server/ollama.js` guard rail emits `buildComplianceUnavailableMessage("law_not_configured")` + `compliance.error: "LAW_NOT_CONFIGURED"` |
| 9 | Missing internal material → "검토 대상 필요" | ✅ | `server/ollama.js` guard rail emits `buildComplianceUnavailableMessage("no_internal_material")` + `compliance.error: "NO_INTERNAL_MATERIAL"` |
| 10 | Existing `law_article` / `legal_research` / `verify_citations` modes still pass | ✅ | `npm run test:law` green (intent eval + parser + unit + kg + compliance suites) |
| 11 | Export actions can export the generated answer | ✅ | Uses the standard message-action export pipeline (MD/PDF/DOCX/HWPX/XLSX) — no compliance-specific code path needed for MVP |
| 12 | No `LAW_OC` / upstream `OC=` / cache path leak | ✅ | `maskLawSecrets`, `stripLawPrivateFields`, smoke test for `/api/law/status` |

## 20. Implementation Sequence for AI Agent

> **Status: ✅ all steps complete.** Retained below for historical record /
> onboarding context.

Follow this sequence.

```text
 1. Read docs/KOREAN_LAW_ENGINE.md and this PRD.                                        ✅
 2. Inspect current lawContextBuilder.js department_legal_review path.                  ✅
 3. Inspect server/ollama.js prompt and X-Notebook-Meta assembly.                       ✅
 4. Inspect frontend source panel and disclaimer rendering.                             ✅
 5. Add server/compliance/complianceTypes.js with review types and query hints.         ✅
 6. Add compliance review-type classification to lawIntent.js or new complianceIntent.  ✅ classifyComplianceIntent → consumed by detectLawIntent
 7. Extend lawContextBuilder.js to carry reviewType/outputStyle/focusLawNames.          ✅ buildComplianceLawContext
 8. Add compliance prompt block in server/ollama.js.                                    ✅ buildCompliancePromptBlock injected via lawContextBuilder
 9. Add compliance metadata to X-Notebook-Meta.                                         ✅ buildComplianceMeta + compliance envelope alongside law
10. Add minimal frontend launcher or generated prompt action.                           ✅ #complianceReviewButton in material panel
11. Add tests for classification and metadata shape.                                    ✅ scripts/compliance-unit-test.mjs (6 cases)
12. Run npm run test:law and npm run test:smoke.                                        ✅ both green
```

Do not start with a large modal or dedicated report exporter. First make the chat-based compliance review reliable.

## 21. Future Roadmap

### Phase 2: Dedicated compliance modal

> **Status: ❌ not started.** Chat-based launcher in section 13.2 ships as MVP.

Add full modal with review type, focus law, output style, and extra instruction fields.

### Phase 3: Dedicated report export template

> **Status: ❌ not started.** Generic export (MD / PDF / DOCX / HWPX / XLSX)
> already works against compliance answers; a compliance-specific layout
> remains future work.

Add report-specific DOCX/HWPX/PDF layout.

### Phase 4: Law change impact review

> **Status: ❌ not started.** The building-block endpoints
> (`/api/law/history`, `/api/law/article/at`, `/api/law/article/diff`) and
> the Studio Law Explorer "조문 이력" UI are live (see `docs/KOREAN_LAW_ENGINE.md`),
> but no compliance-side orchestration ties them to internal documents yet.

Use existing `/api/law/history`, `/api/law/article/at`, and `/api/law/article/diff` to find internal documents affected by law changes.

### Phase 5: Notebook KG legal integration

> **Status: ✅ shipped.** Implemented in the Knowledge Graph track of the
> Korean Law Engine. See `docs/KOREAN_LAW_ENGINE.md` "Knowledge graph track"
> for details on the deterministic `Statute`/`Article` harvester,
> `REFERS_TO_ARTICLE` cross-edges, `expandQueryWithGraph` surfacing
> `articleRefs`, and answer-time re-fetch via `buildLawContextFromArticleRefs`
> + `mergeLawContexts`. The implemented relation set differs slightly from
> the PRD sketch — `PART_OF` (Article → Statute) and `REFERS_TO_ARTICLE`
> (Concept/Rule/Procedure/… → Article) replace the proposed `CITES` /
> `BELONGS_TO` / `INTERPRETED_BY` / `APPLIED_IN` edge labels. The PRD
> constraint "do not create a parallel legal graph store" is honored —
> everything lives in `data/notebooks/<notebookId>/graph.sqlite`.

Extend existing notebook KG with legal nodes and CITES edges.

```text
Document chunk -> CITES -> Article            ✅ (via REFERS_TO_ARTICLE from chunk-derived entities)
Article -> BELONGS_TO -> Law                  ✅ (via PART_OF)
Article -> INTERPRETED_BY -> Interpretation   ❌ (interpretation citations not yet KG-linked)
Article -> APPLIED_IN -> Precedent            ❌ (precedent citations not yet KG-linked)
```

Do not create a parallel legal graph store.

### Phase 6: Audit checklist generator

> **Status: ❌ not started.** The `detailed_report` template already produces
> a checklist section in-prompt; a dedicated structured-output generator
> remains future work.

Generate checklist items from compliance review findings and legal evidence.

## 22. Final Product Statement

This feature should make myAI immediately understandable to public-sector users:

```text
부서 문서를 올리거나 부서노트북을 선택하면, myAI가 공식 법령·판례·해석례와 대조하여 적합성, 리스크, 보완 권고를 근거와 함께 보고서 형태로 정리한다.
```

That is the kick function for myAI as a public-sector AI knowledge system.
