# myAI

myAI는 로컬 Ollama를 백엔드로 사용하는 개인용 AI 비서 웹앱입니다. 대화, 문서/이미지 분석, CSV/XLSX 기반 데이터 시각화, AI 캘린더 에이전트, 개인화 UI를 제공합니다. 대화와 설정, 업로드 문서, 캘린더 일정은 브라우저 IndexedDB에 WebCrypto AES-GCM으로 암호화되어 저장됩니다.

## Current Local Status

- 실행 URL: <http://localhost:3000>
- 현재 `/api/status` 확인 결과:
  - `ok: true`
  - `defaultModel: gemma4:e2b`
  - 사용 가능 모델: `gemma4:e4b`, `gemma4:e2b`
- 현재 로컬 `.env`는 `OLLAMA_MODEL=gemma4:e2b`를 사용합니다.
- 코드 fallback(`server/ollama.js`)과 `.env.example`의 기본 모델은 `gemma3n:e2b`입니다. `server/calendarAgent.js`는 이 값들을 `server/ollama.js`에서 직접 import합니다.
- 서버 로그 파일: `server-start.log`

## Features

- **대화방 기반 채팅**: 여러 대화방, 방 제목 편집, 메시지 복사/편집, 스트리밍 응답, `중지` 버튼과 `Esc` 중단을 지원합니다.
- **파일 분석**: PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, GIF 업로드를 지원합니다.
- **AI 캘린더 에이전트**: 왼쪽 1차 메뉴의 `대화` / `캘린더` 구조를 사용합니다. 캘린더 화면에서는 월/주/일 보기, 오늘 기준 7일 이내 예정 일정 목록, 새 일정 다이얼로그, 자연어 일정 명령 입력창을 제공합니다. 각 일정은 완료 처리를 할 수 있으며, 완료 상태는 사이드바 예정 일정, 캘린더 날짜 셀 칩, 일정 편집 다이얼로그에 모두 반영됩니다.
- **부서노트북 (RAG)**: 부서가 공유하는 지식 자료를 주제별 노트북으로 묶어 등록할 수 있습니다. 컴포저 `+` 메뉴에서 노트북을 선택하면 해당 대화방은 RAG 모드로 전환되어 그 노트북 자료에만 근거하여 답변합니다. 자료 외 질문에는 "해당 노트북에서 관련 정보를 찾을 수 없습니다"라고 답합니다. 모든 답변에는 `[1]`, `[2]` 형식의 인라인 인용과 하단 출처 패널이 표시됩니다. 노트북 등록·문서 추가·삭제는 `ADMIN_TOKEN`을 보유한 관리자만 가능합니다.
- **한국 공휴일과 일정 알림**: 공식 공휴일 API 키가 있으면 한국 공휴일을 표시하고, 키가 없으면 고정 양력 공휴일 fallback을 표시합니다. 일정별 시작 시/30분 전/하루 전/이틀 전/일주일 전 알림을 설정할 수 있습니다.
- **자연어 일정 처리**: 채팅 입력 또는 캘린더 명령창에서 일정 등록, 조회, 삭제, 수정 요청을 감지하면 `/api/agent/intent`가 Ollama로 의도를 분류하고, 브라우저 코드가 검증된 payload를 실제 캘린더 상태에 적용합니다. tentative 요청은 `calendar.propose`로 보관한 뒤 사용자가 확인해야 실제 저장됩니다.
- **데이터 시각화**: CSV/XLSX 표 데이터 요청은 `/api/visualize`로 라우팅됩니다. LLM은 `analysis + visualizationPlan` JSON 계획만 만들고, 서버가 실제 컬럼 검증과 차트 데이터를 계산한 뒤 브라우저가 SVG 차트/KPI/표/인포그래픽을 렌더링합니다.
- **문서 컨텍스트 선별**: 문서가 길면 `server/retrieval.js`의 BM25 기반 선별로 관련 청크를 골라 `MAX_CONTEXT_CHARS` 안에 넣습니다.
- **후속 질문 추천**: 답변 완료 후 `/api/followups`를 통해 1-3개 한국어 후속 질문을 생성하고, 실패 시 로컬 fallback을 사용합니다.
- **개인화 설정**: 시스템 명칭, 시스템 배너, 시스템 아바타, 사용자 별명, 사용자 아바타, 밝기 테마, 색상 테마, 사용자 정의 프롬프트를 설정할 수 있습니다.
- **로컬 우선 저장**: 서버는 파일 파싱과 모델 호출을 담당하며, 사용자 데이터의 durable source는 브라우저 IndexedDB입니다.

## Requirements

