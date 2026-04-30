# Agent Handoff Notes

## Project

This project is a local Ollama-based AI assistant web app.

Workspace:

```text
D:\Dev\myAI
```

Run:

```powershell
cd D:\Dev\myAI
npm.cmd start
```

Open:

```text
http://localhost:3000
```

Default model:

```text
gemma3n:e2b
```

The app is intended to be a local AI secretary that can chat, analyze uploaded documents/images, persist conversations locally, and provide a personalized UI.

## Stack

- Frontend: plain HTML, CSS, JavaScript
- Backend: Node.js + Express
- LLM runtime: Ollama local API
- Storage: browser IndexedDB, encrypted with WebCrypto AES-GCM
- File parsing:
  - PDF: `pdf-parse`
  - DOCX: `mammoth`
  - XLSX: direct ZIP/XML parsing with `jszip`
  - CSV: built-in quoted CSV parser
  - PPTX: ZIP/XML parsing with `jszip` + `fast-xml-parser`
  - HWPX: ZIP/XML parsing with `jszip` + `fast-xml-parser`
  - Images: base64 stored and passed to Ollama

## Environment

- Runtime requirement: Node.js 20 or newer (`package.json` declares `engines.node >=20`).
- The server loads project-root `.env` through `server/env.js`.
- Existing process environment variables win over `.env` values.
- `HOST` is optional. If unset, Express listens on all interfaces; production templates set `HOST=127.0.0.1` behind a reverse proxy.

## Important Files

```text
server/index.js
server/env.js
server/documents.js
server/ollama.js
server/parsers.js
server/visualization.js
server/documentStore.js
public/index.html
public/app.js
public/answerRenderer.js
public/visualizationRenderer.js
public/fileDisplay.js
public/textRepair.js
public/styles.css
package.json
README.md
agents.md
PROJECT_ANALYSIS.md
deploy/DEPLOY.md
deploy/myai.service
deploy/myai.env.example
deploy/Caddyfile
deploy/nginx.conf.example
```

Key responsibilities:

- `server/index.js`
  - Express server
  - static frontend serving
  - loads local `.env` values through `server/env.js`
  - `/api/status`
  - `/api/upload`
  - `/api/documents`
  - `/api/documents/:id`
  - `/api/chat`
  - `/api/visualize`
  - `/api/followups`
  - delegates upload filename repair and document serialization to shared helpers

- `server/env.js`
  - dependency-free project-root `.env` loader
  - keeps already-defined environment variables unchanged

- `server/documents.js`
  - common document summary/full-payload serialization helpers

- `server/ollama.js`
  - Ollama streaming chat call
  - follow-up question generation call
  - structured visualization JSON generation call
  - model/system prompt construction
  - personal settings injection
  - custom user prompt injection
  - document/image context attachment
  - answer readability prompt rules:
    - short section labels
    - compact bullet/numbered lists
    - visual section symbols such as `◆`, `●`, `✓`, `※`, `->`

- `server/parsers.js`
  - parses uploaded file types into common document objects
  - chunks long text
  - extracts text from Office/HWPX ZIP XML formats
  - preserves CSV/XLSX tabular data as headers, rows, samples, and column profiles for visualization

- `server/visualization.js`
  - detects visualization intent keywords
  - builds compact table context for the model
  - parses and normalizes model JSON into an allowed chart/infographic schema

- `server/documentStore.js`
  - in-memory server-side document map
  - useful during the current server runtime only

- `public/app.js`
  - all frontend state and UI behavior
  - encrypted IndexedDB persistence
  - rooms, messages, files, settings
  - local save failure and browser quota warnings via `handleLocalSaveError`
  - file upload / drag and drop / clipboard image paste
  - attachment now starts from an expandable `+` menu in the prompt composer
  - the current `+` menu contains a paperclip button that opens the file picker
  - the `+` menu is intended as an extension point for future composer tools
  - drag and drop is handled by a full-app overlay instead of a left sidebar upload box
  - streaming response handling
  - routes chart/graph/infographic requests with tabular data to `/api/visualize`
  - stop generation via button or Escape
  - message copy/edit actions
  - follow-up suggestion rendering and click-to-send behavior

