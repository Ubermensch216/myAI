# myAI

myAI는 로컬 Ollama를 백엔드로 사용하는 개인 AI 비서 웹앱입니다. 채팅, 문서/이미지 분석, CSV/XLSX 기반 시각화, 로컬 AI 캘린더 에이전트, 부서노트북 RAG, 브라우저 암호화 저장, 사용자 맞춤 UI를 제공합니다.

## Current Local Status

- 실행 URL: <http://localhost:3000>
- `/api/status` 확인일: 2026-05-04
- 현재 기본 모델: `gemma4:e2b`
- 현재 사용 가능 모델: `bge-m3:latest`, `gemma4:e4b`, `gemma4:e2b`
- 현재 로컬 `.env`: `OLLAMA_MODEL=gemma4:e2b`, `EMBED_MODEL=nomic-embed-text`
- 코드 fallback 모델: `gemma3n:e2b`
- `.env.example`의 임베딩 모델은 `bge-m3`입니다. 현재 Ollama에는 `bge-m3:latest`가 있지만, 로컬 `.env`의 `nomic-embed-text`는 설치되어 있지 않아 임베딩 호출은 404를 기록하고 BM25 검색으로 fallback됩니다.

## Features

- **대화형 채팅**: 여러 대화방, 방 제목 편집, 사용자 메시지 복사/편집, 스트리밍 응답, `중지` 버튼과 `Esc` 중단, 후속 질문 추천을 지원합니다.
- **파일 분석**: PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG/JPG/JPEG/WEBP/GIF 업로드를 지원합니다.
- **문서 사전 분석**: 업로드된 일반 문서는 `server/documentAnalysis.js`가 Ollama로 짧은 요약과 주요 토픽을 생성해 문서 payload에 저장합니다. 이 개요는 이후 첨부 파일 컨텍스트와 부서노트북 컨텍스트 보강에 사용됩니다.
- **전체 분석(Map-Reduce)**: 채팅 composer의 `전체 분석` 토글을 켜면 `/api/chat`이 `mode: "map_reduce"`로 호출됩니다. 선택된 부서노트북 전체 청크 또는 현재 방의 업로드 문서 전체 청크를 map/reduce 방식으로 분석하며, 긴 자료를 일부 검색 청크만으로 답하는 한계를 줄이기 위한 모드입니다.
- **부서노트북 RAG**: 서버 파일시스템의 `data/notebooks/<id>/`에 저장되는 공유 지식 노트북입니다. 사용자는 방마다 노트북을 선택하고, AI는 해당 노트북과 현재 방 파일을 근거로 답변하며 `[1]`, `[2]` 형식의 인용과 출처 패널을 제공합니다.
- **질의 확장 및 검색**: 부서노트북 검색은 `server/queryExpansion.js`로 검색 변형을 만들고 `multiQueryHybridSelect()`로 BM25/CJK bigram 및 벡터 랭킹을 결합하려고 시도합니다. 임베딩 실패 시 BM25 기반으로 fallback됩니다.
- **AI 캘린더 에이전트**: 자연어 일정 등록/조회/수정/삭제를 `/api/agent/intent`로 분류하고, 실제 일정 데이터 변경은 브라우저의 결정적 코드가 IndexedDB 상태에 적용합니다.
- **한국 공휴일 및 알림**: `KOREA_HOLIDAY_SERVICE_KEY`가 있으면 공공데이터 API를 사용하고, 없으면 고정 양력 공휴일 fallback을 사용합니다. 일정 알림은 열린 브라우저 탭에서 동작합니다.
- **데이터 시각화**: CSV/XLSX 기반 시각화 요청은 `/api/visualize`로 라우팅됩니다. LLM은 분석 의도와 시각화 계획 JSON을 만들고, 서버가 실제 컬럼/행으로 검증 및 계산한 뒤 브라우저가 SVG 차트/KPI/표/인포그래픽을 렌더링합니다.
- **암호화 로컬 저장**: 대화, 설정, 업로드 문서 payload, 캘린더 일정은 브라우저 IndexedDB에 WebCrypto AES-GCM으로 암호화되어 저장됩니다.

## Requirements

- Node.js 20 이상
- 로컬 Ollama: <https://ollama.com/download>
- 사용할 Ollama 모델 사전 pull

현재 로컬 상태와 맞추려면:

```bash
ollama pull gemma4:e2b
ollama pull bge-m3
```

