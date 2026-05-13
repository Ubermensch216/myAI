# 분석 소스 배지 표시 설계

작성일: 2026-05-13

## 배경과 목표

현재 myAI의 채팅 UI는 AI가 응답을 생성할 때 사용자가 *어떤 자료를 검토하고 있는지*를 충분히 보여주지 않는다.

- "AI Thinking..." 카드는 네이버 검색 / Korean Law Engine 사용 시 그 사실을 표시하지만, **사용자가 선택한 프로젝트(notebook)** 와 **첨부 문서** 가 분석 입력으로 사용되고 있다는 정보는 표시되지 않는다.
- AI 답변 박스 상단에는 어떤 소스를 기반으로 답했는지 알리는 타이틀이 없다.
- 답변 박스 하단에는 이미 출처(citations) 패널이 있으나, 이는 *AI가 실제 인용한 근거*만 보여줄 뿐 *어떤 입력이 검토되었는지*는 별개의 관심사다.

본 설계는 (1) thinking 카드 상단과 (2) 답변 박스 상단에 **입력 소스 배지(source badges)** 행을 추가해 사용자가 매 응답마다 "어떤 자료가 검토되었는가"를 명시적으로 확인할 수 있게 한다. 기존 하단 출처(citations) 패널은 변경하지 않는다 — 입력 소스와 인용 근거는 서로 다른 정보로 분리해 표시한다.

## 핵심 결정사항

| # | 결정 | 사유 |
|---|---|---|
| Q1 | "입력 소스(상단)"와 "인용 근거(하단)"를 명확히 분리해 표시한다 | 사용자가 thinking 단계와 답변 도입부에서 알고 싶은 것은 *어떤 자료를 보고 있는가*, 답변 끝에서 알고 싶은 것은 *무엇을 근거로 결론을 냈는가* — 서로 다른 관심사 |
| Q2 | thinking 시작 시 prompt 키워드 기반 추정 + 서버 응답 헤더로 확정 (guessed → confirmed 전환) | UX 응답성과 정확성 균형. 추정이 빗나가도 confirmed 단계와 하단 citations로 진실 확인 가능 |
| Q3 | 배지(pill) 나열 형태, 별도 라벨 없음. 모든 소스가 비어있으면 행 자체 생략 | 시각적 스캔이 빠르고, 일반 대화 시 노이즈 방지 |
| Q4 | 답변 완료 시 `assistantMessage.sources`에 가벼운 스냅샷 저장 (notebook 이름, 첨부 파일명 포함) | 히스토리 재로드 시 정확한 시점의 입력 표시. 저장 페이로드 영향 최소 |

## 데이터 모델

### InputSources 객체

thinking 카드와 답변 박스가 공유하는 표현:

```js
{
  notebook: { id: string, name: string } | null,
  documents: Array<{ id: string, displayName: string }>,
  images: Array<{ id: string, displayName: string }>,
  naverSearch: "guessed" | "confirmed" | null,
  lawEngine: "guessed" | "confirmed" | null
}
```

- `guessed`: prompt 키워드 기반 추정. thinking 카드에서만 사용.
- `confirmed`: 서버 응답 헤더 `X-Notebook-Meta`로 실제 사용 확정.
- 모든 필드가 비어있으면 (`notebook=null`, `documents=[]`, `images=[]`, naver/law 모두 null) → 렌더링 생략.

### 영속화

답변 완료 시점에 최종 sources를 `assistantMessage.sources`에 저장:

```js
assistantMessage.sources = {
  notebook: { id, name } | null,
  documents: [...],
  images: [...],
  naverSearch: "confirmed" | null,   // guessed로 끝났으면 null로 정리
  lawEngine:   "confirmed" | null
};
```

- 추정만 하고 서버에서 사용 미확정 → `null`로 정리 (실제 안 쓴 것이므로 히스토리에 표시하지 않음).
- 노트북 이름은 스냅샷 시점 값 그대로 저장 (이후 노트북 이름이 바뀌거나 삭제되어도 *그 시점의 진실* 보존).

## 렌더링 위치

### (1) Thinking 카드 상단

기존 dots/text 행 *위에* 새 행 `.thinking-sources` 추가:

```
[📚 인사규정 노트] [📎 보고서.pdf] [🌐 네이버 검색]   ← 새 배지 행 (있을 때만)
●●● Thinking…                                       ← 기존 dots/text 행
▷ 처리 단계 보기                                     ← 기존 details
```

- `guessed` 상태 배지는 `.source-badge-guessed` 적용 (opacity 0.55 + dashed border)
- 서버 응답 헤더 수신 시 `updateThinkingSources(thinking, notebookMeta)` 호출 → 확정/제거 처리

### (2) 답변 박스 상단

`appendMessage` 내부, `meta` 다음·`body` 이전에 `.message-sources` 행 추가:

```
[👤 사용자명]
[📚 인사규정 노트] [📎 보고서.pdf] [🌐 네이버 검색]   ← 새 행 (확정 상태만)
답변 본문...
```

- 라이브 응답: 헤더 도착 후 최종 sources 생성하여 `renderSourceBadges(host, sources, {variant:"message"})` 호출.
- 히스토리 재렌더: `appendMessage` 옵션 `sources`가 들어오면 즉시 렌더.

### (3) 답변 박스 하단

기존 `renderCitationsPanel`("출처" 섹션) 그대로 유지. **변경 없음.**

### 클릭 동작

- 프로젝트 배지: `openNotebookSelector()` 호출하여 노트북 선택 다이얼로그를 연다.
- 문서/이미지/네이버/법령 배지: 비클릭 (정보 표시 전용).

## 함수 인터페이스

`public/modules/chat.js`에 추가:

```js
function buildInputSources(room, { lawProcessing, naverSearch })
// 반환: InputSources 객체

function mergeServerConfirmation(sources, notebookMeta)
// guessed → confirmed 전환, 서버 미사용 시 null로 정리, 서버 강제 선택된 notebook 보강
// 반환: 새 InputSources (불변)

function isEmptySources(sources)
// 모든 필드 비어있으면 true

function renderSourceBadges(host, sources, { variant })
// variant: "thinking" | "message"
// host 안 기존 .source-badges 제거 후 재생성
// 빈 sources면 아무것도 그리지 않음

function updateThinkingSources(thinking, notebookMeta)
// dataset에 저장된 sources를 merge한 뒤 renderSourceBadges 호출
```

## chat.js 통합 지점

| 위치 | 변경 |
|---|---|
| `requestTextAssistantResponse`의 `appendThinking(...)` 호출 (line ~370) | options에 `sources: buildInputSources(room, {lawProcessing, naverSearch})` 추가 |
| `appendThinking` 본문 (line ~1454) | dots/text 행 *앞에* `renderSourceBadges(wrapper, options.sources, {variant:"thinking"})` 호출, `wrapper.dataset.sources = JSON.stringify(options.sources)` 저장 |
| 응답 헤더 수신부 (line ~400) | `notebookMeta` 받은 직후 `updateThinkingSources(thinking, notebookMeta)` 호출 |
| 응답 완료 / `assistantMessage` 구성 (line ~435-449) | thinking 시작 시 `dataset.sources`에 JSON으로 저장해 둔 initialSources를 parse → `const finalSources = mergeServerConfirmation(initialSources, notebookMeta);` → `assistantMessage.sources = finalSources` → `renderSourceBadges(assistant, finalSources, {variant:"message"})` |
| `appendMessage` 함수 (line ~774) | `options.sources` 있으면 `meta` append 직후 `renderSourceBadges(article, options.sources, {variant:"message"})` 호출 |
| `app.js`의 `renderMessages` 내 `appendMessage` 호출 (line ~428) | `sources: message.sources` 추가 |

`persistence.js`의 메시지 정리 함수에 `sources` 필드 화이트리스트 추가 필요 여부 확인.

## 아이콘과 시각 디자인

### 아이콘 (myAI 기존 line-style SVG 일관 사용 — 이모지 금지)

| 소스 | 아이콘 출처 |
|---|---|
| 프로젝트(notebook) | 기존 `ROOM_FILE_SVG.notebook` 재사용 |
| 문서(document) | 기존 `ROOM_FILE_SVG.paperclip` 재사용 |
| 이미지(image) | 새 `SOURCE_BADGE_SVG.image` (사진 프레임 + 산 모양, line-style) |
| 네이버 검색(naver) | 새 `SOURCE_BADGE_SVG.globe` (지구본, line-style) |
| 법령(law) | 새 `SOURCE_BADGE_SVG.scales` (저울, line-style) |