- `public/answerRenderer.js`
  - lightweight assistant answer renderer
  - parses plain paragraphs, markdown-style tables, bullet lists, numbered lists, and section labels
  - renders section labels with visual symbols for scanability:
    - `◆` default sections
    - `●` key points
    - `✓` evidence / checked facts
    - `※` caution / warning
    - `→` next steps
    - `◇` notes

- `public/visualizationRenderer.js`
  - renders validated visualization JSON as SVG charts, KPI cards, tables, and infographic sections
  - provides chart PNG download and visualization JSON copy controls

- `public/fileDisplay.js`
  - frontend file display helpers
  - repairs previously stored mojibake filenames at display time
  - maps uploaded files to sidebar badges (`PDF`, `DOC`, `XLS`, `CSV`, `PPT`, `HWP`, `IMG`, `FILE`)

- `public/textRepair.js`
  - mojibake scoring/repair helper shared by browser display code and server upload filename normalization
  - repairs UTF-8 filenames that arrive as Latin-1 mojibake, including Korean patterns such as `ì`, `ê`, `ë`

- `public/styles.css`
  - layout, themes, message UI, thinking UI, buttons, settings modal
  - assistant answer section/list/table styling
  - exposes `--accent` / `--accent-dark` as theme tokens; light/dark via `:root[data-theme="..."]` and color palette via `:root[data-color-theme="..."]`
  - sidebar active room item, primary buttons, section title underline, and answer section symbol badge all derive from `--accent`, so a color theme switch re-tints the whole UI without per-component overrides

- `public/index.html`
  - main app shell and settings dialog

## Current Features

### Chat

- Multiple chat rooms.
- Room creation and deletion.
- Room title editing.
- Empty/new room shows a centered waiting screen using the user title.
- User messages and AI messages are shown as chat bubbles.
- AI responses stream from Ollama.
- AI thinking state shows animated `Thinking...`.
- Thinking details can be expanded.
- The thinking card grows with expanded processing details instead of clipping them.
- While AI is generating:
  - send button changes from `전송` to `중지`
  - clicking `중지` aborts generation
  - pressing `Esc` aborts generation
- AI answer copy icon appears only after generation completes or stops.
- Completed AI answers show their completion time as `hh:mm` to the right of the copy button.
- Copy icons display a small `copied` label for about 1 second.
- User prompt copy icon is available under user messages on hover/focus.
- User prompt edit icon is available under user messages on hover/focus.
- After an assistant answer completes, the app asks `/api/followups` for 1-3 context-aware Korean follow-up questions.
- Follow-up suggestions are saved on the assistant message and rendered under that answer.
- Clicking a follow-up suggestion sends it as the next user message.
- If `/api/followups` fails or times out, the frontend falls back to local generic follow-up suggestions.
- Editing a user prompt:
  - happens inline inside the existing prompt bubble
  - Enter or the enter-shaped icon confirms
  - Esc or the cancel icon cancels
  - confirming keeps the user prompt, removes its old following AI answer/subsequent messages, and regenerates from the edited prompt

### Files

- Files are scoped to the active chat room.
- Supported inputs:
  - PDF
  - DOCX
  - XLSX
  - CSV
  - PPTX
  - HWPX
  - PNG/JPG/JPEG/WEBP/GIF
- Upload methods:
  - click the `+` button in the prompt composer, then click the paperclip icon
  - drag and drop files anywhere over the app, using the full-app drop overlay
  - paste image into prompt input
- Left sidebar shows:
  - room list
  - per-room file type badges (`PDF`, `DOC`, `XLS`, `CSV`, `PPT`, `HWP`, `IMG`, `FILE`)
  - selected room's file titles under the active room
- The old standalone `파일 업로드` and `현재 대화방 파일` sidebar sections were removed.
- File deletion happens from the selected room's file title rows via the trailing `X` button.
- File deletion asks for user confirmation and operates only on the current room.
- Upload file names are normalized server-side to repair common UTF-8/Latin-1 mojibake.
- The frontend also tries to repair previously stored mojibake names at display time.
- Processing-step labels use the frontend display helper so thinking details also show repaired filenames.

