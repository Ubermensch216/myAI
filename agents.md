# Agent Handoff Notes

## Project

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX-backed visualizations, a local AI calendar agent, encrypted local persistence, and personalized UI settings.

Current workspace:

```text
C:\Dev\myAI
```

Current live status checked on 2026-05-03:

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["gemma4:e4b", "gemma4:e2b"]
}
```

Run:

```powershell
cd C:\Dev\myAI
npm.cmd start
```

Open:

```text
http://localhost:3000
```

Model notes:

- Current local `.env`: `OLLAMA_MODEL=gemma4:e2b`.
- Code fallback in `server/ollama.js` and `server/calendarAgent.js`: `gemma3n:e2b`.
- `.env.example` also defaults to `gemma3n:e2b`.
- `KOREA_HOLIDAY_SERVICE_KEY` is optional. If configured, `/api/holidays` uses the official Korean public-holiday API; otherwise it returns a limited fixed-solar-holiday fallback.

Current worktree notes at this refresh:

- Uncommitted calendar agent fixes are present:
  - `public/app.js` adds pending calendar confirmation handling so tentative schedule requests are saved only after user confirmation.
  - `server/calendarAgent.js` adds `calendar.propose`, recent-message/pending-action context, and deterministic month-range correction.
  - `server/index.js` passes `messages` and `pendingAction` through `/api/agent/intent`.
- This documentation refresh updates `agents.md` and `README.md`.

## Stack

- Frontend: plain HTML, CSS, JavaScript modules
- Backend: Node.js 20+ and Express
- LLM runtime: local Ollama API
- Storage: browser IndexedDB encrypted with WebCrypto AES-GCM
- File parsing:
  - PDF: `pdf-parse`
  - DOCX: `mammoth`
  - XLSX: ZIP/XML parsing with `jszip`
  - CSV: built-in quoted CSV parser
  - PPTX: ZIP/XML parsing with `jszip` + `fast-xml-parser`
  - HWPX: ZIP/XML parsing with `jszip` + `fast-xml-parser`
  - Images: base64 stored in the client payload and sent to Ollama

## Important Files

```text
server/index.js
server/env.js
server/documents.js
server/ollama.js
server/calendarAgent.js
server/holidays.js
server/parsers.js
server/retrieval.js
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
deploy/DEPLOY.md
deploy/myai.service
deploy/myai.env.example
deploy/Caddyfile
deploy/nginx.conf.example
```

Key responsibilities:

- `server/index.js`
  - Express server and static frontend serving.
  - Loads local `.env` through `server/env.js`.
  - Routes:
    - `GET /api/status`
    - `POST /api/upload`
    - `GET /api/documents`
    - `GET /api/documents/:id`
    - `DELETE /api/documents/:id`
    - `POST /api/chat`
    - `POST /api/visualize`
    - `POST /api/followups`
    - `POST /api/agent/intent`
    - `GET /api/holidays`
  - Delegates upload filename repair and document serialization to shared helpers.

- `server/env.js`
  - Dependency-free project-root `.env` loader.
  - Existing process environment variables win over `.env` values.

- `server/documents.js`
  - Common document summary/full-payload serialization helpers.

- `server/ollama.js`
  - Ollama streaming chat call.
  - Follow-up question generation.
  - LLM visualization plan generation, repair, and interpretation.
  - Model/system prompt construction.
  - Personal settings and custom prompt injection.
  - Document/image context attachment.
  - Uses `server/retrieval.js` to select relevant document chunks when the context exceeds `MAX_CONTEXT_CHARS`.

- `server/calendarAgent.js`
  - LLM-backed calendar intent classifier.
  - Calls Ollama with `format: "json"` and `think: false`.
  - Valid intents:
    - `chat`
    - `calendar.propose`
    - `calendar.create`
    - `calendar.list`
    - `calendar.delete`
    - `calendar.update`
  - Resolves relative Korean dates using `currentDate` from the request.
  - Accepts recent conversation messages and a pending calendar action so confirmation replies like `응, 추가해줘` can become concrete calendar operations.
  - Applies deterministic correction for month-range list prompts such as `5월 전체 일정`, `이번 달`, `다음 달`, and `지난달`.
  - Applies deterministic daily-repeat correction for prompts such as `5월 전체 일정에 ... 등록` and `이번 달 매일 ... 추가`.
  - Normalizes payload shapes before returning to the browser.
  - Does not mutate calendar data itself. The browser applies accepted operations to encrypted local state.

- `server/holidays.js`
  - Loads Korean public holidays by year.
  - Uses the public KASI/Data.go.kr `SpcdeInfoService/getRestDeInfo` endpoint when `KOREA_HOLIDAY_SERVICE_KEY` is configured.
  - Falls back to fixed solar holidays when no key is configured or the official API fails.

- `server/parsers.js`
  - Parses uploaded file types into common document objects.
  - Chunks long text.
  - Extracts text from Office/HWPX ZIP XML formats.
  - Preserves CSV/XLSX tabular data as headers, rows, samples, and column profiles for visualization.

- `server/retrieval.js`
  - Tokenizes text with CJK bigram support.
  - Uses BM25-like scoring to pick relevant document chunks for long-context chat.

- `server/visualization.js`
  - Detects visualization intent keywords.
  - Builds compact table context for the model.
  - Normalizes LLM `analysis + visualizationPlan` JSON.
  - Validates chart type, dataset index, columns, aggregation, and numeric requirements.
  - Executes accepted plans against real CSV/XLSX rows.
  - Computes chart data for `bar`, `line`, `pie`, `scatter`, `table`, `kpi`, and `infographic`.
  - Marks specs as `source: "llm"` or `source: "fallback"`.

- `server/documentStore.js`
  - In-memory server-side document map.
  - Runtime-only helper for upload summaries and legacy hydration.

- `public/index.html`
  - Main app shell.
  - Left sidebar with brand banner and primary `대화` / `캘린더` navigation.
  - Chat view, calendar view, event dialog, settings dialog, drop overlay.

- `public/app.js`
  - Main frontend state and UI behavior.
  - Encrypted IndexedDB persistence.
  - Rooms, messages, files, settings, calendar events.
  - Upload, drag/drop, clipboard image paste.
  - Streaming response handling and generation abort.
  - Routes visualizable tabular prompts to `/api/visualize`.
  - Routes suspected calendar prompts to `/api/agent/intent`.
  - Executes local calendar CRUD and renders event cards.
  - Follow-up suggestion rendering and click-to-send behavior.

- `public/answerRenderer.js`
  - Lightweight assistant answer renderer.
  - Parses plain paragraphs, markdown-style tables, bullet lists, numbered lists, and section labels.

- `public/visualizationRenderer.js`
  - Renders validated visualization JSON as SVG charts, KPI cards, tables, and infographic sections.
  - Provides chart PNG download and visualization JSON copy controls.

- `public/fileDisplay.js`
  - Frontend file display helpers.
  - Repairs previously stored mojibake filenames at display time.
  - Maps uploaded files to sidebar badges.

- `public/textRepair.js`
  - Mojibake scoring/repair helper shared by browser display code and server upload filename normalization.

- `public/styles.css`
  - Layout, themes, message UI, thinking UI, buttons, settings modal.
  - Assistant answer styling.
  - Primary nav and calendar UI styling.
  - Uses `--accent` / `--accent-dark` theme tokens.

## Architecture Summary

### Chat

```text
user prompt
-> public/app.js sends /api/chat
-> server/ollama.js builds system prompt and document/image context
-> Ollama streams chunks
-> browser renders answer incrementally
-> answer is saved in encrypted IndexedDB
-> /api/followups generates suggestions
```

### Long Document Context

```text
room documents in IndexedDB
-> client sends active room documents
-> server/ollama.js collects text/pages/sheets
-> if context is too large, server/retrieval.js picks relevant chunks
-> selected context is injected into the system message
```

### Visualization

```text
chart/graph prompt + CSV/XLSX table data
-> public/app.js calls /api/visualize
-> LLM returns analysis + visualizationPlan JSON
-> server/visualization.js validates exact columns and chart requirements
-> server computes final chart data from real rows
-> LLM optionally interprets the computed spec in Korean
-> browser renders the validated spec
```

### Calendar Agent

```text
calendar-like natural language prompt
-> public/app.js keyword prefilter
-> POST /api/agent/intent
-> server/calendarAgent.js asks Ollama for strict JSON
-> server normalizes intent/payload and applies deterministic date-range corrections
-> public/app.js stores tentative calendar.propose payloads as pendingCalendarAction
-> user confirmation can convert pendingCalendarAction into calendar.create
-> public/app.js applies create/list/delete/update to state.calendar.events
-> UI refreshes calendar grid, upcoming list, command result, and chat event cards
```

Important design point:

- The LLM classifies intent and extracts fields.
- Deterministic code corrects known brittle cases, especially month-range queries.
- The browser owns local calendar state and mutates it.
- Calendar success messages are generated only after local mutation succeeds.
- There is no server-side calendar database.

## Current Layout

Left sidebar:

```text
System banner
Primary nav:
  대화
  캘린더