- Node.js 20 이상
- Ollama 로컬 데몬: <https://ollama.com/download>
- 사용할 Ollama 모델을 미리 pull

현재 로컬 환경 기준:

```bash
ollama pull gemma4:e2b
```

`.env.example` 기본값을 그대로 쓰려면:

```bash
ollama pull gemma3n:e2b
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

앱 서버와 Ollama가 실행 중인 상태에서 기본 smoke test를 실행할 수 있습니다.

```bash
npm test
```

테스트는 앱 shell ID 정합성, `/api/status`, 월 범위 캘린더 intent, CSV 파서, 부서노트북 CRUD와 RAG 인용 메타데이터를 확인합니다.

## Configuration

서버는 시작 시 프로젝트 루트의 `.env`를 `server/env.js`로 읽습니다. 이미 설정된 프로세스 환경변수는 `.env` 값보다 우선합니다.

| 변수 | 기본값 | 설명 |
|---|---:|---|
| `PORT` | `3000` | HTTP 포트 |
| `HOST` | 미설정 | HTTP 바인딩 호스트. 미설정 시 모든 인터페이스에서 listen |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API 엔드포인트 |
| `OLLAMA_MODEL` | `gemma3n:e2b` | 코드 fallback 및 `.env.example`의 기본 모델 |
| `KOREA_HOLIDAY_SERVICE_KEY` | 미설정 | 공공데이터포털 한국천문연구원 특일 정보 API 서비스 키 |
| `MAX_CONTEXT_CHARS` | `24000` | 한 요청에 포함할 최대 문서 컨텍스트 글자 수 |
| `CHUNK_WINDOW_CHARS` | `1024` | 슬라이딩 윈도우 청크 크기(≈512 토큰) |
| `CHUNK_OVERLAP_CHARS` | `256` | 인접 청크 간 오버랩(≈128 토큰). 경계에 걸친 정보 누락을 줄임 |
| `NOTEBOOK_QUERY_BUDGET` | `12000` | 부서노트북 RAG 응답에 포함할 최대 청크 글자 수 |
| `ADMIN_TOKEN` | 미설정 | 부서노트북 등록·문서 추가·삭제에 필요한 관리자 토큰. 미설정 시 관리자 엔드포인트는 503 응답 |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body 한도 |
| `MAX_UPLOAD_BYTES` | `41943040` | 업로드 파일 1개당 최대 바이트 |

운영 환경에서는 `HOST=127.0.0.1`로 묶고 Caddy/nginx 같은 리버스 프록시 뒤에 두는 구성이 권장됩니다.

## Calendar Agent

캘린더 데이터는 `state.calendar`에 저장되고, 기존 앱 상태와 함께 암호화된 `app-state` record에 들어갑니다.

```js
state.calendar = {
  events: [
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
  ],
  cursorISO,
  viewMode
}
```

자연어 명령 흐름:

```text
사용자 입력
-> 프론트엔드 키워드 감지
-> POST /api/agent/intent
-> server/calendarAgent.js가 Ollama에 strict JSON 의도 분류 요청
-> intent/payload 정규화와 날짜 범위 보정
-> tentative 요청은 room.pendingCalendarAction에 보관
-> 사용자의 확인 응답이 오면 pending action을 calendar.create로 실행
-> public/app.js가 create/list/delete/update를 실제 IndexedDB 상태에 적용
-> 캘린더 UI와 채팅 이벤트 카드 갱신
```

이 구조에서 LLM은 자연어를 구조화된 JSON으로 바꾸는 역할만 합니다. 실제 일정 추가/조회/삭제/수정은 `public/app.js`의 결정적 코드가 로컬 `state.calendar.events`에 적용합니다. 그래서 성공 메시지는 실제 로컬 변경이 끝난 뒤에만 생성됩니다.

현재 지원 intent:

- `calendar.propose`
- `calendar.create`
- `calendar.list`
- `calendar.delete`
- `calendar.update`
- `chat`

`calendar.propose`는 “5월 4일 점심 일정 잡을 수 있나?”처럼 아직 저장을 명확히 지시하지 않은 후보 일정입니다. 사용자가 `응`, `좋아`, `추가해줘`, `등록해줘`처럼 확인하면 최근 대화와 `pendingAction`을 함께 분류해 실제 `calendar.create`로 전환합니다.

월 범위 조회는 LLM 결과에만 의존하지 않습니다. `5월 전체 일정`, `이번 달`, `다음 달`, `지난달` 같은 표현은 서버가 최종적으로 해당 월의 1일~말일 범위로 보정합니다.

월 전체/매일 등록도 단일 이벤트로 축약하지 않습니다. 예를 들어 `5월 전체 일정에 오전 9시부터 10분간 스트레칭을 등록해`는 `repeat: { frequency: "daily", from: "2026-05-01", to: "2026-05-31" }` payload로 보정되고, 브라우저가 각 날짜의 개별 이벤트로 확장해 저장합니다.

## Department Notebooks (RAG)

부서노트북은 부서 공용 자료를 주제별로 묶어둔 RAG 지식 창고입니다. 사용자별 IndexedDB가 아니라 서버 파일시스템(`data/notebooks/<id>/`)에 저장되며, 모든 사용자가 같은 노트북을 공유합니다.

저장 구조:

```text
data/notebooks/
  <notebookId>/
    manifest.json           노트북 메타와 문서 목록
    docs/
      <docId>.json          파싱·청크된 문서 payload