`.env.example` 기본값을 그대로 쓰려면:

```bash
ollama pull gemma3n:e2b
ollama pull bge-m3
```

현재 `.env`처럼 `EMBED_MODEL=nomic-embed-text`를 유지하려면 다음도 필요합니다.

```bash
ollama pull nomic-embed-text
```

## Quick Start

### Linux / macOS

```bash
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
cp .env.example .env
npm start
```

### Windows PowerShell

```powershell
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
copy .env.example .env
npm start
```

브라우저에서 <http://localhost:3000>을 엽니다. 개발 중 자동 재시작은 `npm run dev`를 사용할 수 있습니다.

## Smoke Test

서버와 Ollama가 실행 중인 상태에서:

```bash
npm test
```

테스트는 앱 shell ID, `/api/status`, 캘린더 intent, parser, 부서노트북 CRUD와 RAG 인용 메타데이터를 확인합니다. 현재 로컬 `.env`의 `EMBED_MODEL=nomic-embed-text` 모델이 설치되어 있지 않으면 임베딩 404 경고가 뜰 수 있지만, BM25 fallback 경로가 동작하면 테스트는 통과할 수 있습니다.

최근 확인(2026-05-04): 앱 서버를 띄운 상태에서 `npm test`가 통과했습니다. 현재 로컬 `.env` 기준으로는 `nomic-embed-text` 미설치 때문에 노트북 임베딩 404 경고가 3회 기록되지만, BM25 fallback으로 테스트는 성공했습니다.

## Configuration

서버 시작 시 프로젝트 루트의 `.env`를 `server/env.js`가 읽습니다. 이미 존재하는 프로세스 환경변수가 `.env`보다 우선합니다.

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `PORT` | `3000` | HTTP 포트 |
| `HOST` | unset | HTTP listen host. unset이면 모든 인터페이스 |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API endpoint |
| `OLLAMA_MODEL` | `gemma3n:e2b` | 기본 채팅/분석 모델 |
| `EMBED_MODEL` | code: `nomic-embed-text`, `.env.example`: `bge-m3` | Ollama `/api/embed`용 임베딩 모델 |
| `KOREA_HOLIDAY_SERVICE_KEY` | unset | 한국 공휴일 공공데이터 API 서비스키 |
| `ADMIN_TOKEN` | unset | 부서노트북 관리 API용 bearer token |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body 제한 |
| `MAX_UPLOAD_BYTES` | `41943040` | 업로드 파일 1개 최대 바이트 |
| `MAX_CONTEXT_CHARS` | `24000` | 일반 채팅에 주입할 최대 문서 컨텍스트 |
| `CHUNK_WINDOW_CHARS` | `1024` | 슬라이딩 청크 크기 |
| `CHUNK_OVERLAP_CHARS` | `256` | 슬라이딩 청크 overlap |
| `NOTEBOOK_QUERY_BUDGET` | `12000` | 부서노트북 RAG 컨텍스트 문자 예산 |
| `QUERY_EXPANSION_ENABLED` | `true` | RAG 검색 전 LLM 질의 확장 사용 여부 |
| `QUERY_EXPANSION_VARIANTS` | `3` | 원문 외 생성할 검색 변형 수 |
| `QUERY_EXPANSION_TIMEOUT_MS` | `6000` | 질의 확장 timeout ms |
| `DOC_ANALYSIS_ENABLED` | `true` | 업로드/노트북 ingest 시 문서 요약/토픽 생성 여부 |
| `DOC_ANALYSIS_MAX_INPUT_CHARS` | `12000` | 문서 사전 분석에 보낼 최대 본문 길이 |
| `DOC_ANALYSIS_TIMEOUT_MS` | `30000` | 문서 사전 분석 timeout ms |
| `MAP_REDUCE_BATCH_CHUNKS` | `4` | Map-Reduce map 호출 1회당 청크 수 |
| `MAP_REDUCE_MAX_CHUNKS` | `80` | 전체 분석에서 처리할 최대 청크 수 |
| `MAP_REDUCE_PARALLELISM` | `2` | Map 단계 병렬 호출 수 |
| `MAP_REDUCE_MAP_TIMEOUT_MS` | `45000` | Map 단계 호출 timeout ms |

## Architecture

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

### Document Context

