# 분석 소스 배지 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI Thinking 카드 상단과 답변 박스 상단에 "분석 입력 소스" 배지(프로젝트·첨부 문서·이미지·네이버·법령)를 표시하고, 답변 메시지에 영속화해 히스토리에서도 유지한다.

**Architecture:** 모든 추가 코드는 `public/modules/chat.js` 내부에 inline으로 작성 (브레인스토밍에서 합의된 접근법 1). SVG 아이콘 레지스트리 + 순수 헬퍼(`composeInputSources`, `mergeServerConfirmation`, `isEmptySources`) + DOM 헬퍼(`renderSourceBadges`, `updateThinkingSources`, `buildInputSources`)를 추가. CSS는 `public/styles.css`에 새 클래스. 답변 완료 시 `assistantMessage.sources` 스냅샷 저장.

**Tech Stack:** Vanilla ES modules (no framework), inline SVG icons, CSS pill badges, browser-side DOM manipulation, encrypted localStorage via existing persistence.

**Reference spec:** [docs/superpowers/specs/2026-05-13-source-badges-design.md](../specs/2026-05-13-source-badges-design.md)

**Project test posture:** 프론트엔드 자동화 테스트 인프라 없음. 각 task의 검증은 **수동 브라우저 테스트** + 필요 시 `npm run test:smoke`.

---

## Task 1: SVG 레지스트리 + 순수 헬퍼 함수 추가

배지 렌더링에 사용할 line-style SVG 상수 3개와 순수 함수 3개를 chat.js 끝부분에 추가한다. 이 task는 UI 변경 없음 — 토대만 마련.

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (파일 맨 끝에 추가)

- [ ] **Step 1: chat.js 맨 끝에 SVG 레지스트리와 순수 헬퍼 추가**

다음 코드 블록을 `chat.js` 파일의 가장 마지막 export 함수 *다음*(파일 맨 끝)에 추가:

```js
// ===== Source badges (input sources) =====

const SOURCE_BADGE_SVG = {
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  scales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M5 8h14M5 8l-2 6a3 3 0 0 0 6 0L7 8M19 8l-2 6a3 3 0 0 0 6 0l-2-6M8 20h8"/></svg>'
};

const MAX_FILE_BADGES = 5;

function composeInputSources({ notebook, documents, images, lawProcessing, naverSearch }) {
  return {
    notebook: notebook ? { id: notebook.id, name: notebook.name || "" } : null,
    documents: Array.isArray(documents)
      ? documents.map((d) => ({ id: d.id, displayName: d.displayName || "" })).filter((d) => d.displayName)
      : [],
    images: Array.isArray(images)
      ? images.map((d) => ({ id: d.id, displayName: d.displayName || "" })).filter((d) => d.displayName)
      : [],
    naverSearch: naverSearch ? "guessed" : null,
    lawEngine: lawProcessing ? "guessed" : null
  };
}

function mergeServerConfirmation(sources, notebookMeta) {
  const next = {
    notebook: sources?.notebook ?? null,
    documents: Array.isArray(sources?.documents) ? sources.documents : [],
    images: Array.isArray(sources?.images) ? sources.images : [],
    naverSearch: sources?.naverSearch ?? null,
    lawEngine: sources?.lawEngine ?? null
  };
  const meta = notebookMeta || null;
  if (meta?.law?.ok) {
    next.lawEngine = "confirmed";
  } else if (next.lawEngine === "guessed") {
    next.lawEngine = null;
  }
  if (meta?.webSearch) {
    next.naverSearch = "confirmed";
  } else if (next.naverSearch === "guessed") {
    next.naverSearch = null;
  }
  if (meta?.notebook && !next.notebook) {
    next.notebook = { id: meta.notebook.id || "", name: meta.notebook.name || "" };
  }
  return next;
}

function isEmptySources(sources) {
  if (!sources) return true;
  if (sources.notebook) return false;
  if (Array.isArray(sources.documents) && sources.documents.length) return false;
  if (Array.isArray(sources.images) && sources.images.length) return false;
  if (sources.naverSearch) return false;
  if (sources.lawEngine) return false;
  return true;
}
```

- [ ] **Step 2: 구문 오류 확인을 위해 dev 서버 기동**

Run: `npm run dev`
Expected: 서버가 정상 기동되며 `c:/Dev/myAI/server/log/` 외에 에러 출력 없음. 브라우저로 `http://localhost:<port>` 열어 콘솔에 import 에러 없는지 확인.

