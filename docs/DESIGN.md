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
| `law` | `studioLawPanel` | impact maps and article history/diff |
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
