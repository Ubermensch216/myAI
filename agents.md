# Agent Handoff Notes

## Project

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX-backed visualizations, a local AI calendar agent, encrypted local persistence, and personalized UI settings.

Current workspace:

```text
C:\Dev\myAI
```

Current live status checked on 2026-05-04:

```json
{
  "ok": true,
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "gemma4:e2b",
  "models": ["bge-m3:latest", "gemma4:e4b", "gemma4:e2b"]
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
- Current local `.env`: `EMBED_MODEL=nomic-embed-text`. This model is not currently listed by `/api/status`; local smoke test therefore logs embedding 404 warnings and retrieval falls back to BM25.
- Code fallback in `server/ollama.js`: `gemma3n:e2b`. `server/calendarAgent.js` imports `OLLAMA_URL` and `DEFAULT_MODEL` directly from `server/ollama.js`.
- `.env.example` also defaults to `gemma3n:e2b`.
- `.env.example` sets `EMBED_MODEL=bge-m3`. `server/embeddings.js` falls back to `nomic-embed-text` only when no env value is present.
- Embedding calls use Ollama `/api/embed`. Retrieval catches embedding failures and falls back to BM25 keyword search.
- `QUERY_EXPANSION_ENABLED` defaults to true. `QUERY_EXPANSION_VARIANTS` defaults to `3`; `QUERY_EXPANSION_TIMEOUT_MS` defaults to `6000`.
- `KOREA_HOLIDAY_SERVICE_KEY` is optional. If configured, `/api/holidays` uses the official Korean public-holiday API; otherwise it returns a limited fixed-solar-holiday fallback.
- `ADMIN_TOKEN` is optional but required for department-notebook management endpoints. When unset, all admin routes return 503 and the "부서노트북 관리" UI button stays hidden.
- `NOTEBOOK_QUERY_BUDGET` (default `12000`) caps how many characters of notebook chunks are inlined per chat turn.
- `CHUNK_WINDOW_CHARS` (default `1024`) and `CHUNK_OVERLAP_CHARS` (default `256`) control sliding-window chunking for room uploads and notebook ingest. `CHUNK_TARGET_CHARS` is still accepted as a compatibility fallback for the window size.

Current worktree notes at this refresh:

- Worktree was clean before this documentation refresh.
- During the refresh, additional code changes appeared that were not made by this docs pass:
  - `server/queryExpansion.js` (new)
  - `server/retrieval.js` adds `multiQueryHybridSelect()`
  - `server/notebooks.js` uses `expandQuery()` + `multiQueryHybridSelect()`
  Treat them as user/parallel-agent changes unless confirmed otherwise; do not revert them casually.
- This documentation refresh updates `agents.md` and `README.md` to match current retrieval/embedding code and live `/api/status`.

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
server/embeddings.js
server/queryExpansion.js
server/calendarAgent.js
server/holidays.js
server/notebooks.js
server/auth.js
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
    - `GET /api/admin/status`
    - `POST /api/admin/verify`
    - `GET /api/notebooks`, `GET /api/notebooks/:id`
    - `POST /api/notebooks`, `PATCH /api/notebooks/:id`, `DELETE /api/notebooks/:id`
    - `POST /api/notebooks/:id/documents`, `DELETE /api/notebooks/:id/documents/:documentId`
  - Delegates upload filename repair and document serialization to shared helpers.

- `server/env.js`
  - Dependency-free project-root `.env` loader.
  - Existing process environment variables win over `.env` values.

- `server/documents.js`
  - Common document summary/full-payload serialization helpers.
  - Exports `pageSections(documentItem)` — maps a parsed document's pages/sheets to a uniform section array. Shared by `server/ollama.js` and `server/notebooks.js`.

- `server/ollama.js`
  - Ollama streaming chat call.
  - Follow-up question generation.
  - LLM visualization plan generation, repair, and interpretation.
  - Model/system prompt construction.
  - Personal settings and custom prompt injection.
  - Document/image context attachment.
  - Uses `slidingChunkText()` to chunk room-uploaded documents with overlap.
  - When room document context exceeds `MAX_CONTEXT_CHARS`, batch-embeds query + chunks through `server/embeddings.js`, then calls `server/retrieval.js#hybridSelect()`.
  - Falls back to BM25-only retrieval if the embedding model or `/api/embed` call fails.

