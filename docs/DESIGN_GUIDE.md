# myAI 디자인 가이드

이 문서는 프로젝트 전반의 시각 언어와 컴포넌트 규칙을 정의한다.  
새 화면이나 컴포넌트를 추가할 때 반드시 여기서 정한 토큰·패턴을 따른다.

---

## 1. 디자인 토큰 (CSS 변수)

모든 색상·간격은 `styles.css` 최상단의 `:root` 변수를 참조한다. 하드코딩하지 않는다.

### 1-1. 색상

| 변수 | Light | Dark | 용도 |
|---|---|---|---|
| `--bg` | `#f5f7fb` | `#101418` | 앱 바깥 배경 |
| `--surface` | `#ffffff` | `#171d23` | 카드·패널 기본 배경 |
| `--surface-2` | `#eef3f8` | `#202832` | 입력·툴바 등 한 단계 낮은 배경 |
| `--surface-3` | `#fbfcfe` | `#12171d` | 사이드바·그래프 캔버스 배경 |
| `--ink` | `#17202a` | `#edf2f7` | 기본 텍스트 |
| `--muted` | `#667085` | `#aab6c3` | 보조 텍스트·아이콘 |
| `--line` | `#d8e0ea` | `#303a45` | 테두리·구분선 |
| `--accent` | `#0f766e` | `#2dd4bf` | 브랜드 대표색 |
| `--accent-dark` | `#115e59` | `#5eead4` | 액센트 강조·텍스트용 |
| `--accent-aux` | `#00a3e0` | `#38bdf8` | 보조 브랜드색 |
| `--danger` | `#b42318` | `#f97066` | 오류·삭제 |
| `--shadow` | `0 18px 45px rgba(20,36,58,.12)` | `0 18px 45px rgba(0,0,0,.32)` | 부상 요소 그림자 |

> **color-mix 패턴**: 투명도가 필요할 때 `rgba()` 대신 `color-mix(in srgb, var(--accent) N%, transparent)` 또는 `color-mix(in srgb, var(--accent) N%, var(--line))`을 사용한다. 다크 테마에서 자동으로 올바른 색이 나온다.

### 1-2. 컬러 테마

사용자가 테마를 변경하면 `:root[data-color-theme="..."]`로 `--accent`, `--accent-dark`, `--accent-aux` 세 변수만 교체된다.  
컴포넌트 코드에서 이 세 변수 외의 색을 테마별로 분기하지 않는다.

---

## 2. 타이포그래피

폰트 패밀리: `Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`  
`body`에 전역 설정되므로 개별 컴포넌트에서 재선언하지 않는다.

| 용도 | `font-size` | `font-weight` | 비고 |
|---|---|---|---|
| 섹션 제목 (h2) | `14px` | `700` | |
| 노드·카드 제목 (h3) | `13–14px` | `700` | |
| 본문·설명 | `13px` | `400–500` | `line-height: 1.5–1.6` |
| 레이블·캡션 | `12px` | `700` | `color: var(--muted)` |
| 배지·메타 | `10–11px` | `700–800` | 대문자+`letter-spacing: 0.04em` |
| 버튼 | `12–13px` | `700` | |

---

## 3. 레이아웃 그리드

앱 셸은 5-컬럼 그리드로 구성된다.

```
sidebar | resizer | chat-area | resizer | studio-panel
  340px     8px     minmax(0,1fr)  8px     360px
```

- 사이드바(`--left-panel-width`)·스튜디오(`--right-panel-width`) 폭은 CSS 변수로 관리하며, JS 드래그로 조정된다.
- `[hidden]`은 `display: none !important`로 강제하므로 JS에서 `.hidden = true`만 사용한다.

---

## 4. 공통 컴포넌트

### 4-1. 버튼

| 종류 | 클래스 | 크기 | 용도 |
|---|---|---|---|
| 기본(제출) | `.send-button` | `height: 38px`, `padding: 0 18px` | 주요 액션·폼 제출 |
| 보조 | `.ghost-button` | `min-height: 30px`, `padding: 0 10px` | 취소·보조 액션 |
| 아이콘 | `.icon-button` | `30px × 30px` | 아이콘만 있는 버튼 |

