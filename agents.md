# Agent Handoff Notes

## Project

myAI is a local Ollama-based AI secretary web app. It supports chat, document/image analysis, CSV/XLSX-backed visualizations, a local AI calendar agent, department-notebook RAG, whole-document Map-Reduce analysis, encrypted local persistence, and personalized UI settings.

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

Model and env notes:

- Current local `.env`: `OLLAMA_MODEL=gemma4:e2b`.
- Current local `.env`: `EMBED_MODEL=nomic-embed-text`. This model is not currently listed by `/api/status`; embedding calls log 404 warnings and retrieval falls back to BM25.
- Code fallback in `server/ollama.js`: `gemma3n:e2b`.
- `.env.example` defaults to `OLLAMA_MODEL=gemma3n:e2b` and `EMBED_MODEL=bge-m3`.
- `server/calendarAgent.js` imports `OLLAMA_URL` and `DEFAULT_MODEL` directly from `server/ollama.js`.
- Embedding calls use Ollama `/api/embed`. Callers catch failures and degrade to BM25.
- `QUERY_EXPANSION_ENABLED` defaults to true. `QUERY_EXPANSION_VARIANTS` defaults to `3`; `QUERY_EXPANSION_TIMEOUT_MS` defaults to `6000`.
- `DOC_ANALYSIS_ENABLED` defaults to true. `DOC_ANALYSIS_MAX_INPUT_CHARS` defaults to `12000`; `DOC_ANALYSIS_TIMEOUT_MS` defaults to `30000`.
- `MAP_REDUCE_BATCH_CHUNKS` defaults to `4`; `MAP_REDUCE_MAX_CHUNKS` defaults to `80`; `MAP_REDUCE_PARALLELISM` defaults to `2`; `MAP_REDUCE_MAP_TIMEOUT_MS` defaults to `45000`.
- `KOREA_HOLIDAY_SERVICE_KEY` is optional. If configured, `/api/holidays` uses the official Korean public-holiday API; otherwise it returns a limited fixed-solar-holiday fallback.
- `ADMIN_TOKEN` is optional but required for department-notebook management endpoints. When unset, admin routes return 503 and the "부서노트북 관리" UI button stays hidden.
- `NOTEBOOK_QUERY_BUDGET` (default `12000`) caps how many characters of notebook chunks are inlined per chat turn.
- `CHUNK_WINDOW_CHARS` (default `1024`) and `CHUNK_OVERLAP_CHARS` (default `256`) control sliding-window chunking. `CHUNK_TARGET_CHARS` is still accepted as a compatibility fallback for window size.

Current worktree notes at this refresh:

- The worktree is not clean. Current non-doc code changes were already present and were not made by this documentation pass:
  - `.env.example`
  - `public/app.js`
  - `public/index.html`
  - `public/styles.css`
  - `server/documents.js`
  - `server/index.js`
  - `server/notebooks.js`
  - `server/ollama.js`
  - new `server/documentAnalysis.js`
  - new `server/mapReduce.js`
- Treat these as user/parallel-agent changes unless confirmed otherwise; do not revert them casually.
- This documentation refresh updates `agents.md` and `README.md` to match the current document pre-analysis, retrieval, RAG, and Map-Reduce code.

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
server/documentAnalysis.js
server/mapReduce.js
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
  - Parses uploads with `server/parsers.js`, then runs `analyzeDocument()` for normal documents and stores `summary`/`topics` on the parsed payload.
  - `POST /api/chat` accepts `mode`; only `"map_reduce"` activates the Map-Reduce path, otherwise normal chat.
  - `X-Notebook-Meta` can include `analysisMode`.
  - Delegates personalization extraction to `extractPersonalization(body)`.

- `server/documents.js`
  - Common document summary/full-payload serialization helpers.
  - `summarizeDocument()` includes `summary` and `topics`.
  - Exports `pageSections(documentItem)`, mapping pages/sheets/slides to a uniform section array.