```text
room documents in IndexedDB
-> client sends active room documents
-> server/ollama.js collects text/pages/sheets/images
-> server/parsers.js#slidingChunkText creates overlapping chunks
-> server/queryExpansion.js may create query variants
-> server/embeddings.js tries query/chunk embeddings
-> server/retrieval.js#multiQueryHybridSelect or hybridSelect selects chunks
-> embedding failures fall back to BM25/CJK bigram
-> selected context plus document summaries/topics are injected into the system message
```

### Whole Document Analysis (Map-Reduce)

```text
composer "전체 분석" toggle
-> POST /api/chat { mode: "map_reduce", notebookId?, documents? }
-> if notebookId exists, server/notebooks.js#loadAllNotebookChunks loads notebook chunks
-> otherwise server/ollama.js#collectChunks uses active room documents
-> server/mapReduce.js batches chunks and runs map calls in parallel
-> reduce step streams the final Korean answer
-> X-Notebook-Meta may include analysisMode: "map_reduce"
```

이 모드는 검색으로 뽑힌 일부 청크가 아니라 전체 자료를 넓게 훑기 위한 기능입니다. 시간이 더 오래 걸리고 `MAP_REDUCE_MAX_CHUNKS`를 넘는 자료는 잘릴 수 있습니다.

### Department Notebooks (RAG)

```text
chat prompt + room.selectedNotebookId
-> POST /api/chat { ..., notebookId }
-> server/notebooks.js#queryNotebook
-> expandQuery() creates search variants
-> multiQueryHybridSelect() ranks chunks
-> top chunks get [N] citation IDs
-> cited document summaries/topics are also injected
-> strict grounding prompt tells the model to answer only from notebook + room files
-> X-Notebook-Meta returns notebook, citations[], analysisMode?
-> browser renders inline [N] markers and a citations panel
```

부서노트북 문서는 `data/notebooks/<id>/docs/<docId>.json`에 저장됩니다. ingest 시 파싱, 청킹, 임베딩 시도, 요약/토픽 생성이 함께 수행됩니다. 현재 구현은 저장된 `chunks[].embedding`을 검색 시 `multiQueryHybridSelect()`에 전달하는 연결이 아직 빠져 있어, 부서노트북 벡터 검색 품질을 주장하기 전 이 부분을 먼저 고쳐야 합니다. 현재 실효 경로는 질의 확장 + BM25/CJK bigram fallback입니다.

### Calendar Agent

```text
calendar-like natural language prompt
-> public/app.js keyword prefilter
-> POST /api/agent/intent
-> server/calendarAgent.js asks Ollama for strict JSON
-> server normalizes intent/payload and deterministic date corrections
-> browser applies create/list/delete/update to local state.calendar.events
-> UI refreshes grid, upcoming list, command result, and chat event cards
```

LLM은 intent와 필드 추출만 담당합니다. 실제 일정 변경은 브라우저 로컬 상태에 적용되며, 삭제/수정처럼 파괴적일 수 있는 작업은 현재 `window.confirm()` 확인을 거칩니다.

### Visualization

```text
chart/graph prompt + CSV/XLSX table data
-> public/app.js calls /api/visualize
-> LLM returns analysis + visualizationPlan JSON
-> server/visualization.js validates exact columns and chart requirements
-> server computes final chart data from real rows
-> LLM optionally interprets the computed spec in Korean
-> browser renders SVG/table/KPI/infographic
```

## Server API

- `GET /api/status`: Ollama 연결 상태, 기본 모델, 모델 목록
- `POST /api/upload`: 파일 1개 파싱, 일반 문서는 요약/토픽 사전 분석 후 full document payload 반환
- `GET /api/documents`: 서버 메모리 문서 summary 목록
- `GET /api/documents/:id`: 서버 메모리의 full document payload 조회
- `DELETE /api/documents/:id`: 서버 메모리 문서 삭제
- `POST /api/chat`: Ollama 스트리밍 채팅. 선택적 `notebookId`와 `mode`를 받음. `mode: "map_reduce"`이면 전체 분석 경로 사용
- `POST /api/visualize`: CSV/XLSX 기반 plan-first 시각화 생성
- `POST /api/followups`: 후속 질문 추천
- `POST /api/agent/intent`: 캘린더/일반 대화 intent 분류
- `GET /api/holidays`: 연도별 한국 공휴일 조회
- `GET /api/admin/status`: `ADMIN_TOKEN` 설정 여부
- `POST /api/admin/verify`: 관리자 bearer token 검증
- `GET /api/notebooks`, `GET /api/notebooks/:id`: 공개 노트북 조회
- `POST /api/notebooks`, `PATCH /api/notebooks/:id`, `DELETE /api/notebooks/:id`: 관리자 노트북 CRUD
- `POST /api/notebooks/:id/documents`, `DELETE /api/notebooks/:id/documents/:documentId`: 관리자 노트북 문서 추가/삭제