대화 selected:
  New chat button
  Room list
  Active room file titles under the selected room

캘린더 selected:
  New event button
  Upcoming events list
```

Main panel:

```text
대화 view:
  Chat header with room title and settings button
  Messages
  Prompt composer with + attachment menu

캘린더 view:
  Month toolbar: previous / today / next / month label
  AI calendar command bar
  Command result panel
  Month grid
```

Dialogs:

```text
eventDialog:
  title
  all-day checkbox
  start / end
  location
  notes
  color picker
  delete / cancel / save

settingsDialog:
  system banner
  system name
  system avatar
  user alias
  user avatar
  theme and color palette
  custom prompt
```

## Current Features

### Chat

- Multiple chat rooms.
- Room creation and deletion.
- Room title editing.
- Empty/new room shows a centered waiting screen using the user title.
- User and assistant messages render as chat bubbles.
- Assistant responses stream from Ollama.
- Thinking card can expand processing details.
- While generating:
  - send button changes from `전송` to `중지`
  - clicking `중지` aborts generation
  - pressing `Esc` aborts generation
- Assistant answer copy icon appears only after generation completes or stops.
- Completed assistant answers show completion time as `hh:mm`.
- User prompt copy/edit actions appear on hover/focus.
- Editing a user prompt happens inline and regenerates from the edited point.
- Follow-up suggestions are requested after completed assistant answers.
- Clicking a follow-up suggestion sends it as the next user prompt.

### Files

- Files are scoped to the active chat room.
- Supported:
  - PDF
  - DOCX
  - XLSX
  - CSV
  - PPTX
  - HWPX
  - PNG/JPG/JPEG/WEBP/GIF
- Upload methods:
  - composer `+` menu, then paperclip
  - drag and drop over the app
  - paste image into prompt input
- Active room file titles render under the selected room in the chat sidebar.
- File deletion asks for confirmation and removes from current room IndexedDB state.
- Upload filenames are normalized server-side; stored mojibake names are repaired at display time.

### Calendar

State shape:

```js
state.calendar = {
  events: [],
  cursorISO: todayDateISO(),
  viewMode: "month",
  editingEventId: null,
  selectedColor: "accent"
}
```

Persisted app state adds:

```js
{
  activeView: "chat" | "calendar",
  calendar: {
    events,
    cursorISO,
    viewMode
  }
}
```

Event shape:

```js
{
  id,
  title,
  allDay,
  start,
  end,
  location,
  notes,
  color,
  reminders,
  notifiedReminders,
  createdAt,
  updatedAt
}
```

Current calendar UI:

- Primary navigation switches between `대화` and `캘린더`.
- Calendar supports `month`, `week`, and `day` view modes.
- Month grid always renders 42 day cells.
- Previous/today/next controls move by month, week, or day depending on the active view mode.
- Clicking a day opens the create-event dialog at 09:00-10:00.
- Clicking an event chip opens the edit dialog.
- Clicking a month-cell `+N` overflow indicator switches to day view for that date.
- Sidebar shows up to 8 upcoming events.
- `Shift+N` is scoped by active primary view:
  - chat view: new chat
  - calendar view: new event
- Korean holidays render in calendar cells and agenda columns.
- Event reminders support start time, 30 minutes before, 1 day before, 2 days before, and 1 week before.
- Event colors:
  - `accent`
  - `blue`
  - `green`
  - `orange`
  - `purple`
  - `red`
- Manual create/edit checks for time conflicts and asks for confirmation before saving overlapping events.

Natural language calendar flow:

- `public/app.js#hasCalendarKeyword` prefilters likely calendar prompts.
- `public/app.js#classifyMessageIntent` calls `POST /api/agent/intent`.
- `server/calendarAgent.js#classifyIntent` returns normalized `{ intent, payload }`.
- Supported intents are:
  - `chat`
  - `calendar.propose`
  - `calendar.create`
  - `calendar.list`
  - `calendar.delete`
  - `calendar.update`