- `server/ollama.js`
  - Ollama streaming chat call.
  - Follow-up question generation.
  - LLM visualization plan generation, repair, and interpretation.
  - Model/system prompt construction, personalization, custom prompt injection.
  - Document/image context attachment.
  - Injects uploaded-document overviews via `formatAttachmentOverview()`.
  - Injects cited notebook document summaries via `formatDocumentSummariesBlock()`.
  - Uses `expandQuery()` and `multiQueryHybridSelect()` for long uploaded document context when needed.
  - Handles normal notebook RAG through `queryNotebook()`.
  - Handles `mode: "map_reduce"` through `runMapReduceChat()`, loading notebook chunks with `loadAllNotebookChunks()` or room chunks with `collectChunks()`.
  - Emits Map-Reduce progress lines and appends a truncation warning if `MAP_REDUCE_MAX_CHUNKS` is exceeded.

- `server/embeddings.js`
  - Loads `.env` and calls Ollama `/api/embed`.
  - Exports `embedTexts(texts)` and `embedText(text)`.
  - Uses `EMBED_MODEL` from env, or `nomic-embed-text` when unset.
  - Throws on unavailable/invalid embedding responses; callers catch and degrade to BM25.

- `server/queryExpansion.js`
  - Generates retrieval-friendly query variants through Ollama JSON output.
  - Exports `expandQuery(query)` plus config constants.
  - Always returns an array starting with the original query; disabled/timeout/parse/model failures return `[original]`.

- `server/documentAnalysis.js`
  - Upload-time and notebook-ingest document pre-analysis.
  - Exports `analyzeDocument(parsedDocument, { model } = {})`.
  - Samples document head/tail up to `DOC_ANALYSIS_MAX_INPUT_CHARS`.
  - Asks Ollama for Korean JSON containing a short `summary` and up to 8 `topics`.
  - Returns `{ summary: "", topics: [] }` on disabled/no body/timeout/parse failure.

- `server/mapReduce.js`
  - Whole-document analysis helper used by `/api/chat` with `mode: "map_reduce"`.
  - Batches chunks by `MAP_REDUCE_BATCH_CHUNKS`.
  - Runs map calls in parallel according to `MAP_REDUCE_PARALLELISM`.
  - Streams final reduce answer in Korean.
  - Exports `streamMapReduceAnalysis()` and Map-Reduce config constants.

- `server/calendarAgent.js`
  - LLM-backed calendar intent classifier.
  - Calls Ollama with `format: "json"` and `think: false`.
  - Valid intents: `chat`, `calendar.propose`, `calendar.create`, `calendar.list`, `calendar.delete`, `calendar.update`.
  - Resolves relative Korean dates with `currentDate`.
  - Accepts recent messages and pending calendar action, so confirmation replies like `응, 추가해줘` can become concrete calendar operations.
  - Applies deterministic month-range and daily-repeat corrections.
  - Does not mutate calendar data; the browser owns local calendar state.

- `server/holidays.js`
  - Loads Korean public holidays by year.
  - Uses KASI/Data.go.kr `SpcdeInfoService/getRestDeInfo` when `KOREA_HOLIDAY_SERVICE_KEY` is configured.
  - Falls back to fixed solar holidays.

- `server/notebooks.js`
  - Department notebook storage layer backed by `data/notebooks/<id>/`.
  - Manifest per notebook plus one parsed-document JSON per uploaded document under `docs/<docId>.json`.
  - Reuses parsers and `slidingChunkText()` for ingest.
  - During ingest, tries chunk embeddings and document pre-analysis; stores `summary` and `topics` in both document JSON and manifest document summaries.
  - During query, expands the query, tries query embeddings, then calls `multiQueryHybridSelect()`.
  - `queryNotebook(id, query)` returns `{ ok, notebook, chunks, documentSummaries }`; `documentSummaries` includes only cited documents.
  - Exports `loadAllNotebookChunks(notebookId)` for Map-Reduce.
  - Exports `getNotebookManifestSummary(notebookId)` for metadata.
  - Current caveat: query-time chunk objects do not yet carry stored `chunk.embedding`, so notebook vector ranking is effectively disabled until that field is passed through; query-expanded BM25 still works.