- `server/embeddings.js`
  - Loads `.env` and calls Ollama `/api/embed`.
  - Exports `embedTexts(texts)` and `embedText(text)`.
  - Uses `EMBED_MODEL` from env, or `nomic-embed-text` when unset. Current `.env.example` sets `bge-m3`.
  - Throws on unavailable/invalid embedding responses; callers catch and degrade to BM25.

- `server/queryExpansion.js`
  - Generates retrieval-friendly variants for department-notebook search via Ollama chat JSON.
  - Exports `expandQuery(query)` plus `QUERY_EXPANSION_ENABLED` and `QUERY_EXPANSION_MAX_VARIANTS`.
  - Defaults: enabled, 3 variants, 6s timeout.
  - Always returns an array starting with the original query; on disabled/timeout/model/parse failure, returns `[original]`.

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

- `server/notebooks.js`
  - Department notebook (RAG) storage layer backed by `data/notebooks/<id>/`.
  - `manifest.json` per notebook with `documents[]` summary; one parsed-document JSON file per uploaded document under `docs/<docId>.json`.
  - Reuses `server/parsers.js` for ingest and `server/parsers.js#slidingChunkText` for overlapping chunking.
  - During ingest, tries to batch-generate chunk embeddings with `server/embeddings.js#embedTexts`; stored document JSON can include `chunks[].embedding`.
  - During query, calls `server/queryExpansion.js#expandQuery` to produce search variants, then tries `server/embeddings.js#embedTexts` for those variants.
  - Calls `server/retrieval.js#multiQueryHybridSelect`; embedding failures fall back to multi-query BM25.
  - Uses `server/retrieval.js#greedyFit` as a budget-aware fallback when no query tokens are present.
  - Uses `server/documents.js#pageSections` to map document pages/sheets to section arrays during ingest.
  - `queryNotebook(id, query)` returns ranked chunks tagged with `citationId`, `documentName`, and `locator` (page/sheet/slide).
  - Pure storage/retrieval — no chat LLM calls. Caller is responsible for building the prompt context.
  - Current caveat: `queryNotebook()` does not yet copy `chunk.embedding` from stored records into the `allChunks` objects passed to `multiQueryHybridSelect()`, so notebook vector ranking is effectively disabled until that field is carried through; query-expanded BM25 still works.

- `server/auth.js`
  - `requireAdmin` Express middleware that compares `Authorization: Bearer <token>` against `ADMIN_TOKEN` using a constant-time comparison.
  - Returns 503 when `ADMIN_TOKEN` is not configured, 401 on mismatch.
  - `isAdminConfigured()` is used by `/api/admin/status` so the UI can decide whether to show the admin panel button.

- `server/parsers.js`
  - Parses uploaded file types into common document objects.
  - Exports both paragraph-oriented `chunkText()` and overlapping `slidingChunkText()`.
  - `slidingChunkText()` snaps boundaries to paragraph → sentence → whitespace where possible.
  - Extracts text from Office/HWPX ZIP XML formats.
  - Preserves CSV/XLSX tabular data as headers, rows, samples, and column profiles for visualization.

- `server/retrieval.js`
  - Tokenizes text with CJK bigram support.
  - Uses BM25-like scoring to pick relevant document chunks for long-context chat.
  - Exports `cosineSimilarity(a, b)` for embedding vectors.
  - Exports `hybridSelect(chunks, query, budget, queryEmbedding)` using Reciprocal Rank Fusion (BM25 rank + vector rank).
  - Exports `multiQueryHybridSelect(chunks, queries, queryEmbeddings, budget)` for query-expansion retrieval; it fuses BM25/vector rankings for multiple queries through RRF.
  - Exports `greedyFit(chunks, budget)` — used as a budget fallback when no useful retrieval signal is available.

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
  - `.calendar-area` uses `display: flex; flex-direction: column` so `.calendar-body` always fills remaining height regardless of whether the command-result panel is shown.
  - `.calendar-body` has `flex: 1; min-height: 0` and internally uses `grid-template-rows: auto minmax(0, 1fr)`.
  - `.calendar-grid` uses `grid-auto-rows: minmax(0, 1fr); height: 100%` for dynamic cell heights.
  - Calendar grid responsive breakpoints use CSS container queries (`@container calendar`) on `.calendar-body`, not viewport media queries.

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
-> server/parsers.js#slidingChunkText creates overlapping chunks
-> if context is too large, server/embeddings.js tries query+chunk embeddings
-> server/retrieval.js#hybridSelect picks chunks by BM25 + vector RRF
-> if embedding fails, retrieval falls back to BM25
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