- `calendar.propose` means the user is discussing or asking whether an event can be scheduled, but has not clearly asked to save it yet.
- `public/app.js#handleCalendarProposal` stores the proposed create payload in `room.pendingCalendarAction` and asks for confirmation.
- Confirmation messages such as `응`, `좋아`, `추가해줘`, `등록해줘`, or `진행해` are classified with both recent messages and `pendingCalendarAction`.
- If the model still returns `chat` but a pending action exists and the user confirms, `public/app.js` falls back to executing the pending action directly.
- Rejection messages such as `아니`, `취소`, or `하지마` clear the pending calendar action.
- `server/calendarAgent.js#applyDeterministicCorrections` forces full-month ranges for prompts like `5월 전체 일정 보고해`, `이번 달 일정`, `다음 달 일정`, and `지난달 일정`.
- Full-month daily create prompts are represented as `repeat: { frequency: "daily", from, to }`; `public/app.js#applyDailyRepeatCalendarCreateAsync` expands them into individual local events.
- `public/app.js#executeCalendarIntent` dispatches to:
  - `applyCalendarCreateAsync`
  - `applyCalendarList`
  - `applyCalendarDelete`
  - `applyCalendarUpdate`
- Calendar commands work from:
  - the calendar command bar
  - the normal chat prompt, when a calendar intent is detected