- [ ] **Step 3: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js
git -C c:/Dev/myAI commit -m "feat(chat): add source-badge SVG registry and pure helpers"
```

---

## Task 2: DOM 렌더러 + CSS 추가

배지를 실제로 그리는 `renderSourceBadges` 함수와 CSS 스타일을 추가한다. 이 task도 UI 변경 없음 (호출처가 없음).

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (Task 1에서 추가한 섹션 아래에 이어서)
- Modify: `c:\Dev\myAI\public\styles.css` (파일 맨 끝에 추가)

- [ ] **Step 1: chat.js에 renderSourceBadges 추가**

Task 1에서 추가한 `isEmptySources` 함수 *바로 아래에* 추가:

```js
function appendBadgeIcon(host, svgKey) {
  const icon = document.createElement("span");
  icon.className = "source-badge-icon";
  icon.innerHTML = SOURCE_BADGE_SVG[svgKey] || "";
  host.append(icon);
}

function appendBadgeLabel(host, text, { title } = {}) {
  const label = document.createElement("span");
  label.className = "source-badge-label";
  label.textContent = text;
  if (title) label.title = title;
  host.append(label);
}

function buildSourceBadge({ kind, svgKey, text, title, guessed, onClick }) {
  const badge = document.createElement("span");
  badge.className = `source-badge source-badge-${kind}`;
  if (guessed) badge.classList.add("source-badge-guessed");
  appendBadgeIcon(badge, svgKey);
  appendBadgeLabel(badge, text, { title });
  if (onClick) {
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    badge.addEventListener("click", onClick);
    badge.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); }
    });
  }
  return badge;
}

function renderSourceBadges(host, sources, { variant }) {
  if (!host) return;
  const existing = host.querySelector(":scope > .source-badges");
  if (existing) existing.remove();
  if (isEmptySources(sources)) return;

  const row = document.createElement("div");
  row.className = `source-badges ${variant === "thinking" ? "thinking-sources" : "message-sources"}`;

  if (sources.notebook) {
    row.append(buildSourceBadge({
      kind: "notebook",
      svgKey: "notebook",
      text: sources.notebook.name || "프로젝트",
      title: sources.notebook.name || ""
    }));
  }

  const docs = Array.isArray(sources.documents) ? sources.documents : [];
  const visibleDocs = docs.slice(0, MAX_FILE_BADGES);
  for (const doc of visibleDocs) {
    row.append(buildSourceBadge({
      kind: "document",
      svgKey: "paperclip",
      text: doc.displayName,
      title: doc.displayName
    }));
  }
  const docOverflow = docs.length - visibleDocs.length;
  if (docOverflow > 0) {
    row.append(buildSourceBadge({
      kind: "document",
      svgKey: "paperclip",
      text: `+${docOverflow}건`,
      title: `첨부 문서 ${docs.length}건 중 ${docOverflow}건 더 있음`
    }));
  }

  const images = Array.isArray(sources.images) ? sources.images : [];
  const visibleImages = images.slice(0, MAX_FILE_BADGES);
  for (const img of visibleImages) {
    row.append(buildSourceBadge({
      kind: "image",
      svgKey: "image",
      text: img.displayName,
      title: img.displayName
    }));
  }
  const imgOverflow = images.length - visibleImages.length;
  if (imgOverflow > 0) {
    row.append(buildSourceBadge({
      kind: "image",
      svgKey: "image",
      text: `+${imgOverflow}건`,
      title: `이미지 ${images.length}건 중 ${imgOverflow}건 더 있음`
    }));
  }

  if (sources.naverSearch) {
    row.append(buildSourceBadge({
      kind: "naver",
      svgKey: "globe",
      text: "네이버 검색",
      guessed: sources.naverSearch === "guessed"
    }));
  }
  if (sources.lawEngine) {
    row.append(buildSourceBadge({
      kind: "law",
      svgKey: "scales",
      text: "공식 법령",
      guessed: sources.lawEngine === "guessed"
    }));
  }

  if (variant === "thinking") {
    host.prepend(row);
  } else {
    const meta = host.querySelector(":scope > .message-meta");
    if (meta) meta.after(row);
    else host.prepend(row);
  }
}
```

- [ ] **Step 2: styles.css 끝에 CSS 추가**

`c:\Dev\myAI\public\styles.css` 파일 맨 끝에 다음 블록 추가:

```css
/* ===== Source badges (analysis input) ===== */
.source-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.thinking-sources { margin-bottom: 8px; }
.message-sources { margin: 4px 0 10px; }