### Department Notebook (RAG)

```text
chat prompt + room.selectedNotebookId
-> POST /api/chat { ..., notebookId }
-> server/ollama.js#streamChat awaits server/notebooks.js#queryNotebook
-> server/queryExpansion.js#expandQuery creates retrieval variants
-> server/retrieval.js#multiQueryHybridSelect fuses variant BM25/vector rankings
-> top ranked chunks tagged with [N] citation IDs
   (query expansion + BM25 currently effective; vector ranking path exists but stored embeddings are not carried through yet)
-> system message gains [노트북 컨텍스트] block + strict grounding rules
-> Ollama streams answer
-> X-Notebook-Meta response header carries base64-JSON {notebook, citations[]}
-> public/app.js renders inline [N] markers in body and a citations panel below
-> assistantMessage.citations is persisted with the room in encrypted IndexedDB
```

Important design points:

- Notebook content lives on the server filesystem. It is shared across users.
- Per-room state (`selectedNotebookId`) is persisted in encrypted IndexedDB. New rooms default to `null`.
- Notebook ingest stores chunk JSON under `data/notebooks/<id>/docs/<docId>.json`; embeddings are attempted at ingest time but current query mapping omits `embedding`, so fix that before claiming semantic notebook retrieval quality.
- Notebook search now has LLM query expansion before retrieval; if expansion fails or is disabled, it uses the original query only.
- Strict grounding is enforced via system prompt. The LLM is told to answer only from notebook + room files and to say "해당 노트북에서 관련 정보를 찾을 수 없습니다." when the answer cannot be grounded.
- Room attachments and notebook chunks coexist in the system prompt; the prompt explicitly marks notebook as primary.
- Admin endpoints are token-gated. Only `GET /api/notebooks` and `GET /api/notebooks/:id` are public so users can pick from the list.

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
  Notebook context bar (visible only when room.selectedNotebookId is set)
  Messages
  Prompt composer with + menu (file attach, notebook select) + active-notebook badge

캘린더 view:
  Month toolbar: previous / today / next / month label
  AI calendar command bar
  Command result panel
  Month grid
```

Dialogs:

```text
eventDialog:
  title  [완료 checkbox — inline right, edit mode only]
  start / end  [종일 checkbox — inline right of 종료]
  location
  notes
  color picker
  delete / cancel / save

notebookSelectorDialog:
  list of notebooks (with "사용 안 함" sentinel as first item)
  click to select → selection persisted on the active room

adminNotebookDialog (visible only when ADMIN_TOKEN is configured server-side):
  step 1: ADMIN_TOKEN input → POST /api/admin/verify
  step 2: notebook list with name/description/document list
          + 새 노트북 form (name + description)
          + 문서 추가 (file picker per notebook)
          + 문서 삭제 + 노트북 삭제 (with confirm)

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
  selectedColor: "accent",
  holidaysByYear: {},
  holidayWarnings: {},
  holidayRequests: new Set(),
  reminderTimer: null
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
  done,        // boolean — completion state; persisted via normalizeCalendarEvent spread
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
- Sidebar shows upcoming events within 7 days from today (not a fixed count).
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
- Each event has a `done` boolean toggled via:
  - A circular check button on each upcoming-event row in the sidebar.
  - A `완료` checkbox inline in the event edit dialog (hidden during create).