- Chat responses for calendar operations can include inline event cards.
- Clicking an event card switches to calendar view and opens the event dialog if the event still exists.

Calendar limitations and risks:

- Local-only calendar. No Google/Outlook/ICS sync.
- No recurrence model.
- Reminder checks run in the open browser tab at one-minute intervals.
- No timezone UI. Date/time strings are stored in browser-local form.
- No multi-calendar account model.
- AI delete by date range currently deletes matching events immediately after intent classification.
- AI delete by partial title deletes immediately when exactly one candidate is found; multiple candidates ask for a more specific request.
- AI update matches by partial title and does not currently perform a conflict check after applying time changes.
- Before production use, add stronger confirmation UX for destructive calendar operations.

### Data Visualization

- CSV and XLSX uploads preserve structured table data.
- Visual prompts with tabular data call `/api/visualize` instead of `/api/chat`.
- `/api/visualize` uses a plan-first AI workflow:
  1. `server/ollama.js#requestVisualizationPlan` asks for strict JSON with `status`, `analysis`, `visualizationPlan`.
  2. `server/visualization.js#normalizeVisualizationPlan` validates chart type, dataset index, exact columns, aggregation, and numeric requirements.
  3. `server/visualization.js#executeVisualizationPlan` computes render data from uploaded rows.
  4. `server/ollama.js#requestVisualizationInterpretation` asks Ollama to interpret the computed result in Korean.
- Invalid plan JSON is retried once with a repair prompt.
- Remaining failures fall back to an automatic server chart marked `source: "fallback"` and `fallback: true`.
- Successful AI-planned specs are marked `source: "llm"` and `fallback: false`.
- Browser panels label results as:
  - `AI 분석 기반 시각화`
  - `자동 fallback 시각화`

### Persistence

- Conversations, rooms, settings, room-scoped uploaded documents, active view, and calendar events are stored in IndexedDB.
- Storage is encrypted with WebCrypto AES-GCM.
- The local encryption key is stored as a non-extractable CryptoKey.

```text
DB name: ollama-chatter-secure
Object store: records
Record id: app-state

Object store: keys
Record id: local-aes-gcm-key
```

Important:

- Uploaded document payloads are durable only in browser IndexedDB.
- `server/documentStore.js` is runtime-only memory.
- Chat requests send `documents: getActiveDocuments()` from the client.
- `hydrateStoredDocuments()` can recover old summary-only documents only while the server still has them in memory.
- If a room document only has summary metadata and no full payload can be hydrated, the user must re-upload it.
- Save failures go through `persistAppState()` and surface in the UI via `handleLocalSaveError()`.