```

대화방 단위 운영 모델:

- 각 대화방은 자신의 `selectedNotebookId`를 독립적으로 가집니다.
- 새 대화방의 디폴트는 `null` (일반 대화).
- 컴포저 `+` 메뉴 → "부서노트북 선택" 또는 활성 배지를 클릭해 변경할 수 있습니다.
- 노트북이 활성화되면 채팅 헤더 아래 컨텍스트 바와 컴포저 라인의 알약 배지가 동시에 표시됩니다.

RAG 처리 흐름:

```text
사용자 입력 + room.selectedNotebookId
-> POST /api/chat { ..., notebookId }
-> server/notebooks.js#queryNotebook 으로 BM25+CJK bigram 검색
-> 상위 청크를 시스템 메시지의 [노트북 컨텍스트] 블록에 [N] 번호와 함께 주입
-> Strict 시스템 프롬프트로 "노트북 자료에만 근거" 규칙 강제
-> 자료 부족 시 "해당 노트북에서 관련 정보를 찾을 수 없습니다."
-> 응답 시 X-Notebook-Meta 헤더에 base64-JSON 인용 메타를 첨부
-> 브라우저가 인라인 [N] 마커와 하단 출처 패널을 렌더
```

관리자 운영:

- 노트북 등록/수정/삭제, 문서 업로드/삭제는 `ADMIN_TOKEN`을 가진 관리자만 가능합니다.
- 설정 다이얼로그 하단의 "부서노트북 관리" 버튼은 서버에 `ADMIN_TOKEN`이 설정되어 있을 때만 보입니다.
- 토큰은 브라우저 `sessionStorage`에 저장되어 탭 종료 시 사라집니다.
- 문서 파싱은 채팅과 동일한 `server/parsers.js`를 재사용하며 PDF/DOCX/XLSX/CSV/PPTX/HWPX를 지원합니다(이미지는 노트북에 추가 불가).

검색 한도는 `NOTEBOOK_QUERY_BUDGET` (기본 12,000자) 환경변수로 조정합니다. 룸 첨부파일과 노트북 컨텍스트는 함께 시스템 메시지에 들어가며, 시스템 프롬프트가 노트북 우선임을 LLM에 지시합니다.

## Local Storage Notes

대화, 설정, 업로드 문서 payload, 캘린더 일정은 서버가 아니라 브라우저 IndexedDB에 저장됩니다.

```text
DB name: ollama-chatter-secure
Object store: records
Record id: app-state