### Data Visualization

- CSV and XLSX uploads preserve structured table data in addition to extracted text.
- When the latest user prompt asks for a chart, graph, dashboard, visualization, or infographic and the active room has tabular data, the frontend calls `/api/visualize` instead of `/api/chat`.
- `/api/visualize` asks Ollama for strict JSON, then server-side validation allows only `bar`, `line`, `pie`, `scatter`, `table`, `kpi`, and `infographic`.
- The browser renders the validated JSON with `public/visualizationRenderer.js` as SVG charts, KPI cards, tables, or infographic sections.
- Chart blocks include icon-only PNG download controls. The visualization panel includes a JSON copy control.

### Persistence

- Conversations, rooms, settings, and room-scoped uploaded document payloads are stored in IndexedDB.
- Storage is encrypted with WebCrypto AES-GCM.
- The local encryption key is stored in IndexedDB as a non-extractable CryptoKey.
- The encrypted app state is stored in:

```text
DB name: ollama-chatter-secure
Object store: records
Record id: app-state
```

- Key store:

```text
Object store: keys
Record id: local-aes-gcm-key
```

Important architectural decision:

- Earlier versions kept only file summaries in IndexedDB and full parsed document contents in server memory.
- That caused uploaded files to disappear after refresh/restart.
- Current version stores the full parsed document payload in each room's `documents` array.
- Chat requests send `documents: getActiveDocuments()` with the active room's full client-side document payloads.
- This allows AI analysis even if the server's in-memory `documentStore` is empty after restart.
- Chat now re-runs stored document hydration before sending a request, not only during app startup.
- Stored documents that have `pages` or `sheets` text but a missing aggregate `text` field are normalized client-side before being sent.
- Save failures go through `persistAppState()` and surface in the UI through `handleLocalSaveError()`, including browser quota failures.
- Server context building accepts document text from `text`, `pages`, or `sheets`; it no longer depends only on the aggregate `text` field.
- If a room document is only a summary and no full text/pages/sheets payload can be hydrated from server memory, the content cannot be recovered automatically and the user must re-upload that file.

Limitations:

- Files are stored in the browser's local IndexedDB only.
- They are not shared across browsers/devices.
- Very large files or many images may hit browser storage limits.
- There is no export/import or storage usage meter yet.
- Existing files that were deleted by old reconcile logic cannot be recovered.

### Settings / Personalization

Settings are opened from the large gear icon in the chat header, top right.

Settings dialog layout (top to bottom):

- Row 1 (`.field-row`): `시스템 명칭` text input | `시스템 아이콘` (`<fieldset class="field-section icon-section">` containing logo preview, file input, remove button)
- Row 2 (`.field-row`): `사용자 별명` text input | `AI 별명` text input
- `테마` section (`<fieldset class="field-section theme-section">`) wrapping a `.field-row`:
  - `밝기` — sun/moon icon buttons (`.theme-toggle` / `.theme-option`)
  - `색상` — color palette pill buttons (`.color-theme-toggle` / `.color-theme-option`)
- `사용자 정의 프롬프트` textarea
- Hint paragraph (two lines, separated by `<br />`):
  - `※대화 내용과 설정은 PC 내부에만 암호화되어 저장됨`
  - `※파일은 해당 대화방에 저장됨`
- Action row: `취소` / `저장`

Persisted settings shape (`state.settings`):

- `userTitle` — was previously labeled `사용자 호칭`; UI label is now `사용자 별명`
- `aiName` — was previously labeled `AI 이름`; UI label is now `AI 별명`
- `appName` — was previously labeled `프로그램 이름`; UI label is now `시스템 명칭`
- `theme` — `"light" | "dark"`, set via the 밝기 sun/moon icons; applied as `data-theme` on `<html>`
- `colorTheme` — `"busan" | "water"`, default `"busan"`; applied as `data-color-theme` on `<html>`
- `appLogoDataUrl` — data URL stored under the `시스템 아이콘` section (was `프로그램 이미지/아이콘`)
- `customPrompt` — user-defined prompt addendum