### Settings / Personalization

Current `state.settings` keys:

```js
{
  userTitle,
  aiName,
  appName,
  theme,
  colorTheme,
  appBannerDataUrl,
  appLogoDataUrl,
  systemAvatarDataUrl,
  userAvatarDataUrl,
  customPrompt
}
```

Notes:

- `appBannerDataUrl` is used for the sidebar/system banner.
- `appLogoDataUrl` remains for backward compatibility but is not the current primary settings UI path.
- The favicon currently stays at `/default-icon.svg`.
- `systemAvatarDataUrl` is used for assistant message avatars.
- `userAvatarDataUrl` is used for user message avatars.
- Message avatars render before the speaker name with `.message-meta-avatar` at 44px.
- `aiName` is effectively kept aligned to `appName` in current frontend behavior.
- `customPrompt` is sent as `personalization.customPrompt` and truncated server-side to 4,000 characters.
- Brightness theme is `light` or `dark`.
- Color theme is `busan` or `water`.

## Server API Summary

### `GET /api/status`

Returns Ollama status and model list.

### `POST /api/upload`

Accepts one uploaded file through `multer`.

Returns a full document payload for client-side encrypted persistence.

### `GET /api/documents`

Returns server in-memory document summaries only.

### `GET /api/documents/:id`

Returns a full document payload from server memory if available.

### `DELETE /api/documents/:id`

Deletes from server memory only.

### `POST /api/chat`

Body:

```js
{
  model,
  messages,
  documents,
  personalization
}
```

Streams plain text from Ollama.

### `POST /api/visualize`

Body:

```js
{
  prompt,
  model,
  messages,
  documents,
  personalization
}
```

Returns:

```js
{
  visualization
}
```

### `POST /api/followups`