- Toggling done calls `toggleEventDone(eventId)` which flips `event.done`, calls `renderCalendar()` (re-renders both grid chips and upcoming list), and calls `scheduleSave()`.
- Done events appear with strikethrough in the upcoming list and with `opacity: 0.55; filter: grayscale(0.35)` on grid chips.

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
- AI delete by date range and AI delete by exact single-candidate title now ask through `window.confirm()` before mutation. Multiple title matches ask for a more specific request.
- AI update matches by partial title, asks for confirmation via `window.confirm()`, and checks time conflicts when `start`, `end`, or `allDay` changes.
- Before production use, replace destructive `window.confirm()` flows with richer in-app review dialogs.

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
  personalization,
  notebookId        // optional; activates RAG mode against a specific notebook
}
```

Streams plain text from Ollama.

When `notebookId` resolves to a notebook with chunks, the response includes an `X-Notebook-Meta` header containing a base64-encoded JSON object:

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ]
}
```

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

### Department Notebook endpoints

- `GET /api/admin/status` — `{ configured: boolean }`. Public.
- `POST /api/admin/verify` — admin-only. Returns 200 if the bearer token matches `ADMIN_TOKEN`, else 401.
- `GET /api/notebooks` — public. Returns `{ notebooks: [{id, name, description, documentCount, updatedAt}] }`.
- `GET /api/notebooks/:id` — public. Returns the manifest plus `documents[]` summary.
- `POST /api/notebooks` — admin. Body `{ name, description? }`. Returns the new summary.
- `PATCH /api/notebooks/:id` — admin. Body `{ name?, description? }`.
- `DELETE /api/notebooks/:id` — admin. Removes the entire `data/notebooks/<id>/` directory.
- `POST /api/notebooks/:id/documents` — admin, multipart `file`. Parses with `server/parsers.js` and stores chunks under the notebook. Images are rejected.
- `DELETE /api/notebooks/:id/documents/:documentId` — admin. Removes a single document.

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
buildContext(documents, query)         // server/ollama.js
collectChunks(documents)               // server/ollama.js
pageSections(documentItem)             // server/documents.js — shared with notebooks.js
hasDocumentContext(documentItem)       // server/ollama.js
slidingChunkText(text, options)        // server/parsers.js
embedTexts(texts), embedText(text)     // server/embeddings.js
expandQuery(query)                     // server/queryExpansion.js
pickRelevantChunks(chunks, query, budget)  // server/retrieval.js
hybridSelect(chunks, query, budget, queryEmbedding)  // server/retrieval.js
multiQueryHybridSelect(chunks, queries, queryEmbeddings, budget)  // server/retrieval.js
greedyFit(chunks, budget)             // server/retrieval.js
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

- Server-side refactoring (2026-05-04):
  - Extracted `pageSections()` from `server/ollama.js` and `server/notebooks.js` into `server/documents.js` (was duplicated identically in both). Both modules now import it.
  - Exported `greedyFit()` from `server/retrieval.js`. Replaced `greedyFitWithMeta` in `server/notebooks.js` with the shared export.
  - Removed `loadLocalEnv()` call and independent `OLLAMA_URL`/`DEFAULT_MODEL` declarations from `server/calendarAgent.js`. Now imports both from `server/ollama.js`.
  - Added `toDateISO(date)` helper in `server/calendarAgent.js` to replace repeated `padStart`-based date formatting in `buildSystemPrompt` and `addOneHour`.
  - Added `extractPersonalization(body)` helper in `server/index.js`; replaced three inline repetitions across `/api/chat`, `/api/visualize`, and `/api/followups`.
  - Removed redundant `normalizeRows` pre-call from `parsers.js#parseCsv` and `readWorksheetRows`; `buildTableFromRows` remains the single normalization point.