- `server/auth.js`
  - `requireAdmin` middleware compares `Authorization: Bearer <token>` against `ADMIN_TOKEN` using constant-time comparison.
  - Returns 503 when `ADMIN_TOKEN` is unset, 401 on mismatch.

- `server/parsers.js`
  - Parses uploaded file types into common document objects.
  - Exports `chunkText()` and overlapping `slidingChunkText()`.
  - Preserves CSV/XLSX tabular data as headers, rows, samples, and column profiles.

- `server/retrieval.js`
  - Tokenizes text with CJK bigram support.
  - Exports BM25 selection, `cosineSimilarity()`, `hybridSelect()`, `multiQueryHybridSelect()`, and `greedyFit()`.
  - `multiQueryHybridSelect()` fuses rankings for query variants and optional vectors using Reciprocal Rank Fusion.

- `server/visualization.js`
  - Detects visualization intent.
  - Builds compact table context for the model.
  - Normalizes and validates `analysis + visualizationPlan` JSON.
  - Executes accepted plans against real CSV/XLSX rows.
  - Computes data for `bar`, `line`, `pie`, `scatter`, `table`, `kpi`, and `infographic`.

- `server/documentStore.js`
  - In-memory server-side document map.
  - Runtime-only helper for upload summaries and legacy hydration.

- `public/index.html`
  - Main app shell.
  - Left sidebar with brand banner and primary `대화` / `캘린더` navigation.
  - Chat view, calendar view, event dialog, settings dialog, notebook dialogs, drop overlay.
  - Composer includes `deepAnalysisToggle` labeled `전체 분석`.

- `public/app.js`
  - Main frontend state and UI behavior.
  - Encrypted IndexedDB persistence.
  - Rooms, messages, files, settings, calendar events.
  - Upload, drag/drop, clipboard image paste.
  - Streaming response handling and generation abort.
  - Routes visualizable tabular prompts to `/api/visualize`.
  - Routes suspected calendar prompts to `/api/agent/intent`.
  - Sends `mode: "map_reduce"` when `state.deepAnalysisEnabled` is true, then resets the toggle after the request.
  - Executes local calendar CRUD and renders event cards.
  - Follow-up suggestion rendering and click-to-send behavior.

- `public/styles.css`
  - Layout, themes, message UI, thinking UI, buttons, settings modal.
  - Primary nav, calendar UI, notebook UI, and `deep-analysis-toggle` styles.
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

### Document Pre-Analysis

```text
POST /api/upload or notebook document ingest
-> server/parsers.js parses document
-> server/documentAnalysis.js samples document text
-> Ollama returns { summary, topics[] }
-> summary/topics are stored in document payload and summaries
-> later chat context can include [첨부 파일 개요] or [문서 개요]
```

### Long Document Context

```text
room documents in IndexedDB
-> client sends active room documents
-> server/ollama.js collects text/pages/sheets
-> server/parsers.js#slidingChunkText creates overlapping chunks
-> server/queryExpansion.js#expandQuery creates retrieval variants
-> server/embeddings.js tries query+chunk embeddings
-> server/retrieval.js#multiQueryHybridSelect or hybridSelect picks chunks
-> if embedding fails, retrieval falls back to BM25/CJK bigram
-> selected context is injected into the system message
```

### Map-Reduce Whole Analysis

```text
composer "전체 분석" enabled
-> POST /api/chat { mode: "map_reduce", notebookId?, documents? }
-> server/ollama.js#runMapReduceChat
-> selected notebook: server/notebooks.js#loadAllNotebookChunks
-> no notebook: server/ollama.js#collectChunks over room documents
-> server/mapReduce.js#streamMapReduceAnalysis
-> map batches run with bounded parallelism
-> reduce answer streams to the browser
```

Important:

- This path is for full-document or full-notebook analysis, not normal fast chat.
- It is slower and may truncate at `MAP_REDUCE_MAX_CHUNKS`.
- If no analyzable chunks exist, it answers: `사용자님, 분석할 자료를 먼저 업로드하거나 부서노트북을 선택해 주세요.`

### Department Notebook (RAG)

```text
chat prompt + room.selectedNotebookId
-> POST /api/chat { ..., notebookId }
-> server/ollama.js#streamChat awaits server/notebooks.js#queryNotebook
-> server/queryExpansion.js#expandQuery creates retrieval variants
-> server/retrieval.js#multiQueryHybridSelect fuses variant BM25/vector rankings
-> top ranked chunks tagged with [N] citation IDs
-> cited document summaries/topics are injected as [문서 개요]
-> system message gains [노트북 컨텍스트] block + strict grounding rules
-> Ollama streams answer
-> X-Notebook-Meta response header carries base64-JSON { notebook, citations[], analysisMode }
-> public/app.js renders inline [N] markers and a citations panel
-> assistantMessage.citations is persisted with the room in encrypted IndexedDB
```

Important design points:

- Notebook content lives on the server filesystem. It is shared across users.
- Per-room state (`selectedNotebookId`) is persisted in encrypted IndexedDB. New rooms default to `null`.
- Strict grounding is enforced via system prompt. The model is told to answer only from notebook + room files and to say `해당 노트북에서 관련 정보를 찾을 수 없습니다.` when the answer cannot be grounded.
- Room attachments and notebook chunks coexist in the system prompt; notebook is marked primary.
- Admin endpoints are token-gated. Only `GET /api/notebooks` and `GET /api/notebooks/:id` are public.
- Notebook ingest stores embeddings, summaries, and topics, but query-time vector ranking remains incomplete until stored `chunk.embedding` is passed into selection.

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
  Notebook context bar when room.selectedNotebookId is set
  Messages
  Prompt composer with + menu, active-notebook badge, and 전체 분석 toggle

캘린더 view:
  Month/week/day toolbar
  AI calendar command bar
  Command result panel
  Calendar grid/agenda
```

Dialogs:

```text
eventDialog:
  title  [완료 checkbox, edit mode only]
  start / end  [종일 checkbox]
  location
  notes
  color picker
  delete / cancel / save

notebookSelectorDialog:
  list of notebooks with "사용 안 함" sentinel
  click to select, persisted on active room

adminNotebookDialog:
  visible only when ADMIN_TOKEN is configured
  token verification
  notebook CRUD
  document upload/delete

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
- Room creation, deletion, and title editing.
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
- `전체 분석` toggle sends `mode: "map_reduce"` for the next text chat request and resets afterward.

### Files

- Files are scoped to the active chat room.
- Supported: PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG/JPG/JPEG/WEBP/GIF.
- Upload methods:
  - composer `+` menu, then paperclip
  - drag and drop over the app
  - paste image into prompt input
- Active room file titles render under the selected room in the chat sidebar.
- File deletion asks for confirmation and removes from current room IndexedDB state.
- Upload filenames are normalized server-side; stored mojibake names are repaired at display time.
- Normal document uploads now try to store `summary` and `topics` from `server/documentAnalysis.js`.

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
  done,
  createdAt,
  updatedAt
}
```

Current calendar UI:

- Primary navigation switches between `대화` and `캘린더`.
- Calendar supports `month`, `week`, and `day` view modes.
- Previous/today/next controls move by current view mode.
- Clicking a day opens the create-event dialog at 09:00-10:00.
- Clicking an event chip opens the edit dialog.
- Sidebar shows upcoming events within 7 days from today.
- `Shift+N` is scoped by active primary view:
  - chat view: new chat
  - calendar view: new event
- Korean holidays render in cells and agenda columns.
- Event reminders support start time, 30 minutes before, 1 day before, 2 days before, and 1 week before.
- Event colors: `accent`, `blue`, `green`, `orange`, `purple`, `red`.
- Manual create/edit checks for conflicts and asks for confirmation before saving overlapping events.
- Done events appear with strikethrough in the upcoming list and reduced opacity/grayscale on grid chips.
- AI delete/update operations ask for confirmation before mutation; update checks time conflicts when time fields change.

Natural-language calendar flow:

- `public/app.js#hasCalendarKeyword` prefilters likely calendar prompts.
- `public/app.js#classifyMessageIntent` calls `POST /api/agent/intent`.
- `server/calendarAgent.js#classifyIntent` returns normalized `{ intent, payload }`.
- `calendar.propose` stores a pending create action and asks for confirmation.
- Confirmation messages can execute `room.pendingCalendarAction`.
- Rejection messages clear the pending action.
- Full-month range prompts are deterministically corrected.
- Full-month daily create prompts are represented as `repeat: { frequency: "daily", from, to }` and expanded by the browser.