Object store: keys
Record id: local-aes-gcm-key
```

브라우저 프로필을 삭제하거나 다른 브라우저/기기로 이동하면 기존 데이터는 자동으로 따라가지 않습니다. 큰 이미지나 문서를 많이 저장하면 브라우저 quota에 걸릴 수 있고, 이 경우 앱 화면에 저장 실패 안내가 표시됩니다.

## Server API

- `GET /api/status`: Ollama 연결 상태, 기본 모델, 모델 목록
- `POST /api/upload`: 파일 1개 파싱 후 full document payload 반환
- `GET /api/documents`: 서버 메모리 문서 summary 목록
- `GET /api/documents/:id`: 서버 메모리의 full document payload 조회
- `DELETE /api/documents/:id`: 서버 메모리 문서 삭제
- `POST /api/chat`: Ollama 스트리밍 채팅. 선택적 `notebookId`를 받으면 부서노트북 RAG 모드로 전환되고, 응답은 `X-Notebook-Meta` 헤더에 base64-JSON 인용 메타를 포함
- `POST /api/visualize`: CSV/XLSX 기반 plan-first 시각화 생성
- `POST /api/followups`: 후속 질문 추천
- `POST /api/agent/intent`: 캘린더/일반 대화 intent 분류. `prompt`, `model`, `currentDate`와 선택적 `messages`, `pendingAction`을 받을 수 있음
- `GET /api/holidays`: 연도별 한국 공휴일 조회. API 키가 없으면 고정 양력 공휴일 fallback 반환
- `GET /api/admin/status`: `ADMIN_TOKEN` 설정 여부 반환
- `POST /api/admin/verify`: 관리자 토큰 검증 (Bearer 헤더)
- `GET /api/notebooks`: 부서노트북 목록 (id, name, description, documentCount)
- `GET /api/notebooks/:id`: 노트북 상세와 문서 목록
- `POST /api/notebooks` / `PATCH /api/notebooks/:id` / `DELETE /api/notebooks/:id`: 노트북 CRUD (관리자)
- `POST /api/notebooks/:id/documents`: 노트북 문서 업로드 (관리자, multipart `file`)
- `DELETE /api/notebooks/:id/documents/:documentId`: 노트북 문서 삭제 (관리자)

## Project Structure

```text
server/
  index.js           Express 서버, 정적 파일, API 라우트
  env.js             프로젝트 루트 .env 로더
  ollama.js          Ollama 호출, 채팅, 후속 질문, 시각화 계획/해석, 노트북 컨텍스트 주입
  calendarAgent.js   자연어 캘린더 intent 분류와 payload 정규화
  holidays.js        한국 공휴일 API/fallback 조회
  notebooks.js       부서노트북 CRUD, 문서 ingest, BM25 검색, 인용 생성
  auth.js            ADMIN_TOKEN 기반 관리자 미들웨어
  parsers.js         업로드 파일 파싱 (룸 파일과 노트북 문서 공통)
  retrieval.js       BM25 + CJK bigram 기반 청크 선별, greedyFit() 공유 헬퍼
  visualization.js   시각화 계획 검증과 차트 데이터 계산
  documents.js       문서 summary/full payload 직렬화, pageSections() 공유 헬퍼
  documentStore.js   서버 런타임 메모리 문서 캐시

public/
  index.html         앱 shell, 대화/캘린더 화면, 설정/일정/노트북 다이얼로그
  app.js             프론트엔드 상태, IndexedDB 암호화 저장, 채팅/캘린더/노트북 UI
  answerRenderer.js  마크다운-lite 답변 렌더러
  visualizationRenderer.js  SVG 차트/KPI/표/인포그래픽 렌더러
  fileDisplay.js     파일명 표시, 복구, 타입 배지
  textRepair.js      mojibake 점수 계산과 복구 헬퍼
  styles.css         테마 토큰, 레이아웃, 메시지/설정/캘린더/노트북 UI

data/
  notebooks/         부서노트북 manifest와 문서 payload (gitignored)

deploy/
  DEPLOY.md
  myai.service
  myai.env.example
  Caddyfile
  nginx.conf.example
```

## Known Constraints

- 캘린더는 현재 로컬 IndexedDB 전용입니다. Google Calendar, Outlook, ICS 동기화는 없습니다.
- 반복 일정, 여러 캘린더 계정, timezone UI는 아직 없습니다.
- 일정 알림은 브라우저가 열려 있을 때 동작합니다. 앱/브라우저가 완전히 꺼진 상태의 보장 알림은 PWA/service worker 또는 데스크톱 앱화가 필요합니다.
- AI 일정 삭제/수정은 LLM 분류 결과를 바탕으로 로컬 이벤트를 변경하지만, 실제 변경 전 사용자 확인을 거칩니다. 시간 변경은 기존 일정과의 충돌도 확인합니다.
- 파일과 캘린더 데이터는 브라우저 로컬에만 저장됩니다. export/import와 저장 공간 사용량 UI는 아직 없습니다.
- 레거시 `.hwp`와 `.xls`는 직접 지원하지 않습니다. HWPX/XLSX 변환을 권장합니다.
- `llm_performance_dummy.csv`는 현재 작업트리에 없습니다. 시각화 smoke test에 필요하면 새 fixture를 추가하거나 기존 테스트 데이터를 준비하세요.

## Deployment

Linux 서버 배포는 [`deploy/DEPLOY.md`](./deploy/DEPLOY.md)에 정리되어 있습니다.

핵심 주의사항:

- HTTPS가 필요합니다. 프론트엔드 WebCrypto는 `https://` 또는 `http://localhost` 같은 보안 컨텍스트에서 동작합니다.
- 리버스 프록시는 스트리밍을 막지 않도록 구성해야 합니다.
- 프록시 업로드 한도와 `MAX_UPLOAD_BYTES`를 맞춰야 합니다.
- CPU 전용 Ollama 추론은 느릴 수 있습니다. 실사용 환경은 GPU 권장입니다.

## License

Private project. Not yet released under an open-source license.