- Retrieval and RAG update (2026-05-04):
  - Added `server/embeddings.js` for Ollama `/api/embed` batch/single embedding calls.
  - `.env.example` now includes `EMBED_MODEL=bge-m3`; code fallback is `nomic-embed-text`.
  - Added `server/queryExpansion.js` for LLM-generated retrieval variants with timeout/fallback.
  - Added `server/parsers.js#slidingChunkText()` with overlap and natural-boundary snapping.
  - `server/ollama.js` now uses sliding chunks and, for oversized room document context, batch-embeds query + chunks before calling `hybridSelect()`.
  - `server/retrieval.js` now exports `cosineSimilarity()`, `hybridSelect()`, and `multiQueryHybridSelect()` using Reciprocal Rank Fusion of BM25 rank and vector rank.
  - `server/notebooks.js` attempts embedding generation during notebook document ingest, stores vectors in document JSON, expands queries at retrieval time, and calls `multiQueryHybridSelect()`.
  - Current notebook caveat: `queryNotebook()` does not copy stored `chunk.embedding` into the query-time chunk objects, so notebook retrieval is effectively query-expanded BM25 until fixed.

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
- Added department notebook (RAG) feature:
  - New `server/notebooks.js` and `server/auth.js` modules.
  - 9 new endpoints under `/api/notebooks/...` and `/api/admin/...`.
  - `streamChat` accepts `notebookId`, fetches ranked chunks from the chosen notebook, and injects a strict-grounding system prompt that forbids answering outside the notebook + room files.
  - `/api/chat` exposes citation metadata via the `X-Notebook-Meta` response header (base64-encoded JSON).
  - Browser UI: '+' menu now has a "부서노트북" entry; active selection is shown as a pill-shaped badge in the composer plus a context bar under the chat header. Each room maintains its own `selectedNotebookId`; new rooms default to `null`.
  - Citations rendered as a structured panel below assistant answers; `[1]`, `[2]` markers stay inline as plain text in the answer body.
  - Admin panel reachable from settings dialog when `ADMIN_TOKEN` is configured. Token is held in `sessionStorage` (cleared on tab close).
- Added `done` boolean field to calendar events; persisted transparently via `normalizeCalendarEvent` spread.
- Upcoming events sidebar now shows only events within 7 days of today (was: up to 8 events with no date cutoff).
- Added `toggleEventDone(eventId)` — flips `event.done`, re-renders calendar grid chips and upcoming list, and schedules a save.
- Event edit dialog now shows a `완료` checkbox (hidden in create mode) inline to the right of the title field.
- `종일` checkbox moved inline to the right of the `종료` field (was a separate row).
- Fixed calendar cell height: `.calendar-area` changed from `display: grid` with four row tracks to `display: flex; flex-direction: column` so `.calendar-body` always occupies the `flex: 1` remaining space regardless of command-result panel visibility.
- Calendar grid responsive breakpoints use `@container calendar` container queries instead of `@media` viewport queries.

## Known Constraints / Next Improvements

Good next steps:

- Replace simple `window.confirm` calendar delete/update confirmations with a richer in-app review dialog if this becomes production-facing.
- Add recurrence, richer reminder options, timezone display, and multi-calendar support.
- Add external calendar integration only after local CRUD is stable.
- Split the large `public/app.js` calendar code into focused modules.
- Add browser smoke tests for chat, upload, visualization, and full calendar UI flows.
- Fix notebook semantic retrieval by carrying stored `chunk.embedding` through `queryNotebook()` into `multiQueryHybridSelect()`.
- Add a persistent local retrieval index/vector store when notebook volume grows beyond small JSON-file scans.
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

Commands run during this refresh (2026-05-04):

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/status'
npm test
```

Results:

- `/api/status` returned `ok: true`, default model `gemma4:e2b`, and models `bge-m3:latest`, `gemma4:e4b`, `gemma4:e2b`.
- `npm test` passed:
  - `app shell ids exist`
  - `GET /api/status`
  - `POST /api/agent/intent month range`
  - `parser and notebook CRUD`
- `npm test` logged three notebook embedding warnings because current local `.env` uses `EMBED_MODEL=nomic-embed-text`, but that model is not installed. The fallback path worked and tests still passed.

Not run in this refresh:

- Full recursive `node --check`.
- Browser UI smoke test.
- `npm audit`.

## Operational Notes For Next Agent

- Prefer small, focused edits.
- Use `apply_patch` for file edits.
- Check `git status --short` before editing; do not revert user changes unless explicitly asked.
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