.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1.5;
  background: var(--surface-2, #eef1f5);
  color: var(--text-2, #4a5160);
  border: 1px solid transparent;
  max-width: 240px;
}
.source-badge-icon {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.source-badge-icon svg { width: 100%; height: 100%; }
.source-badge-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-badge-notebook { background: #e7f0ff; color: #1e40af; cursor: pointer; }
.source-badge-notebook:focus { outline: 2px solid #1e40af; outline-offset: 1px; }
.source-badge-document { background: #eaf6ee; color: #166534; }
.source-badge-image    { background: #faf3e0; color: #854d0e; }
.source-badge-naver    { background: #e6f7ec; color: #047857; }
.source-badge-law      { background: #f3e8ff; color: #6b21a8; }

.source-badge-guessed {
  opacity: 0.55;
  border-style: dashed;
  border-color: currentColor;
}
```

- [ ] **Step 3: dev 서버에서 컴파일 / 로드 확인**

Run: `npm run dev`
Expected: 정상 기동, 브라우저 콘솔에 syntax/import 오류 없음. UI 변화는 아직 없음.

- [ ] **Step 4: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js public/styles.css
git -C c:/Dev/myAI commit -m "feat(chat): add renderSourceBadges DOM helper and CSS"
```

---

## Task 3: appendThinking에 배지 와이어링 (추정 상태 표시)

`buildInputSources` 래퍼를 추가하고 `appendThinking`에서 배지 행을 카드 최상단에 그리도록 한다. 이 task부터 UI 변화 발생.

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (line ~370 호출부, line ~1454 함수 본문, Task 2 추가 영역 아래)

- [ ] **Step 1: buildInputSources 래퍼 추가 (Task 2 끝부분에 이어)**

Task 2의 `renderSourceBadges` 함수 *바로 아래에* 추가. notebook 모듈에서 `findNotebookSummary`를 import 해야 함.

먼저 chat.js 파일 상단(line ~12 부근 `import` 블록)에 다음 줄 추가:

```js
import { findNotebookSummary, openNotebookSelector } from "./notebook.js";
```

(이미 같은 모듈에서 다른 항목을 import하고 있다면 같은 import 구문에 합치고, 없으면 새 줄로 추가)

그 다음 `renderSourceBadges` 아래에:

```js
function buildInputSources(room, { lawProcessing, naverSearch }) {
  const notebookId = room?.selectedNotebookId || null;
  const notebookSummary = notebookId ? findNotebookSummary(notebookId) : null;
  const active = getActiveDocuments();
  const documents = active
    .filter((f) => f.kind === "document")
    .map((f) => ({ id: f.id, displayName: formatDisplayFileName(f) }));
  const images = active
    .filter((f) => f.kind === "image")
    .map((f) => ({ id: f.id, displayName: formatDisplayFileName(f) }));
  return composeInputSources({
    notebook: notebookSummary
      ? { id: notebookSummary.id, name: notebookSummary.name || "이름 없는 프로젝트" }
      : null,
    documents,
    images,
    lawProcessing: Boolean(lawProcessing),
    naverSearch: Boolean(naverSearch)
  });
}
```

- [ ] **Step 2: appendThinking 시그니처와 본문 수정**

`appendThinking` 함수(line ~1454)에서 다음 변경:

기존 코드 (line ~1454-1457):
```js
export function appendThinking(options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "thinking-card";
  if (options.lawProcessing) wrapper.classList.add("thinking-card-law");
```

변경 후:
```js
export function appendThinking(options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "thinking-card";
  if (options.lawProcessing) wrapper.classList.add("thinking-card-law");
  if (options.sources) {
    try { wrapper.dataset.sources = JSON.stringify(options.sources); }
    catch { wrapper.dataset.sources = "{}"; }
    renderSourceBadges(wrapper, options.sources, { variant: "thinking" });
  }
```

(즉 `if (options.lawProcessing) wrapper.classList.add("thinking-card-law");` 줄 *뒤에* 위 새 if 블록을 삽입)

- [ ] **Step 3: requestTextAssistantResponse 호출부에 sources 전달**

기존 코드 ([chat.js:368-371](../../../public/modules/chat.js#L368)):
```js
  const latestPrompt = getLastUserPrompt(room);
  const naverSearch = wantsExplicitWebSearch(latestPrompt);
  const lawProcessing = !naverSearch && shouldShowLawProcessing(latestPrompt);
  const thinking = appendThinking({ lawProcessing, naverSearch });
```

변경 후:
```js
  const latestPrompt = getLastUserPrompt(room);
  const naverSearch = wantsExplicitWebSearch(latestPrompt);
  const lawProcessing = !naverSearch && shouldShowLawProcessing(latestPrompt);
  const initialSources = buildInputSources(room, { lawProcessing, naverSearch });
  const thinking = appendThinking({ lawProcessing, naverSearch, sources: initialSources });
```

- [ ] **Step 4: dev 서버 기동 및 수동 검증**

Run: `npm run dev`

브라우저에서:
1. 프로젝트 미선택 + 첨부 없음으로 일반 질문 전송 → thinking 카드에 배지 행 **없음** 확인 (기존 동작 유지)
2. 프로젝트 1개 선택 후 질문 전송 → thinking 카드 상단에 파란 노트북 배지(프로젝트명) 표시
3. 첨부 문서 2개 + 프로젝트 1개 → 배지 3개 (프로젝트 + 문서 2개)
4. 법령 관련 키워드(`법령`, `조문`, `위반` 등) 포함 질문 → law 배지가 *흐린(guessed)* 점선 스타일로 표시
5. "네이버에서 검색해줘" 같은 질문 → 네이버 배지가 흐린 스타일

Expected: 모든 케이스에서 thinking 카드 최상단에 배지 행이 등장하거나(소스 있음) 등장하지 않음(소스 없음). 답변 박스 자체에는 아직 변화 없음.

- [ ] **Step 5: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js
git -C c:/Dev/myAI commit -m "feat(chat): show input source badges in thinking card"
```

---

## Task 4: 서버 응답 헤더로 guessed → confirmed 전환

`updateThinkingSources`를 추가해 서버 응답 헤더 수신 시점에 thinking 카드의 배지 상태를 확정으로 전환한다.

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (Task 3 추가 영역 아래; line ~400 헤더 수신부)

- [ ] **Step 1: updateThinkingSources 함수 추가**

Task 3의 `buildInputSources` 함수 *바로 아래에* 추가:

```js
function updateThinkingSources(thinking, notebookMeta) {
  if (!thinking) return;
  let current = null;
  try { current = JSON.parse(thinking.dataset.sources || "null"); } catch { current = null; }
  if (!current) return;
  const merged = mergeServerConfirmation(current, notebookMeta);
  try { thinking.dataset.sources = JSON.stringify(merged); }
  catch { /* ignore */ }
  renderSourceBadges(thinking, merged, { variant: "thinking" });
}
```

- [ ] **Step 2: 헤더 수신부에서 updateThinkingSources 호출**

기존 코드 ([chat.js:399-400](../../../public/modules/chat.js#L399)):
```js
    const notebookMeta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    if (notebookMeta?.law) updateThinkingLawStatus(thinking, notebookMeta.law);
```

변경 후 (한 줄 추가):
```js
    const notebookMeta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    updateThinkingSources(thinking, notebookMeta);
    if (notebookMeta?.law) updateThinkingLawStatus(thinking, notebookMeta.law);
```

- [ ] **Step 3: dev 서버에서 수동 검증**

Run: `npm run dev`

브라우저에서:
1. 법령 키워드 질문 전송 → thinking 시작 시 law 배지가 *guessed*(흐림/점선) → 서버 응답 헤더 도착 후 *confirmed*(선명/실선)로 전환
2. 법령처럼 보이지만 서버가 실제 law 미사용인 케이스(예: 일반 문장 안에 "법령" 단어만 포함) → 응답 도착 시 law 배지가 **제거**됨
3. "네이버에서 ~ 검색해줘" → naver 배지 guessed → confirmed로 전환
4. 일반 질문(추정 없음) → 변화 없음

Expected: thinking 카드의 추정 배지가 서버 응답 시점에 확정 스타일로 전환되거나 제거됨.

- [ ] **Step 4: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js
git -C c:/Dev/myAI commit -m "feat(chat): promote guessed source badges to confirmed on server response"
```

---

## Task 5: 답변 메시지에 배지 표시 + 영속화

답변 완료 시 `assistantMessage.sources`로 스냅샷 저장하고, 답변 박스 상단에 배지를 그린다. 히스토리 재로드 시에도 표시되도록 `appendMessage`와 `app.js`의 `renderMessages`를 함께 수정.

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (line ~435-449 응답 완료부, line ~774 appendMessage)
- Modify: `c:\Dev\myAI\public\app.js` (line ~428 renderMessages)

- [ ] **Step 1: 응답 완료 후 finalSources 계산 및 저장**

기존 코드 ([chat.js:434-449](../../../public/modules/chat.js#L434)):
```js
    const assistantMessage = { role: "assistant", content: finalAnswer, createdAt: new Date().toISOString() };
    const noEvidenceAnswer = isNoEvidenceAnswer(finalAnswer);
    if (allCitations.length && !noEvidenceAnswer) {
      assistantMessage.citations = allCitations;
      assistantMessage.notebook = notebookMeta?.notebook ?? null;
      if (notebookMeta?.webSearch) assistantMessage.webSearch = notebookMeta.webSearch;
    }
    if (notebookMeta?.law && !noEvidenceAnswer) assistantMessage.law = notebookMeta.law;
    if (notebookMeta?.compliance && !noEvidenceAnswer) assistantMessage.compliance = notebookMeta.compliance;
    if (!noEvidenceAnswer) {
      renderLawNoticePanel(assistant, notebookMeta?.law);
      renderCitationsPanel(assistant, allCitations, notebookMeta?.law, notebookMeta?.compliance);
      if (!allCitations.length) renderLawDisclaimer(assistant, notebookMeta?.law);
    }
```

변경 후 (assistantMessage 생성 *직전*에 finalSources 계산, 그 후 sources 저장 + 렌더 추가):
```js
    const finalSources = mergeServerConfirmation(initialSources, notebookMeta);
    const assistantMessage = { role: "assistant", content: finalAnswer, createdAt: new Date().toISOString() };
    const noEvidenceAnswer = isNoEvidenceAnswer(finalAnswer);
    if (allCitations.length && !noEvidenceAnswer) {
      assistantMessage.citations = allCitations;
      assistantMessage.notebook = notebookMeta?.notebook ?? null;
      if (notebookMeta?.webSearch) assistantMessage.webSearch = notebookMeta.webSearch;
    }
    if (notebookMeta?.law && !noEvidenceAnswer) assistantMessage.law = notebookMeta.law;
    if (notebookMeta?.compliance && !noEvidenceAnswer) assistantMessage.compliance = notebookMeta.compliance;
    if (!isEmptySources(finalSources)) assistantMessage.sources = finalSources;
    renderSourceBadges(assistant, finalSources, { variant: "message" });
    if (!noEvidenceAnswer) {
      renderLawNoticePanel(assistant, notebookMeta?.law);
      renderCitationsPanel(assistant, allCitations, notebookMeta?.law, notebookMeta?.compliance);
      if (!allCitations.length) renderLawDisclaimer(assistant, notebookMeta?.law);
    }
```

- [ ] **Step 2: appendMessage가 sources 옵션을 받도록 확장**

`appendMessage` 함수([chat.js:774](../../../public/modules/chat.js#L774)) 내부, `meta`를 article에 append한 직후 부분을 찾는다.

기존 코드 (line ~817-820):
```js
  article.append(meta, body);
  article.append(createMessageActions(article, role, options.createdAt));
  if (role === "assistant") renderFollowupSuggestions(article, options.suggestions);
```

변경 후 (article.append(meta, body) *다음*에 sources 렌더링 추가):
```js
  article.append(meta, body);
  if (role === "assistant" && options.sources) {
    renderSourceBadges(article, options.sources, { variant: "message" });
  }
  article.append(createMessageActions(article, role, options.createdAt));
  if (role === "assistant") renderFollowupSuggestions(article, options.suggestions);
```

(주의: `renderSourceBadges`는 `host.querySelector(":scope > .message-meta")` 다음에 행을 삽입하므로, article 안에 meta가 이미 있으면 적절한 위치에 들어감.)

- [ ] **Step 3: app.js의 renderMessages가 sources를 전달하도록 수정**

기존 코드 ([app.js:427-438](../../../public/app.js#L427)):
```js
  for (const [index, message] of room.messages.entries()) {
    appendMessage(message.role, message.content, {
      persist: false,
      messageIndex: index,
      suggestions: shouldRenderMessageSuggestions(message) ? message.suggestions : [],
      visualization: message.visualization,
      eventCards: message.eventCards,
      createdAt: message.createdAt,
      citations: message.citations,
      law: message.law,
      compliance: message.compliance
    });
  }
```

변경 후 (`sources: message.sources` 추가):
```js
  for (const [index, message] of room.messages.entries()) {
    appendMessage(message.role, message.content, {
      persist: false,
      messageIndex: index,
      suggestions: shouldRenderMessageSuggestions(message) ? message.suggestions : [],
      visualization: message.visualization,
      eventCards: message.eventCards,
      createdAt: message.createdAt,
      citations: message.citations,
      law: message.law,
      compliance: message.compliance,
      sources: message.sources
    });
  }
```

- [ ] **Step 4: dev 서버에서 수동 검증**

Run: `npm run dev`

브라우저에서:
1. 프로젝트 선택 + 첨부 문서 1개 + 일반 질문 전송 → 답변 박스 상단(사용자명 아래)에 프로젝트/문서 배지 표시
2. 답변 완료 후 페이지 새로고침 → 같은 대화방을 열면 *과거 답변에도* 배지가 그대로 표시됨
3. 일반 대화(소스 없음) → 답변 박스 상단에 배지 행 없음 (기존 룩과 동일)
4. 법령 키워드 + 서버가 실제 law 사용한 경우 → 답변 박스에 law 배지(선명)와 함께 하단 출처 패널도 표시
5. 법령 키워드 + 서버가 law 미사용 → 답변 박스에 law 배지 없음 (guessed → null로 정리됨)
6. 매우 긴 파일명의 첨부 → 배지가 240px 폭에서 ellipsis 처리, hover 시 title로 full name 표시
7. 첨부 문서 7개 → 처음 5개 + "+2건" 배지 표시
8. (회귀) 기존 citation 출처 패널(답변 박스 하단)은 변함없이 동작

Expected: 답변 박스 상단에 입력 소스 배지가 표시되고, 새로고침 후에도 유지되며, 기존 citation 패널은 영향 없음.

- [ ] **Step 5: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js public/app.js
git -C c:/Dev/myAI commit -m "feat(chat): persist and render input source badges on assistant messages"
```

---

## Task 6: 프로젝트 배지 클릭 핸들러

프로젝트 배지를 클릭하면 노트북 선택 다이얼로그(`openNotebookSelector`)를 연다.

**Files:**
- Modify: `c:\Dev\myAI\public\modules\chat.js` (Task 2의 `renderSourceBadges` 안 notebook 배지 생성부)

- [ ] **Step 1: notebook 배지에 onClick 핸들러 연결**

Task 2의 `renderSourceBadges` 내 notebook 배지 생성부:
```js
  if (sources.notebook) {
    row.append(buildSourceBadge({
      kind: "notebook",
      svgKey: "notebook",
      text: sources.notebook.name || "프로젝트",
      title: sources.notebook.name || ""
    }));
  }
```

변경 후 (onClick 추가):
```js
  if (sources.notebook) {
    row.append(buildSourceBadge({
      kind: "notebook",
      svgKey: "notebook",
      text: sources.notebook.name || "프로젝트",
      title: sources.notebook.name || "",
      onClick: () => { openNotebookSelector(); }
    }));
  }
```

(`openNotebookSelector`는 Task 3에서 이미 import 되어 있어야 함)

- [ ] **Step 2: dev 서버에서 수동 검증**

Run: `npm run dev`

브라우저에서:
1. 프로젝트 선택된 대화에서 thinking 카드의 노트북 배지 클릭 → 노트북 선택 다이얼로그가 열림
2. 답변 박스 상단의 노트북 배지 클릭 → 마찬가지로 다이얼로그 열림
3. 키보드: 노트북 배지에 Tab으로 포커스 → focus outline 표시 → Enter 키 → 다이얼로그 열림
4. 문서/이미지/네이버/법령 배지 클릭 → 동작 없음 (cursor: default, focus outline 없음)

Expected: 노트북 배지만 클릭 가능. 키보드 접근성 동작.

- [ ] **Step 3: 서버 정지 후 커밋**

```bash
git -C c:/Dev/myAI add public/modules/chat.js
git -C c:/Dev/myAI commit -m "feat(chat): open notebook selector on project badge click"
```

---

## Task 7: 전체 spec 시나리오 회귀 테스트 + smoke test

스펙의 8개 수동 테스트 시나리오를 한 번에 다 돌려서 회귀 없는지 확인.

**Files:** 없음 (검증 전용)

- [ ] **Step 1: dev 서버 기동**

Run: `npm run dev`

- [ ] **Step 2: spec의 수동 테스트 시나리오 8개 순차 검증**

각 시나리오는 브라우저에서 직접 실행:

1. **노트북만 선택, 일반 질문** → thinking·message 상단 배지 1개 / 새로고침 후 history 재로드 시 message 배지 유지
2. **노트북 + 첨부 문서 2개** → 배지 3개
3. **첨부 문서만 (노트북 없음)** → 배지에 노트북 없음, 문서만
4. **일반 대화 (소스 없음)** → 양쪽 배지 행 미생성 (기존 룩 유지)
5. **법령 키워드 prompt** → thinking 시작 시 법령 배지 guessed → 서버 law 사용 시 confirmed → message에 표시
6. **법령 키워드지만 서버 미사용** → thinking에서 guessed → 응답 도착 시 배지 제거 → message에 없음
7. **노트북 삭제 후 과거 대화 열람** → 저장된 이름으로 배지 표시 (이름이 stale일 수 있음 — 정상)
8. **매우 긴 파일명** → ellipsis + hover title 동작

Expected: 8개 모두 spec에 명시된 대로 동작. 회귀 없음.

- [ ] **Step 3: smoke 테스트 실행 (백엔드 변경 없으므로 통과해야 함)**

Run: `npm run test:smoke`
Expected: 통과 (기존 동작 회귀 없음 확인).

- [ ] **Step 4: 모든 변경 사항 git status 확인**

Run: `git -C c:/Dev/myAI status`
Expected: clean (모든 커밋 완료).

- [ ] **Step 5: 최종 시각 점검 (스크린샷 권장)**

이 task에서는 코드 변경 없으므로 추가 커밋 없음. 검증만 수행.

---

## Self-Review 결과

**Spec coverage:**
- 데이터 모델 → Task 1 (composeInputSources, mergeServerConfirmation, isEmptySources)
- 렌더링 위치 (1) thinking 카드 상단 → Task 3
- 렌더링 위치 (2) 답변 박스 상단 → Task 5
- 렌더링 위치 (3) 하단 citation 패널 유지 → Task 5의 검증 #8
- 클릭 동작 (프로젝트 → openNotebookSelector) → Task 6
- 함수 인터페이스(5종) → Task 1, 2, 3, 4 분산
- chat.js 통합 지점 6곳 → Task 3, 4, 5에서 모두 수정
- 아이콘 (line-style SVG, 이모지 금지) → Task 1의 SOURCE_BADGE_SVG
- CSS 배지 스타일 → Task 2
- 엣지 케이스 (긴 파일명 ellipsis) → Task 5 검증 #6
- 엣지 케이스 (10개 이상 첨부 → +N건) → Task 2 구현 + Task 5 검증 #7
- 엣지 케이스 (노트북 삭제) → Task 7 검증 #7
- 엣지 케이스 (서버 미사용 → guessed 정리) → Task 4 검증 + Task 5 검증 #5
- 엣지 케이스 (일반 대화 → 미생성) → Task 5 검증 #3
- 엣지 케이스 (sources 필드 없는 과거 메시지) → 자동 (옵션 미존재 시 분기 없음)
- XSS 안전성 (textContent only, SVG 정적 상수) → 구현 코드에서 보장
- 수동 테스트 8 시나리오 → Task 7에서 일괄 검증
- 영속화 (assistantMessage.sources) → Task 5
- 시점 진실 보존 (저장된 name 그대로) → Task 5 + Task 7 #7

모든 spec 요구사항이 task로 커버됨. 갭 없음.

**Placeholder scan:** 코드 블록은 모두 완전한 형태. "TBD", "추후", "비슷하게" 없음.

**Type consistency:** `InputSources` 필드명(`notebook`, `documents`, `images`, `naverSearch`, `lawEngine`) Task 1·2·3·4·5 전체에서 동일. 함수명(`composeInputSources`, `mergeServerConfirmation`, `isEmptySources`, `renderSourceBadges`, `buildInputSources`, `updateThinkingSources`)도 일관.

## 실행 핸드오프

Plan complete and saved to `docs/superpowers/plans/2026-05-13-source-badges.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