The IndexedDB record key shape is unchanged so existing records continue to load; only the in-dialog labels and layout were renamed/regrouped.

The custom prompt can define:

- AI response tone
- answer style
- rules the AI should follow while generating answers

Custom prompt is sent as:

```js
personalization.customPrompt
```

Server applies it in `server/ollama.js` after base rules:

- It must not override safety/basic rules.
- It is truncated to 4,000 characters via `sanitizeCustomPrompt`.

The system icon (`appLogoDataUrl`):

- appears to the left of the program name in the sidebar
- is also used as dynamic favicon
- is stored in encrypted app state as a data URL

Brightness (`theme`):

- icon-based (`.theme-option`), not a dropdown
- sun icon selects `light`, moon icon selects `dark`
- stored as `state.settings.theme`

Color theme (`colorTheme`):

- pill buttons with circular gradient thumbnails (`.color-theme-thumb-busan`, `.color-theme-thumb-water`)
- swaps `--accent` / `--accent-dark` CSS variables, so any UI piece that uses those variables (buttons, active room item, section title underline, answer section symbol badge) re-tints automatically
- selecting a swatch immediately updates `data-color-theme` on `<html>` and calls `scheduleSave()`
- two built-in palettes:
  - `busan` — Busan CI: magenta/violet/blue (`--accent: #e6007e` light, `#ff3aa6` dark)
  - `water` — Busan Water Authority CI: blue/green (`--accent: #0098da` light, `#4ec0e6` dark)
- the dialog form is `display: grid; gap: 12px;` and width is `min(520px, calc(100vw - 32px))` to fit the two-column rows

## Current Layout

Left sidebar:

```text
App logo / app name / green-red status dot
New chat button
Room list
Selected room file titles with per-file delete buttons
```

Main panel:

```text
Chat header:
  room title input
  gear settings icon

Messages

Prompt composer:
  + expandable attachment/tool menu
  paperclip file attach action
  hidden file input
  textarea
  send / stop button
  upload progress/status line
```

The previous `사용자 ↔ AI` header display was removed because message bubbles already identify the speakers.

## Important Behavior Details

### Status Indicator

The app title area shows only a circular status light:

- checking: orange
- connected: green
- disconnected/error: red

Text is kept only in `aria-label` and `title`.

### Assistant Answer Rendering

The app does not render full Markdown. It uses a lightweight answer renderer in `public/answerRenderer.js`.

It intentionally:

- strips common markdown styling for normal prose
- converts markdown tables into HTML tables
- converts `-`, `*`, `+`, `•`, `※`, `->` style lines into compact lists
- converts `1.` / `1)` lines into ordered lists
- detects short section labels such as `Summary`, `Key points`, `Evidence`, `Caution`, `Next steps`, `요약`, `핵심`, `근거`, `주의점`, `다음 단계`
- renders section labels with a small visual symbol:
  - `◆` default
  - `●` key points
  - `✓` evidence / checked facts
  - `※` caution / warning
  - `→` next steps
  - `◇` notes

`cleanSectionLabel` strips leading section glyphs (`◆◇◈■□▣▪▫●○◯◎▶▷►▸★☆※→⇒✓✔✗❖`) from the label text before display. This prevents a duplicate symbol when the model itself outputs a leading glyph: only the renderer-chosen, shape-varying badge from `getSectionSymbol` is shown.

The section symbol badge (`.answer-section-symbol`) is a 20×20 rounded square painted with the current `--accent` color (88% mixed with surface), white glyph, and a soft accent-tinted shadow. Because it uses `--accent`, it re-tints with the selected color theme.

Server-side prompt rules in `server/ollama.js` ask the model to produce scan-friendly answers with short section labels, compact lists, and section symbols. The frontend also adds symbols automatically if the model omits them.

Relevant functions:

```js
renderAssistantAnswer(container, rawText)
parseAnswerBlocks(text)
createSectionTitle(text)
getSectionSymbol(text)
createList(items, ordered)
```

### Generation Stop

Relevant state/function:

```js
state.abortController
requestAssistantResponse(room)
stopGeneration()
setBusy(busy)
```

Important:

- `fetch("/api/chat")` is called with `signal: state.abortController.signal`.
- Abort errors are caught and do not create an error bubble.
- If partial assistant text exists, the bubble remains and copy icon becomes available after abort.

### Thinking Card

Relevant styles/functions:

```js
appendThinking()
buildProcessingSteps()
```

```css
.messages > *
.thinking-card
.thinking-details
```

Important:

- `appendThinking()` renders the temporary `Thinking...` card and a collapsible `처리 단계 보기` details section.
- The messages list is a flex column, so direct children use `flex: 0 0 auto` to prevent the thinking card from shrinking below its expanded content height.
- `.thinking-card` also uses `flex: 0 0 auto`; keep that behavior if changing the message layout or thinking UI.

### File Attachment UI

Relevant functions/styles:

```js
uploadFiles(files)
confirmAndRemoveUploadedFile(uploadedFile)
removeUploadedFile(uploadedFile)
handleWindowDragEnter(event)
handleWindowDragOver(event)
handleWindowDragLeave(event)
handleWindowDrop(event)
```

```css
.attach-button
.attach-menu
.attach-menu-button
.upload-progress
.drop-overlay
.drop-overlay-panel
.room-file-title
.room-file-remove
```

Important:

- The prompt composer owns file attachment through the `+` attach menu and hidden `#fileInput`.
- Clicking `+` opens a lightweight popover; clicking the paperclip action inside it opens the native file picker.
- Keep the attach menu extensible because it is intended to hold more composer tools later.
- The old sidebar upload box and current-room file panel no longer exist.
- Full-app drag and drop uses `#dropOverlay`; files dropped anywhere over the app are added to the active room.
- The active room's file titles render under that room in the sidebar.
- Each file row has an `X` delete button; deletion uses `window.confirm()` and then removes the file from the current room's IndexedDB-backed `documents` array.
- Keep `event.stopPropagation()` on file delete buttons so file deletion does not behave like room selection.

### Document Context Availability

Relevant functions:

```js
hydrateStoredDocuments()
hasPersistentDocumentContent(documentItem)
normalizeStoredDocumentContent(documentItem)
buildContext(documents)
collectChunks(documents)
pageSections(documentItem)
hasDocumentContext(documentItem)
```

Important:

- The sidebar file list only proves that a room has document metadata. AI analysis requires extracted payload content.
- A usable document payload has at least one of:
  - `text`
  - `pages[].text`
  - `sheets[].text`
- `hydrateStoredDocuments()` attempts to recover summary-only documents from server memory by `/api/documents/:id`.
- Server memory is temporary; after restart `/api/documents` can be empty, so old summary-only IndexedDB records may be unrecoverable.
- `normalizeStoredDocumentContent()` rebuilds `text`, `textLength`, and `preview` from existing `pages` or `sheets` when possible.
- `server/ollama.js` now includes context from `pages` or `sheets` even when aggregate `text` is absent.
- If the document has no extractable content at all, `server/ollama.js` adds an `[알림]` line naming the unavailable attachment rather than silently dropping it.

### Assistant Completion Time

Relevant functions/styles:

```js
appendMessage(role, text, options)
createMessageActions(article, role, createdAt)
setAssistantAnswerTime(article, createdAt)
createMessageTime(createdAt)
formatMessageTime(value)
```

```css
.message-actions
.message-time
```

Important:

- Assistant messages use their `createdAt` timestamp as answer completion time.
- New streaming answers call `setAssistantAnswerTime()` after the final answer is rendered and before the message is stored.
- Previously saved assistant messages pass `message.createdAt` into `appendMessage()` during `renderMessages()`.
- The displayed format is fixed local `hh:mm` via zero-padded `Date#getHours()` and `Date#getMinutes()`.
- The time appears in the assistant action row, immediately to the right of the copy button.