Body:

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
  suggestions: ["...", "...", "..."]
}
```

### `POST /api/agent/intent`

Body:

```js
{
  prompt,
  model,
  currentDate,
  messages,
  pendingAction
}
```

Returns:

```js
{
  intent: "chat" | "calendar.propose" | "calendar.create" | "calendar.list" | "calendar.delete" | "calendar.update",
  payload: {},
  fallbackReason
}
```

`fallbackReason` appears only when classification or validation falls back to normal chat.

`messages` is optional recent chat context. `pendingAction` is optional and normally shaped like:

```js
{
  intent: "calendar.create",
  payload: {
    title,
    start,
    end,
    allDay,
    location,
    notes,
    reminders
  }
}
```

### `GET /api/holidays`

Query:

```js
{
  year
}
```

Returns Korean public holidays for the requested year. Uses official public-data API when `KOREA_HOLIDAY_SERVICE_KEY` is set; otherwise returns a limited fixed-solar fallback with `source: "fallback"`.

## Important Behavior Details

### Status Indicator

- App status is checked with `/api/status`.
- Current visual status indicator behavior is in the sidebar/brand area and model hint text.

### Assistant Answer Rendering

- The app does not use a full Markdown renderer.
- `public/answerRenderer.js` handles:
  - plain paragraphs
  - compact bullet lists
  - numbered lists
  - markdown-style tables
  - short section labels
- Do not add a full Markdown renderer without checking for regressions in table/list styling.

### Generation Stop

Relevant functions:

```js
requestAssistantResponse(room)
requestTextAssistantResponse(room)
requestVisualizationResponse(room)
stopGeneration()
setBusy(busy)
```

Important:

- Chat and visualization fetches use `state.abortController.signal`.
- Abort errors are swallowed and should not create an error bubble.
- Partial assistant text remains usable after abort.

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

Keep the composer `+` menu extensible. It is intended to hold more composer tools later.

### Document Context Availability

Relevant functions:

```js
hydrateStoredDocuments()
hasPersistentDocumentContent(documentItem)
normalizeStoredDocumentContent(documentItem)
buildContext(documents, query)
collectChunks(documents)
pageSections(documentItem)
hasDocumentContext(documentItem)
pickRelevantChunks(chunks, query, budget)
```

Important:

- Sidebar file metadata does not guarantee usable document context.
- Usable document payload has at least one of:
  - `text`
  - `pages[].text`
  - `sheets[].text`
  - `imageBase64` for images
- Server memory cannot recover files after restart if the browser only has old summary metadata.

## Recent Changes Reflected Here

- Added primary `대화` / `캘린더` navigation.
- Added calendar month view, upcoming event list, event dialog, and event cards.
- Added local calendar persistence under encrypted app state.
- Added `/api/agent/intent`.
- Added `/api/holidays`.
- Added `server/calendarAgent.js`.
- Added `server/holidays.js`.
- Chat prompt can now trigger calendar CRUD when a calendar intent is detected.
- Calendar now supports month/week/day views, Korean holiday display, scoped `Shift+N`, and browser-tab reminder checks.
- Calendar natural-language handling now uses `calendar.propose` for tentative schedule requests and stores pending create actions until the user confirms.
- `/api/agent/intent` now accepts recent messages and `pendingAction` to handle follow-up confirmations.
- Month-range schedule queries such as `5월 전체 일정 보고해` are deterministically corrected to the first and last day of that month.
- Full-month daily create queries such as `5월 전체 일정에 오전 9시부터 10분간 스트레칭을 등록해` are expanded into one event per day.
- Added `server/retrieval.js` to pick relevant document chunks for long documents.
- README and handoff notes updated to reflect the current live model and calendar state.

## Known Constraints / Next Improvements

Good next steps:

- Add stronger confirmation UX for AI calendar delete/update operations.
- Add recurrence, richer reminder options, timezone display, and multi-calendar support.
- Add external calendar integration only after local CRUD is stable.
- Split the large `public/app.js` calendar code into focused modules.
- Add browser smoke tests for chat, upload, visualization, and calendar flows.
- Add storage usage display for IndexedDB.
- Add export/import for encrypted app data.
- Add password-based encryption option instead of only local CryptoKey.
- Add OCR for scanned PDFs/images.
- Restore or replace `llm_performance_dummy.csv` if visualization fixtures are still needed.

Potential issue:

- Because uploaded files and calendar data are in browser IndexedDB, large files/images can make encrypted app state large.
- `/api/chat` uses:

```js
app.use(express.json({ limit: process.env.MAX_JSON_BYTES || "80mb" }));
```

If users store/send larger payloads, consider chunked transport or a proper local RAG index.

## Recent Verification

Commands run during this refresh:

```powershell
Get-ChildItem -Recurse -Include *.js -Path .\server,.\public | ForEach-Object { node --check $_.FullName }
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/status' -TimeoutSec 10 | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/agent/intent' -Method Post -ContentType 'application/json; charset=utf-8' -Body '{"prompt":"5월 전체 일정 보고해.","model":"gemma4:e2b","currentDate":"2026-05-03T11:00:00+09:00"}' | ConvertTo-Json -Depth 6
```

Results:

- JavaScript syntax check passed with no output.
- `/api/status` returned `ok: true`, default model `gemma4:e2b`, and models `gemma4:e4b`, `gemma4:e2b`.
- `/api/agent/intent` returned `calendar.list` with `from: "2026-05-01"` and `to: "2026-05-31"` for `5월 전체 일정 보고해.`

Not run in this refresh:

- Browser UI smoke test.
- Playwright screenshots.
- `npm audit`.

## Operational Notes For Next Agent

- Prefer small, focused edits.
- Use `apply_patch` for file edits.
- Do not revert uncommitted calendar work unless the user explicitly asks.
- Do not assume uploaded file payloads are server-persistent. Client IndexedDB is the durable source.
- If changing file persistence, avoid reintroducing server-memory reconciliation that deletes local room documents.
- If changing chat generation, preserve abort behavior via `AbortController`.
- If changing assistant rendering, preserve markdown-lite behavior and table/list support.
- If changing settings, keep `state.settings` backward compatible with old IndexedDB records.
- Prefer `--accent` / `--accent-dark` over hardcoded brand colors for new UI.
- If changing visualization, preserve the plan-first contract:
  - LLM chooses analytical intent, chart type, columns, and aggregation.
  - Server validates and computes chart data.
  - Browser renders the final validated spec.
  - Keep `source: "llm"` vs `source: "fallback"` visible.
- If changing calendar, preserve the split:
  - LLM extracts intent and fields.
  - Local deterministic code mutates `state.calendar.events`.
  - Destructive operations should get better confirmation, not less.
