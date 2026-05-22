# myAI Design Guide

This guide captures the current UI conventions for the plain HTML/CSS/JS
frontend. Keep new screens consistent with `public/index.html`,
`public/styles.css`, and the module patterns under `public/modules/`.

## Design Tokens

Use CSS variables from `:root` in `public/styles.css`. Do not hard-code theme
colors in new components unless the value is a one-off semantic color such as
an error state.

Core tokens:

| Token | Purpose |
|---|---|
| `--bg` | app background |
| `--surface` | primary panels, dialogs, cards |
| `--surface-2` | input/tool areas and subtle selected backgrounds |
| `--surface-3` | canvas and nested workspace backgrounds |
| `--ink` | primary text |
| `--muted` | secondary text and low-emphasis icons |
| `--line` | borders and dividers |
| `--accent` | primary brand/action color |
| `--accent-dark` | stronger accent text/border |
| `--accent-aux` | secondary accent |
| `--danger` | destructive actions |
| `--shadow` | elevated dialogs and popovers |

For transparent theme-aware colors, prefer:

```css
color-mix(in srgb, var(--accent) 12%, transparent)
color-mix(in srgb, var(--accent) 16%, var(--surface))
```

## Typography

The global font stack is:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Use compact type for work surfaces. Avoid hero-scale headings inside sidebars,
tool panels, cards, dialogs, and admin tables.

| Use | Size | Weight |
|---|---:|---:|
| Section title | `14px` | `700` |
| Field/card title | `13px` | `700` |
| Body/help text | `13px` | `400-600` |
| Labels/table headers | `12px` | `700` |
| Badges/metadata | `10-11px` | `700-800` |
| Buttons | `12-13px` | `700` |

## Layout

The app shell uses a five-column grid:

```text
sidebar | resizer | chat-area | resizer | studio-panel
  340px     8px     minmax(0,1fr)  8px     360px
```

`--left-panel-width` and `--right-panel-width` are adjusted by
`public/modules/layout.js`. Keep new layout code compatible with the existing
left resize and right resize/collapse behavior.

Use `[hidden]` for visibility. The stylesheet forces `[hidden]` to
`display: none !important`, so JS should set `element.hidden = true/false`
instead of adding ad hoc hidden classes.

## Common Components

### Buttons

| Type | Class | Use |
|---|---|---|
| Primary | `.send-button` | submit/run/export primary actions |
| Secondary | `.ghost-button` | cancel, refresh, neutral commands |
| Icon | `.icon-button` | icon-only controls |
| Danger | `.admin-danger-button` modifier | destructive actions |

Icon-only buttons must have `aria-label` and should also have `title` when the
meaning is not obvious.

### Inputs

Use `.text-input` for inputs, selects, and textareas unless a component already
has a more specific established class.

```css
height: 38px;
border: 1px solid var(--line);
border-radius: 6px;
padding: 0 10px;
background: var(--surface);
color: var(--ink);
```

For textarea variants, set `height: auto` and vertical padding explicitly.

### Panels And Dialogs

Use `.panel` for sidebar sections and simple repeated cards:

```css
border: 1px solid var(--line);
border-radius: 8px;
background: var(--surface);
padding: 14px;
```

Settings/Admin Console use the existing `.settings-dialog` and
`.admin-dialog` structure. Keep admin views dense, table-friendly, and
optimized for repeated operations.

## Main Legal Review View

`법령검토` is a primary app view beside Chat and Calendar. Keep its central
workbench in the main grid column and keep its saved review list in the left
sidebar, separate from chat rooms.

The review result tab must make the LLM review state explicit. When official
evidence has been collected but the LLM review fails, show the actual failure
message in the result card and status line instead of a generic empty state.
The underlying request scope is also separate from chat: do not imply that
active chat attachments are included. Law Workbench has its own dedicated upload UI. Only documents explicitly attached to the active Law Workbench review are sent; active chat-room attachments are not automatically included.

### Law Workbench Search Bar