### Follow-Up Suggestions

Relevant state/functions:

```js
attachFollowupSuggestions(room, assistantMessage, assistantArticle)
requestFollowupSuggestions(room)
buildLocalFollowupSuggestions(room)
renderFollowupSuggestions(article, suggestions, options)
generateFollowupSuggestions({ messages, model, personalization })
```

Important:

- Follow-up suggestions are generated only after a completed assistant response is saved.
- The frontend calls `POST /api/followups` with recent room messages and personalization.
- The server asks Ollama for strict JSON: an array of 1 to 3 Korean question strings.
- The frontend limits visible suggestions to 3.
- The request has a 12 second frontend abort timeout.
- Failed suggestion generation should not break the main chat answer.

## Server API Summary

### `GET /api/status`

Returns Ollama status and model list.

### `POST /api/upload`

Accepts one uploaded file through `multer`.

Returns a full document payload for client-side encrypted persistence:

```js
{
  document: {
    id,
    createdAt,
    fileName,
    fileType,
    kind,
    mimeType,
    imageBase64,
    text,
    pages,
    sheets,
    pageCount,
    sheetCount,
    textLength,
    preview
  }
}
```

### `GET /api/documents`

Returns server in-memory document summaries only.

### `GET /api/documents/:id`

Returns a full document payload from server memory if available.

Used to hydrate older IndexedDB summaries if the server copy still exists.

### `DELETE /api/documents/:id`

Deletes from server memory only.

Client-side room document deletion is handled in `public/app.js`.

### `POST /api/chat`

Body includes:

```js
{
  model,
  messages,
  documents,
  personalization
}
```

Server uses the client-sent `documents` array directly. The in-memory `documentStore` remains only for upload summaries and legacy hydration through `/api/documents/:id`.

### `POST /api/followups`

Body includes:

```js
{
  model,
  messages,
  personalization
}
```

Returns:

```js
{
  suggestions: [
    "구체적인 후속 질문 1",
    "구체적인 후속 질문 2",
    "구체적인 후속 질문 3"
  ]
}
```

Current behavior:

- Implemented by `generateFollowupSuggestions` in `server/ollama.js`.
- Uses the last 6 messages, truncated per message, to ground suggestions.
- Expects strict JSON from Ollama, but includes parser fallbacks for JSON arrays or line-based output.
- Returns an empty suggestions array with a 500 response if generation fails server-side.

## Recent Changes

- Project folder was renamed from `D:\Dev\ollama_chatter` to `D:\Dev\myAI`.
- Follow-up question suggestions were added:
  - `server/index.js` exposes `POST /api/followups`.
  - `server/ollama.js` includes `generateFollowupSuggestions`.
  - `public/app.js` renders suggestions under assistant answers and sends clicked suggestions as new prompts.
  - `public/styles.css` includes follow-up suggestion styling.
- Thinking card expansion and assistant completion time were improved:
  - `public/styles.css` prevents message children and `.thinking-card` from shrinking in the flex message list, so expanded processing steps are not clipped.
  - `public/app.js` shows completed assistant answer time as `hh:mm` next to the copy button.
- Sidebar file management was simplified:
  - Removed standalone sidebar upload/current-file panels from `public/index.html`.
  - Moved file attachment to an expandable prompt composer `+` menu with a paperclip file action.
  - Added full-app drag and drop overlay.
  - Added per-file delete buttons under the selected room's file titles with confirmation before deletion.
- Filename mojibake repair was broadened:
  - `public/textRepair.js` detects Latin-1 mojibake characters like `ì`, `ê`, `ë` in addition to the earlier patterns.
  - `public/fileDisplay.js` applies the same style of repair when displaying existing stored filenames.
  - Thinking processing steps now use repaired display filenames.
- Document context resilience was improved:
  - `public/app.js` now normalizes stored document payloads from `pages`/`sheets` into aggregate `text` when possible.
  - `public/app.js` re-runs stored document hydration immediately before chat requests.
  - `server/ollama.js` now builds context from `text`, `pages`, or `sheets` and reports attachments that have no recoverable extracted content.