`POST /api/chat` body:

```js
{
  model,
  messages,
  documents,
  personalization,
  notebookId, // optional
  mode        // optional: "chat" | "map_reduce"
}
```

노트북 또는 전체 분석 메타가 있을 때 `X-Notebook-Meta` 헤더는 base64-JSON으로 다음 형태를 가집니다.

```js
{
  notebook: { id, name, description, documentCount, updatedAt },
  citations: [
    { citationId, documentId, documentName, documentType, locator }
  ],
  analysisMode: "map_reduce" // or null
}
```

## Project Structure

```text
server/
  index.js             Express server, static files, API routes
  env.js               project-root .env loader
  ollama.js            Ollama chat, followups, visualization calls, context building, RAG and map-reduce dispatch
  embeddings.js        Ollama /api/embed helpers
  queryExpansion.js    LLM query expansion for retrieval
  documentAnalysis.js  upload-time document summary/topic extraction
  mapReduce.js         whole-document map/reduce analysis
  calendarAgent.js     natural-language calendar intent classifier
  holidays.js          Korean holiday API/fallback
  notebooks.js         department notebook storage, ingest, retrieval, all-chunk loading
  auth.js              ADMIN_TOKEN middleware
  parsers.js           file parsers and chunking
  retrieval.js         BM25/CJK bigram, cosine, RRF hybrid retrieval
  visualization.js     visualization plan validation and chart data computation
  documents.js         document serializers and pageSections()
  documentStore.js     runtime-only server memory document cache

public/
  index.html           app shell and dialogs
  app.js               frontend state, IndexedDB encryption, chat/calendar/notebook UI
  answerRenderer.js    markdown-lite answer renderer
  visualizationRenderer.js
  fileDisplay.js
  textRepair.js
  styles.css

data/
  notebooks/           department notebook manifests and document payloads (gitignored)

deploy/
  DEPLOY.md
  myai.service
  myai.env.example
  Caddyfile
  nginx.conf.example
```

## Known Constraints

- 캘린더는 현재 브라우저 IndexedDB 전용입니다. Google Calendar, Outlook, ICS 동기화는 없습니다.
- 반복 일정, 다중 캘린더 계정, timezone UI는 아직 없습니다.
- 일정 알림은 브라우저 탭이 열려 있을 때만 동작합니다.
- 업로드 파일과 캘린더 데이터의 durable source는 브라우저 IndexedDB입니다. 서버 메모리 문서 캐시는 재시작 후 유지되지 않습니다.
- 부서노트북은 서버 파일 JSON 스캔 구조입니다. 문서량이 커지면 별도 인덱스/벡터 저장소가 필요합니다.
- 부서노트북 ingest는 임베딩을 저장하지만, 현재 query-time chunk 객체에 저장 embedding을 전달하지 않아 semantic vector ranking은 아직 완성 상태가 아닙니다.
- 문서 사전 분석은 업로드/노트북 문서 추가 시 LLM 호출을 늘리므로 큰 문서나 느린 로컬 모델에서는 업로드 지연이 생길 수 있습니다.
- Map-Reduce 전체 분석은 일반 RAG보다 느리고 토큰/시간 비용이 큽니다. `MAP_REDUCE_MAX_CHUNKS`를 넘는 자료는 일부만 처리됩니다.
- `.hwp`, `.xls` 구형 바이너리 형식은 직접 지원하지 않습니다. HWPX/XLSX 변환을 권장합니다.

## Deployment

Linux 서버 배포는 [`deploy/DEPLOY.md`](./deploy/DEPLOY.md)에 정리되어 있습니다.

주의사항:

- WebCrypto는 `https://` 또는 `http://localhost` 같은 보안 컨텍스트가 필요합니다.
- reverse proxy는 스트리밍 응답을 버퍼링하지 않도록 설정해야 합니다.
- proxy 업로드 제한은 `MAX_UPLOAD_BYTES`와 맞춰야 합니다.
- CPU 전용 Ollama 추론은 느릴 수 있습니다. 실사용 환경은 GPU를 권장합니다.

## License

Private project. Not yet released under an open-source license.