The search bar (`.law-hero-search`) follows the order:

```
[🔍 icon] [검토 유형 ▾] [텍스트 입력창] [📎 clip] [검토 button] [↺ reset]
```

**검토 유형 dropdown** (`.law-hero-type-select`) is embedded directly in the
search bar as a zen-style selector: no border, transparent background, accent
text color, custom SVG caret, hover/focus subtle background. The dropdown
doubles as a prompt guide so users can set the review intent without typing it
out.

| value | 검토 유형 |
|---|---|
| `general` | 일반 법령 검토 (default) |
| `internal_rule` | 내부 규정/지침 검토 |
| `ordinance` | 조례 상위법 검토 |
| `administrative_disposition` | 행정처분 근거 검토 |
| `civil_reply` | 민원 회신 근거 검토 |
| `privacy` | 개인정보 적법성 검토 |

`outputType` is **not shown to users**. It is derived automatically from
`reviewType` via `REVIEW_TYPE_TO_OUTPUT` in `public/modules/lawWorkbench.js`
and sent only to the server. The mapping is 1-to-1 for four types; `general`
and `privacy` both map to `law_review_opinion`.

**Status line** (`#lawWorkbenchStatus`) sits immediately below the search bar.
It is empty-hidden via CSS (`:empty { display: none }`). Messages with mode
`idle` auto-clear after 3 seconds; `error` and `running` messages persist until
the next state change.

**Clip button** (`#lawWorkbenchAttachButton`) is placed between the text input
and the 검토 button (right side of bar). The file input (`#lawWorkbenchUploadInput`)
is hidden and sits beside it.

### Example Chips

Three chips appear below the attachments row (`.law-hero-examples`):

```html
<span class="law-hero-examples-label">예시</span>
<button data-law-example="<full prompt>" title="<full prompt>">짧은 라벨</button>
```

Chip labels are shortened for single-line display; the full prompt lives in
`data-law-example` (used on click) and `title` (shown on hover). All three
chips must fit on one line at the standard panel width (~396 px).

### Advanced Conditions Panel (`상세 조건`)

`<details id="lawWorkbenchAdvanced">` starts **collapsed** by default on every
new review. The auto-open logic (`syncAdvancedOpen`) has been removed; the
panel only auto-opens when `fillAndRun()` populates 법령명/조문 from an AI
candidate.

Fields inside the panel:

| Field | Element | Notes |
|---|---|---|
| 법령명 | `#lawWorkbenchLawName` | always visible |
| 조문 | `#lawWorkbenchArticle` | always visible |
| 자치법규 지역 | `#lawWorkbenchRegionField` (label wrapping `#lawWorkbenchRegion`) | **hidden by default**; shown only when `reviewType === "ordinance"`. Cleared automatically when hidden. |
| 검토 관점·제외 범위 | `#lawWorkbenchConditionText` (textarea) | formerly labelled "상세 조건"; renamed to avoid collision with the parent `<details>` summary |

The `<details>` summary hint reads "법령 · 조문 · 자치법규 · 검토 관점".

### Term Mapping

`GET /api/law/terms` is still called during typing (`fetchTermsPreview`) and
the result is stored in `state.terms`. The chips that used to display the
mapping (`.law-workbench-terms`) have been **removed from the DOM**; the
feature operates silently in the background. `renderTerms()` is a safe no-op
because its target element no longer exists.

### Result Rendering

All result sections (`appendResultSection`, `appendResultList`) pass text
through `stripInlineMarkdown()` before setting `textContent`. This removes
`**bold**`, `*italic*`, `# headings`, `- list markers`, `` `code` ``,
`~~strikethrough~~`, and `[link](url)` syntax that the LLM occasionally emits
in structured result fields.

### Workflow Step Bar

`.law-workflow-step` text color is always `var(--text)` regardless of state.
The dot (`.law-workflow-step-dot`) uses explicit accent/danger colors:

| State | Text | Dot |
|---|---|---|
| default | `var(--muted)` | hollow, `var(--muted)` border |
| `is-done` | `var(--text)` | filled `var(--accent-dark)` |
| `is-active` | `var(--text)` bold | hollow + accent glow ring |
| `is-error` | `var(--text)` | filled `var(--danger)` |

## Studio Tools

The Studio panel is a tool workspace, not a marketing area. New tools should
follow this structure:

```html
<button id="studioExampleButton"
        class="studio-tool-card"
        type="button"
        data-tool="example"
        aria-label="Example tool">
  ...
</button>

<div id="studioExamplePanel"
     class="studio-tool-panel studio-example-panel"
     data-tool-panel="example"
     hidden>
  ...
</div>
```

Add matching rail buttons for collapsed mode:

```html
<button id="studioExampleRailButton"
        class="studio-rail-button"
        type="button"
        title="Example"
        aria-label="Example">
  ...
</button>
```

Required JS touch points:

- `public/modules/state.js`: add DOM refs for button, rail button, and panel.
- `public/modules/studio.js`: add the tool key to `setActiveTool()`, toggle
  active button state, show/hide the panel, and bind click events.
- `public/modules/layout.js`: if a rail button should expand the collapsed
  Studio panel, bind it to `setStudioCollapsed(false)`.

Current Studio tools:

| Tool key | Panel | Purpose |
|---|---|---|
| `document` | `studioDocumentPanel` | answer-to-document drafting and export |
| `doctool` | `studioDocToolPanel` | client-side PDF/XLSX/TXT merge/split |
| `mindmap` | `studioMindmapPanel` | uploaded-document mind maps |
| `graph` | `studioGraphPanel` | department notebook knowledge graphs |

## Studio Panel Layout

Use these defaults for new Studio panels:

```css
.studio-example-panel {
  gap: 10px;
  padding: 10px 12px 12px;
}
```

Internal boxes should use:

```css
border: 1px solid var(--line);
border-radius: 10px;
background: var(--surface);
```

Canvases and graph-like areas may use `var(--surface-3)`. Toolbar/input bands
may use `var(--surface-2)`.

Do not nest decorative cards inside other cards. Tool panels should be direct,
compact, and functional.

## Current Tool Notes

- **Document Studio** uses visual and raw markdown modes. Keep
  `documentStudioMarkdown.js` as the conversion boundary between rendered
  blocks and persisted markdown.
- **Law Explorer** has impact-map and article-history modes. Article-history
  actions require law name, article, and selected effective date(s); disabled
  actions should be visually distinct.
- **File Tools** are client-side only. PDF/XLSX/TXT merge/split operations
  should not upload content to the server.
- **Mind Map** renders an SVG tree with zoom, pan, collapse, fullscreen, and a
  node-detail panel.
- **Knowledge Graph** renders Cytoscape in a canvas/detail split and honors
  normal notebook read access.

## Interactions

- Hover transitions should be short (`0.12s-0.15s`) and limited to background,
  border, color, or shadow.
- Use `:focus-visible` for keyboard focus. Do not remove focus indicators.
- Selected/active states should use accent color mixes, not one-off colors.
- Destructive actions should use `--danger` and require `showConfirmDialog`
  from `public/modules/state.js`.
- Dynamic status text should use `aria-live="polite"` where users need feedback.

## Responsive Rules

When a panel becomes narrow (usually below `900px`), switch two-column tool
bodies to a single column:

```css
@media (max-width: 900px) {
  .studio-example-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

Text must not overflow buttons, cards, badges, or toolbars. Prefer wrapping and
stable dimensions over viewport-scaled font sizes.

## Accessibility Checklist

- Every icon-only button has `aria-label`.
- Interactive custom elements are keyboard reachable.
- Dynamic result/status areas use `aria-live="polite"` when appropriate.
- SVG icons inside labeled buttons use `aria-hidden="true"`.
- Dialog close buttons are obvious and keyboard accessible.
- Destructive actions route through the shared confirmation dialog.