- Server helpers were split out:
  - `server/env.js` for project-root `.env` loading.
  - `server/documents.js` for summary/full document serialization.
- Frontend helpers were split out:
  - `public/answerRenderer.js` for lightweight assistant answer rendering.
  - `public/fileDisplay.js` for file name repair and file type badge display.
  - `public/textRepair.js` for shared mojibake scoring and repair.
- Assistant answers were made more scan-friendly:
  - `server/ollama.js` now asks for short labels, compact bullets, numbered lists, and visual section symbols.
  - `public/answerRenderer.js` parses labels/lists/tables and adds symbols automatically.
  - `public/styles.css` styles section labels, symbol badges, lists, and tables inside assistant bubbles.
- Color themes were added to settings:
  - `state.settings.colorTheme` (`"busan" | "water"`, default `"busan"`) is persisted in encrypted IndexedDB alongside the other settings.
  - Applied as `data-color-theme` on `<html>`; CSS variants in `public/styles.css` swap `--accent` / `--accent-dark`.
  - `setColorTheme`, `renderColorThemeToggle`, `normalizeColorTheme` added to `public/app.js`.
  - Settings dialog gains a `색상` swatch picker with two pill buttons (`부산 CI` / `부산 상수도`) and circular gradient thumbnails.
- Sidebar active room item became theme-aware:
  - `.room-item.active` switched from hardcoded teal (`rgba(15,118,110,0.45)` / `#eaf7f5`) to `color-mix(... var(--accent) ...)`, so the active highlight follows the chosen color palette in both light and dark mode.
- Section title symbol duplication fix and stronger badge:
  - `cleanSectionLabel` in `public/answerRenderer.js` now strips leading section glyphs from the model output so only the renderer-chosen symbol is shown.
  - `.answer-section-symbol` was made more prominent: 20×20, accent-mixed background at 88%, white glyph, soft accent-tinted shadow — and re-tints with the color theme.
- Linux deployment scaffolding was added under `deploy/`:
  - `myai.service` — systemd unit with sandboxing (`ProtectSystem=strict`, `NoNewPrivileges`, `MemoryDenyWriteExecute`, etc.) and `ReadWritePaths=/opt/myai/uploads`. Loads env from `/etc/myai.env`.
  - `myai.env.example` — production env template (defaults to `HOST=127.0.0.1` so the app only listens on loopback behind a proxy).
  - `Caddyfile` — Caddy reverse proxy with auto-TLS, streaming-friendly `flush_interval -1`, and matching upload size.
  - `nginx.conf.example` — nginx vhost with certbot hookup, `proxy_buffering off`, 1h timeouts, and `client_max_body_size 40m`.
  - `DEPLOY.md` — Ubuntu/Debian step-by-step (Node 20 install, Ollama, dedicated `myai` user, env file permissions, systemd, proxy, firewall, troubleshooting).
- `server/index.js` now reads `HOST` env to control bind interface (default keeps current behavior of binding all interfaces). `package.json` declares `"engines": { "node": ">=20" }`.
- Project-root `.env` loading was added through `server/env.js`; no external `dotenv` dependency is required.
- Local IndexedDB save failures now surface in the UI instead of only being logged to the console.
- README, agents notes, and project analysis were refreshed to match the current default model, file layout, Node.js 20+ requirement, and client-persisted document flow.
- Settings dialog layout was reorganized to be more compact:
  - Top row: `시스템 명칭` text input next to a `시스템 아이콘` `<fieldset>` containing the existing logo preview / file input / remove button.
  - Second row: `사용자 별명` and `AI 별명` side by side.
  - `테마` `<fieldset>` groups `밝기` (light/dark) and `색상` (color palette) side by side.
  - Field renames in the UI only (state keys unchanged): `프로그램 이름` → `시스템 명칭`, `사용자 호칭` → `사용자 별명`, `AI 이름` → `AI 별명`, `프로그램 이미지/아이콘` → `시스템 아이콘`, `테마` → `밝기`, `색상 테마` → `색상`.
  - Hint text replaced with a two-line `※` summary about local encrypted storage and per-room file scope.
  - Dialog width grew from 460px to 520px to accommodate two-column rows.
  - New CSS helpers: `.field`, `.field-row`, `.field-section`, `.field-section-title`, `.icon-section .logo-picker` grid areas (`preview` / `file` / `remove`).

