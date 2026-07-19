# myAI Design Guide

myAI is a dense operational tool, not a marketing site. Keep new UI consistent with `public/index.html`, `public/styles.css`, and the module style under `public/modules/`.

## Tokens

Use CSS variables from `:root`.

| Token | Purpose |
|---|---|
| `--bg` | app background |
| `--surface` | panels, dialogs, cards |
| `--surface-2` | inputs/toolbars/subtle selected backgrounds |
| `--surface-3` | canvases and nested workspaces |
| `--ink` / `--text` | primary text |
| `--muted` | secondary text/icons |
| `--line` | borders/dividers |
| `--accent` | primary action/brand |
| `--accent-dark` | stronger accent text/border |
| `--accent-aux` | secondary accent |
| `--danger` | destructive actions |
| `--shadow` | elevated dialogs/popovers |

Prefer `color-mix()` with theme tokens for translucent states.

## Typography

Global font stack:

```css
Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

Use compact type for work surfaces.

| Use | Size | Weight |
|---|---:|---:|
| Section title | `14px` | `700` |
| Field/card title | `13px` | `700` |
| Body/help text | `13px` | `400-600` |
| Labels/table headers | `12px` | `700` |
| Badges/metadata | `10-11px` | `700-800` |
| Buttons | `12-13px` | `700` |

Do not use hero-scale headings inside sidebars, admin tables, cards, dialogs, or tool panels.

## Layout

The app shell uses:

```text
sidebar | resizer | main area | resizer | studio panel
```

`public/modules/layout.js` controls left resize and right resize/collapse. Use `[hidden]` for visibility; the stylesheet maps it to `display: none !important`.

## Buttons And Inputs

- Primary actions: `.send-button`.
- Neutral actions: `.ghost-button`.
- Icon-only controls: `.icon-button` with `aria-label` and usually `title`.
- Destructive actions: danger styling and `showConfirmDialog`.
- Text inputs/selects/textareas: `.text-input` unless a component already has a specific class.

## Dialogs And Panels

Settings/Admin Console use the existing `.settings-dialog` and `.admin-dialog` structures. Keep admin views dense, sortable/table-friendly where useful, and optimized for repeated operations.

Avoid decorative nested cards. Use cards for repeated items, modals, and genuinely framed tools.

## Main Views

Current primary views:

- Chat
- Knowledge Pack
- Calendar
- Law Workbench
- GRC Workbench
- Document Security (문서보안)

Law Workbench state is separate from chat rooms. Review requests use only the Law Workbench prompt, conditions, official evidence, and documents explicitly attached inside Law Workbench.

GRC Workbench is a Svelte component mounted by `public/app.js` from the Vite-built bundle in `public/dist/`.

Document Security (`#safeDocArea`, `public/modules/safeDoc/`) is plain ESM with no build step. All of its
CSS lives at the end of `public/styles.css`, scoped under `#safeDocArea` with an `sd-` class prefix and
`sdc` id prefix, so it cannot leak into — or be leaked into by — the 13k-line global sheet. It uses only
theme tokens, so light and dark both work. Its three work tabs and the four-step progress indicator live
in the sidebar panel (`data-view-content="safedoc"`), keeping the main area for the document itself.

## Studio Tools

Current tool keys:

| Tool key | Panel | Purpose |
|---|---|---|
| `document` | `studioDocumentPanel` | answer-to-document drafting, AI edit, export |
| `doctool` | `studioDocToolPanel` | client-side PDF/XLSX/TXT merge/split |
| `mindmap` | `studioMindmapPanel` | uploaded-document mind maps |
| `graph` | `studioGraphPanel` | department notebook knowledge graphs |

New Studio tools need:

- button in `public/index.html`
- rail button for collapsed Studio mode when appropriate
- DOM refs in `public/modules/state.js`
- activation handling in `public/modules/studio.js`
- optional collapsed-panel behavior in `public/modules/layout.js`

## Tool-Specific Rules

- Document Studio: keep `documentStudioMarkdown.js` as the conversion boundary. If answer-to-document conversion fails, show original answer as plain text, not parsed Markdown.
- File Tools: PDF/XLSX/TXT merge/split stays client-side.
- Mind Map: uploaded room documents only; no Naver Search or department RAG.
- Knowledge Graph: use Cytoscape and normal notebook read access; show enabled graph content to normal users.
- Law Explorer/Workbench: show actual LLM review errors when official evidence exists but review generation fails.

## Inline Citations

Precision Analysis citations render as inline clickable markers such as `[1.2]` or `[1.2, 1.3]`.

Implementation:

- `renderTextWithCitations()`, `buildCitationButtons()`, `showCitationPopup()` in `public/answerRenderer.js`
- `.inline-citation-btn`, `.inline-citation-popup`, `.inline-citation-popup-*` in `public/styles.css`

Markers should stay baseline-aligned and subtle until hover/focus. Popups show document name, location, and excerpt; close on close button, Escape, or outside click.

## Interaction Rules

- Keep hover transitions short and limited to background, border, color, or shadow.
- Use `:focus-visible`; do not remove keyboard focus indicators.
- Use accent token mixes for selected/active states.
- Use `--danger` for destructive actions.
- Dynamic status text should use `aria-live="polite"` when users need feedback.

## Responsive Rules

When panels become narrow, switch two-column tool bodies to one column. Text must not overflow buttons, cards, badges, or toolbars. Prefer wrapping and stable dimensions over viewport-scaled font sizes.

## Accessibility Checklist

- Icon-only buttons have `aria-label`.
- Interactive custom elements are keyboard reachable.
- Dynamic status/result areas use `aria-live` where appropriate.
- SVG icons in labeled buttons are `aria-hidden="true"`.
- Dialog close buttons are obvious and keyboard accessible.
- Destructive actions use the shared confirmation dialog.