Calendar limitations and risks:

- Local-only calendar. No Google/Outlook/ICS sync.
- No recurrence model.
- Reminder checks run in the open browser tab at one-minute intervals.
- No timezone UI.
- No multi-calendar account model.
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
- Remaining failures fall back to an automatic server chart marked `source: "fallback"`.
- Successful AI-planned specs are marked `source: "llm"`.

### Persistence

- Conversations, rooms, settings, room-scoped uploaded documents, active view, and calendar events are stored in IndexedDB.
- Storage is encrypted with WebCrypto AES-GCM.

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
- `appLogoDataUrl` remains for backward compatibility.
- The favicon currently stays at `/default-icon.svg`.
- `systemAvatarDataUrl` is used for assistant message avatars.
- `userAvatarDataUrl` is used for user message avatars.
- `aiName` is effectively kept aligned to `appName` in current frontend behavior.
- `customPrompt` is sent as `personalization.customPrompt` and truncated server-side to 4,000 characters.
- Brightness theme is `light` or `dark`.
- Color theme is `busan` or `water`.

## Server API Summary

### `GET /api/status`

Returns Ollama status and model list.

### `POST /api/upload`

Accepts one uploaded file through `multer`.

Returns a full document payload for client-side encrypted persistence. Normal documents include best-effort `summary` and `topics`.

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
  notebookId,      // optional; activates RAG mode
  mode             // optional; "map_reduce" activates whole-analysis mode
}
```

Streams plain text from Ollama.

When notebook or analysis metadata exists, the response includes an `X-Notebook-Meta` header containing base64 JSON:

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ],
  analysisMode: "map_reduce" // or null
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

Returns `{ visualization }`.

### `POST /api/followups`

Body:

```js
{
  model,
  messages,
  personalization
}
```

Returns `{ suggestions: ["...", "...", "..."] }`.

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

### `GET /api/holidays`

Query: `{ year }`.

Returns Korean public holidays for the requested year.

### Department Notebook endpoints

- `GET /api/admin/status` - `{ configured: boolean }`. Public.
- `POST /api/admin/verify` - admin-only. Returns 200 if the bearer token matches `ADMIN_TOKEN`, else 401.
- `GET /api/notebooks` - public notebook summaries.
- `GET /api/notebooks/:id` - public manifest plus document summaries.
- `POST /api/notebooks` - admin. Body `{ name, description? }`.
- `PATCH /api/notebooks/:id` - admin. Body `{ name?, description? }`.
- `DELETE /api/notebooks/:id` - admin. Removes the entire `data/notebooks/<id>/` directory.
- `POST /api/notebooks/:id/documents` - admin multipart `file`; parses and stores chunks. Images are rejected.
- `DELETE /api/notebooks/:id/documents/:documentId` - admin. Removes a single document.

## Important Behavior Details

### Status Indicator

- App status is checked with `/api/status`.
- Current visual status indicator behavior is in the sidebar/brand area and model hint text.

### Assistant Answer Rendering

- The app does not use a full Markdown renderer.
- `public/answerRenderer.js` handles paragraphs, markdown-style tables, bullets, numbered lists, and section labels.
- Do not add a full Markdown renderer without checking regressions in table/list styling.

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

- Chat, visualization, and Map-Reduce fetches use `state.abortController.signal`.
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
.deep-analysis-toggle
```