## Known Constraints / Next Improvements

Good next steps:

- Add storage usage display for IndexedDB.
- Add per-room file size and total stored size.
- Add "export/import encrypted data" feature.
- Add password-based encryption option instead of only local CryptoKey.
- Add RAG / search over stored documents instead of sending all active room documents.
- Add file re-upload prompt when old summary-only documents cannot be hydrated.
- Add actual OCR for scanned PDFs/images.
- Add better filename encoding handling for all upload clients.
- Add test fixtures for PDF/DOCX/XLSX/PPTX/HWPX parsing.

Potential issue:

- Because uploaded files are now persisted in browser IndexedDB, very large images or many documents can make encrypted app state large.
- Browser quota/save failures are surfaced in the UI via `public/app.js#handleLocalSaveError`, but there is still no storage usage meter or export/import recovery workflow.
- `/api/chat` has JSON body limit configured as:

```js
app.use(express.json({ limit: process.env.MAX_JSON_BYTES || "80mb" }));
```

If users store/send larger files, this may need to be raised or replaced with chunked/RAG transport.

## Recent Verification

Current verification commands:

```powershell
Get-ChildItem -Recurse -Include *.js -Path .\server,.\public | ForEach-Object { node --check $_.FullName }
node -e "import('./public/answerRenderer.js').then(({parseAnswerBlocks})=>console.log(JSON.stringify(parseAnswerBlocks('요약\n- 첫째\n\n주의점:\n- 조심\n\n다음 단계\n1. 실행'))))"
node -e "import('./server/env.js').then(({loadLocalEnv})=>{loadLocalEnv('.env.example'); console.log(process.env.OLLAMA_MODEL)})"
node -e "import('./server/ollama.js').then(({DEFAULT_MODEL})=>console.log(DEFAULT_MODEL))"
```

Latest local verification used the commands above. `npm.cmd audit --json` and a live `/api/status` request were not rerun in the latest documentation refresh.

Expected status response:

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma3n:e2b",
  "models": ["gemma3n:e2b"]
}
```

## Operational Notes For Next Agent

- Prefer small, focused edits.
- Use `apply_patch` for file edits.
- Do not assume uploaded file payloads are server-persistent; client IndexedDB is the durable source.
- If changing file persistence, be careful not to reintroduce server-memory reconciliation that deletes local room documents.
- If changing chat generation, preserve abort behavior via `AbortController`.
- If changing assistant answer rendering, preserve markdown-lite behavior:
  - no full Markdown renderer unless intentionally added
  - tables remain supported
  - section labels should remain visually distinct
  - bullet and numbered lists should remain compact and scannable
- If changing message actions, preserve:
  - user copy/edit hover behavior
  - inline edit cancel via Esc
  - inline edit confirm via Enter
  - assistant copy only after streaming finishes
- If changing settings, keep `state.settings` backward compatible with old IndexedDB records. The dialog labels were renamed in this session (`프로그램 이름` → `시스템 명칭`, `사용자 호칭` → `사용자 별명`, `AI 이름` → `AI 별명`, `프로그램 이미지/아이콘` → `시스템 아이콘`); the underlying state keys (`appName`, `userTitle`, `aiName`, `appLogoDataUrl`) are unchanged on purpose.
- Brightness UI is icon-based (`.theme-option`); persisted shape is still `theme: "light" | "dark"`.
- Color palette UI is swatch-based (`.color-theme-option`); persisted shape is `colorTheme: "busan" | "water"`. Always normalize unknown values via `normalizeColorTheme` (default `"busan"`) before applying or saving.
- Prefer `--accent` / `--accent-dark` (and `color-mix(... var(--accent) ...)`) over hardcoded brand colors so new UI inherits the active color theme automatically.