모두 24x24 viewBox, `fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"` 일관 적용. `aria-hidden="true"`.

### 배지 DOM 구조

```html
<span class="source-badge source-badge-notebook">
  <span class="source-badge-icon"><!-- inline SVG --></span>
  <span class="source-badge-label">인사규정 노트</span>
</span>
```

### CSS (public/styles.css 추가)

```css
.source-badges { display: flex; flex-wrap: wrap; gap: 6px; }
.message-sources { margin: 4px 0 10px; }
.thinking-sources { margin-bottom: 8px; }

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
.source-badge-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-badge-icon { display: inline-flex; width: 14px; height: 14px; flex-shrink: 0; }
.source-badge-icon svg { width: 100%; height: 100%; }

.source-badge-notebook { background: #e7f0ff; color: #1e40af; cursor: pointer; }
.source-badge-document { background: #eaf6ee; color: #166534; }
.source-badge-image    { background: #faf3e0; color: #854d0e; }
.source-badge-naver    { background: #e6f7ec; color: #047857; }
.source-badge-law      { background: #f3e8ff; color: #6b21a8; }

.source-badge-guessed { opacity: 0.55; border-style: dashed; border-color: currentColor; }
```

긴 파일명은 `text-overflow: ellipsis`로 잘리고 `title` attribute에 full name 보관.

## 엣지 케이스

| 케이스 | 처리 |
|---|---|
| 노트북 삭제되어 `findNotebookSummary`가 null | notebook 배지 미표시. 다른 소스만 표시. |
| `displayName` 누락 | `formatDisplayFileName` 폴백. 그래도 빈 문자열이면 항목 스킵. |
| 매우 긴 파일명 | CSS `max-width: 240px` + ellipsis. `title`로 full name. |
| 첨부 10개 이상 | 처음 5개 + `+N건` 라벨의 축약 배지 (document 아이콘 + "+N건" 텍스트). |
| 서버 헤더 파싱 실패 (`notebookMeta` null) | sources 그대로 통과. 추정 상태는 final 정리 시 null로. |
| 스트림 abort | thinking 카드 제거. assistant 메시지가 만들어졌다면 추정은 null로 정리. |
| 일반 대화 (모든 소스 빈) | 양쪽 배지 행 모두 미생성. |
| 과거 메시지 (sources 필드 없음) | 배지 행 미생성. 자연스러운 backward-compat. |
| 저장된 노트북 이름과 현재 이름이 다름 | 저장된 `sources.notebook.name` 그대로 사용 — 시점의 진실 보존. |

## XSS 안전성

- 사용자 입력값(`notebook.name`, 파일명) → `textContent`로만 삽입. innerHTML 미사용.
- SVG는 정적 상수 객체에서만 `innerHTML`로 삽입.

## 수동 테스트 시나리오

1. 노트북만 선택, 일반 질문 → thinking·message 상단 배지 1개 / 새로고침 후 history 재로드 시 message 배지 유지
2. 노트북 + 첨부 문서 2개 → 배지 3개
3. 첨부 문서만 (노트북 없음)
4. 일반 대화 (소스 없음) → 양쪽 배지 행 미생성
5. 법령 키워드 prompt → thinking 시작 시 법령 배지 guessed 스타일 → 서버가 law 사용 시 confirmed로 전환 → message에 표시
6. 법령 키워드지만 서버 미사용 → thinking에서 guessed로 보이다 응답 도착 시 배지 제거 → message에 없음
7. 노트북 삭제 후 과거 대화 열람 → 저장된 이름으로 배지 표시
8. 매우 긴 파일명 → ellipsis 동작 확인

## 범위 밖

- 다크 모드 변수 대응 (기존 다크 모드 인프라 확인 후 추후 처리)
- 자동화 단위 테스트
- 서버 측 `X-Notebook-Meta` 헤더 schema 변경 (현재 구조 그대로 소비)
- 답변 박스 하단 citations 패널 변경