Keep the composer `+` menu extensible. It is intended to hold more composer tools later.

### Document Context Availability

Relevant functions:

```js
hydrateStoredDocuments()
hasPersistentDocumentContent(documentItem)
normalizeStoredDocumentContent(documentItem)
analyzeDocument(parsedDocument)        // server/documentAnalysis.js
buildContext(documents, query)         // server/ollama.js
collectChunks(documents)               // server/ollama.js
formatAttachmentOverview(documents)    // server/ollama.js
formatDocumentSummariesBlock(items)    // server/ollama.js
runMapReduceChat(options)              // server/ollama.js
streamMapReduceAnalysis(options)       // server/mapReduce.js
pageSections(documentItem)             // server/documents.js
hasDocumentContext(documentItem)       // server/ollama.js
slidingChunkText(text, options)        // server/parsers.js
embedTexts(texts), embedText(text)     // server/embeddings.js
expandQuery(query)                     // server/queryExpansion.js
pickRelevantChunks(chunks, query, budget)  // server/retrieval.js
hybridSelect(chunks, query, budget, queryEmbedding)  // server/retrieval.js
multiQueryHybridSelect(chunks, queries, queryEmbeddings, budget)  // server/retrieval.js
greedyFit(chunks, budget)              // server/retrieval.js
queryNotebook(id, query)               // server/notebooks.js
loadAllNotebookChunks(notebookId)      // server/notebooks.js
getNotebookManifestSummary(notebookId) // server/notebooks.js
```

Important:

- Sidebar file metadata does not guarantee usable document context.
- Usable document payload has at least one of:
  - `text`
  - `pages[].text`
  - `sheets[].text`
  - `imageBase64` for images
- Server memory cannot recover files after restart if the browser only has old summary metadata.
- Document summaries/topics help orient the prompt but are not a replacement for chunk-level grounding.

## Recent Changes Reflected Here

- Server-side refactoring (2026-05-04):
  - Extracted `pageSections()` into `server/documents.js`.
  - Exported `greedyFit()` from `server/retrieval.js`.
  - `server/calendarAgent.js` now imports `OLLAMA_URL` and `DEFAULT_MODEL` from `server/ollama.js`.
  - Added `extractPersonalization(body)` in `server/index.js`.
  - Removed redundant row-normalization pre-calls in CSV/XLSX parsing.

- Retrieval and RAG update (2026-05-04):
  - Added `server/embeddings.js` for Ollama `/api/embed`.
  - Added `server/queryExpansion.js` for LLM-generated retrieval variants.
  - Added `server/parsers.js#slidingChunkText()`.
  - `server/retrieval.js` exports `cosineSimilarity()`, `hybridSelect()`, and `multiQueryHybridSelect()`.
  - `server/notebooks.js` attempts embedding generation during ingest and uses query expansion at retrieval time.
  - Current notebook caveat: stored `chunk.embedding` is not passed into query-time chunk objects, so semantic notebook retrieval is not complete.

- Document analysis and whole-analysis update (2026-05-04):
  - Added `server/documentAnalysis.js`.
  - `/api/upload` now tries to generate document `summary` and `topics`.
  - Notebook document ingest also stores `summary` and `topics`.
  - `server/documents.js#summarizeDocument()` includes `summary` and `topics`.
  - `server/ollama.js` can inject uploaded-file overviews and cited notebook document summaries into prompts.
  - Added `server/mapReduce.js`.
  - `/api/chat` accepts `mode: "map_reduce"`.
  - `public/index.html`, `public/app.js`, and `public/styles.css` add the composer `전체 분석` toggle.
  - `X-Notebook-Meta` may include `analysisMode`.