- `ghost-button`과 `icon-button`의 기본 스타일(border, radius, background, color)은 같다: `border: 1px solid var(--line)`, `border-radius: 6px`, `background: var(--surface)`, `color: var(--muted)`.
- 위험 동작(삭제 등)은 `.ghost-button.admin-danger-button` 수식어를 추가한다.

### 4-2. 텍스트 입력

```css
/* .text-input */
height: 38px;
border: 1px solid var(--line);
border-radius: 6px;
padding: 0 10px;
background: var(--surface);
color: var(--ink);
```

- `textarea`로 쓸 때는 `height: auto`로 재정의하고 `padding-top/bottom: 10px`를 더한다.
- 라벨: `.field-label` — `font-size: 12px; font-weight: 700; color: var(--muted); margin-bottom: 8px;`

### 4-3. 패널 박스 (`.panel`)

사이드바 섹션 등에 쓰이는 범용 카드.

```css
border: 1px solid var(--line);
border-radius: 8px;
background: var(--surface);
padding: 14px;
```

> 스튜디오 내부 박스는 이 `.panel`을 사용하지 않고 인라인 스타일로 정의한다 — 섹션 6 참조.

### 4-4. 다이얼로그 (`.settings-dialog`)

```
max-width: 680px; border-radius: 16px; padding: 0;
```

- 헤더(`.dialog-heading`): `h2 + 닫기 버튼`을 가로 배치.
- 하단 액션(`.dialog-actions`): 오른쪽 정렬, `ghost-button` + `send-button` 순.
- `<dialog>` 요소를 사용하며 `method="dialog"` 폼을 내부에 배치한다.

---

## 5. 인터랙션 규칙

- **hover**: `background`, `border-color` 전환. `transition: 0.12–0.15s`.
- **focus-visible**: `outline: none` + border나 box-shadow로 포커스 표시. `:focus` 대신 `:focus-visible`을 사용한다.
- **active/selected 상태**: `border-color: color-mix(in srgb, var(--accent) 45–55%, var(--line))` + `background: color-mix(in srgb, var(--accent) 7–12%, var(--surface))`.
- **busy/loading**: `aria-busy="true"` 속성 부여 + 버튼 텍스트 변경. 스피너가 필요하면 `::after` 가상 요소로 CSS 애니메이션 사용.
- **위험 동작**: hover 시 `background: #fff0ee; color: var(--danger)`.

---

## 6. 스튜디오 하위 패널 규칙

스튜디오 우측 패널에 새 도구를 추가할 때 따르는 세부 규칙.

### 6-1. 전체 구조

```
#studioContent (.studio-content)
  ├── .studio-tools-grid          ← 상단 탭 버튼 그리드 (공통, 수정 금지)
  ├── .studio-tool-panel.studio-[name]-panel
  └── ...
```

### 6-2. HTML 패턴

```html
<div id="studio[Name]Panel"
     class="studio-tool-panel studio-[name]-panel"
     data-tool-panel="[name]"
     hidden>
  <!-- 패널 내용 -->
</div>
```

- `studio-tool-panel` : 공통 Flex 기반 클래스 (변경 금지)
- `studio-[name]-panel` : 도구별 고유 modifier 클래스 (필수)
- 초기 상태는 `hidden`

### 6-3. 패널 레이아웃 — 공통 기준값

| 속성 | 값 |
|---|---|
| `padding` | `10px 12px 12px` |
| `gap` | `10px` |
| `display / flex-direction` | 상속 (`.studio-tool-panel`이 `flex + column` 설정) |

```css
.studio-[name]-panel {
  gap: 10px;
  padding: 10px 12px 12px;
}
```

> `.studio-mindmap-panel`, `.studio-graph-panel`, `.studio-law-panel` 모두 이 값을 따른다.

### 6-4. 내부 박스 스타일

| 속성 | 값 |
|---|---|
| `border` | `1px solid var(--line)` |
| `border-radius` | **`10px`** (8px 사용 금지) |
| 캔버스·그래프 배경 | `var(--surface)` 또는 `var(--surface-3)` |
| 툴바·입력 영역 배경 | `var(--surface-2)` |
| 상세·결과 영역 배경 | `var(--surface)` |

### 6-5. 기존 패널 구조 참고

**마인드맵**
```
.studio-mindmap-panel (padding 10/12/12, gap 10)
  ├── .studio-mindmap-canvas  (flex:1, border, radius:10px, surface)
  └── .studio-mindmap-details (min-height:84px, border, radius:10px, surface)
```

**지식그래프**
```
.studio-graph-panel (padding 10/12/12, gap 10)
  ├── .kg-toolbar        (border, radius:10px, surface-2)
  ├── .kg-stats-bar
  └── .kg-body           (grid: 1fr 320px, gap 12px)
        ├── .kg-canvas-wrap   (border, radius:10px, surface-3)
        └── .kg-detail-pane   (border, radius:10px, surface)
```

**법령탐색**
```
.studio-law-panel (padding 10/12/12, gap 10)
  ├── .law-explorer-toolbar  (border, radius:10px, surface-2)
  ├── .law-explorer-status   (텍스트만, flex-shrink:0)
  ├── .law-explorer-summary  (border, radius:10px, 결과 후 표시)
  └── .law-explorer-body     (grid: 1fr 272px)
        ├── .law-explorer-map    (border, radius:10px, surface)
        └── .law-explorer-detail (border, radius:10px, surface)
```

### 6-6. JS 연동 — 새 도구 추가 시 수정 위치

**`state.js`** — `elements` 객체에 추가
```js
studio[Name]Button:     document.getElementById("studio[Name]Button"),
studio[Name]RailButton: document.getElementById("studio[Name]RailButton"),
studio[Name]Panel:      document.getElementById("studio[Name]Panel"),
```

**`studio.js` — `setActiveTool()`** 확장
```js
// 1. 유효 도구 목록
if (... && tool !== "[name]") return;

// 2. 버튼 토글
elements.studio[Name]Button?.classList.toggle("is-active", tool === "[name]");

// 3. 패널 표시
if (elements.studio[Name]Panel) elements.studio[Name]Panel.hidden = tool !== "[name]";

// 4. 렌더 함수 분기
if (tool === "[name]") render[Name]();
```

**`studio.js` — `bindStudioEvents()`** 클릭 바인딩 추가
```js
elements.studio[Name]Button?.addEventListener("click", () => setActiveTool("[name]"));
elements.studio[Name]RailButton?.addEventListener("click", () => setActiveTool("[name]"));
```

### 6-7. Collapsed Rail 버튼

`.studio-collapsed-rail` 안에 추가:

```html
<button id="studio[Name]RailButton"
        class="studio-rail-button"
        type="button"
        title="[도구 설명]"
        aria-label="[도구 설명]">
  <svg viewBox="0 0 24 24" aria-hidden="true"><!-- 24×24 아이콘 --></svg>
</button>
```

---

## 7. 반응형

패널 폭이 좁아지면(≤900px) 가로 그리드를 세로로 전환한다.

```css
@media (max-width: 900px) {
  .studio-[name]-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

---

## 8. 접근성 체크리스트

새 컴포넌트를 추가할 때 반드시 확인한다.

- 버튼에 텍스트가 없으면 `aria-label` 또는 `title` 필수.
- 동적으로 변하는 콘텐츠에는 `aria-live="polite"` 적용.
- 키보드로 접근 가능해야 하는 인터랙티브 요소에 `tabindex="0"` + `keydown` 핸들러(Enter/Space).
- 포커스 인디케이터 삭제 금지 — `:focus` 제거 시 `:focus-visible` 대체 필수.
- SVG 아이콘에 `aria-hidden="true"` 부여 (레이블은 부모 버튼에).