- Calendar and UI:
  - Added primary `대화` / `캘린더` navigation.
  - Calendar supports month/week/day views, Korean holidays, scoped `Shift+N`, reminders, done state, and event cards.
  - Natural-language calendar handling uses `calendar.propose` for tentative schedule requests and stores pending create actions until user confirmation.
  - `/api/agent/intent` accepts recent messages and `pendingAction`.
  - Month-range and daily-repeat prompts have deterministic corrections.
  - Destructive calendar delete/update flows now ask for confirmation.

- Department notebook:
  - `server/notebooks.js` and `server/auth.js` provide notebook storage and admin gating.
  - `/api/notebooks/...` and `/api/admin/...` endpoints support notebook selection and admin CRUD.
  - `streamChat` accepts `notebookId`, fetches ranked chunks, and injects strict grounding rules.
  - Browser UI includes notebook selection in the composer `+` menu, an active notebook badge/context bar, citation panels, and admin management when `ADMIN_TOKEN` is configured.

## Known Constraints / Next Improvements

Good next steps:

- Fix notebook semantic retrieval by carrying stored `chunk.embedding` through `queryNotebook()` into `multiQueryHybridSelect()`.
- Add a persistent retrieval index/vector store when notebook volume grows beyond small JSON-file scans.
- Improve document-analysis reliability with structured schema validation and retry/repair.
- Add a richer in-app review dialog for destructive calendar operations instead of `window.confirm()`.
- Add recurrence, richer reminders, timezone display, and multi-calendar support.
- Add external calendar integration only after local CRUD remains stable.
- Split the large `public/app.js` calendar/chat/notebook logic into focused modules.
- Add browser smoke tests for chat, upload, visualization, notebook selection, Map-Reduce, and full calendar UI flows.
- Add storage usage display for IndexedDB.
- Add export/import for encrypted app data.
- Add password-based encryption option instead of only local CryptoKey.
- Add OCR for scanned PDFs/images.

Potential issues:

- Uploaded files and calendar data live in browser IndexedDB, so large files/images can make encrypted app state large.
- `/api/chat` uses `app.use(express.json({ limit: process.env.MAX_JSON_BYTES || "80mb" }))`; larger payloads may need chunked transport or a local retrieval index.
- Upload-time document analysis adds LLM latency.
- Map-Reduce analysis is slower than normal RAG and truncates beyond `MAP_REDUCE_MAX_CHUNKS`.
- The local `.env` currently points `EMBED_MODEL` to an unavailable model; use `bge-m3` or pull `nomic-embed-text` to enable embedding calls.

## Recent Verification

Commands run during this refresh (2026-05-04):

```powershell
Invoke-RestMethod -Uri 'http://localhost:3000/api/status'
npm test
```

Results:

- `/api/status` returned `ok: true`, default model `gemma4:e2b`, and models `bge-m3:latest`, `gemma4:e4b`, `gemma4:e2b`.
- First `npm test` attempt failed because the app server was not running on `127.0.0.1:3000`.
- Started the app server in the background for verification. PID from `Start-Process`: `14476`.
- Second `npm test` passed:
  - `app shell ids exist`
  - `GET /api/status`
  - `POST /api/agent/intent month range`
  - `parser and notebook CRUD`
- `npm test` logged three notebook embedding warnings because current local `.env` uses `EMBED_MODEL=nomic-embed-text`, but that model is not installed. The fallback path worked and tests still passed.

Not run in this refresh:

- Full browser UI smoke test was not run.
- `npm audit` was not run.

## Operational Notes For Next Agent

- Prefer small, focused edits.
- Use `apply_patch` for file edits.
- Check `git status --short` before editing; do not revert user changes unless explicitly asked.
- Do not assume uploaded file payloads are server-persistent. Client IndexedDB is the durable source.
- If changing file persistence, avoid reintroducing server-memory reconciliation that deletes local room documents.
- If changing chat generation, preserve abort behavior via `AbortController`.
- If changing Map-Reduce, preserve progress streaming and truncation disclosure.
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
