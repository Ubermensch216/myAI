# myAI

myAI는 로컬 Ollama를 백엔드로 사용하는 개인용 AI 비서 웹앱입니다. 대화, 문서/이미지 분석, CSV/XLSX 기반 데이터 시각화, AI 캘린더 에이전트, 개인화 UI를 제공합니다. 대화와 설정, 업로드 문서, 캘린더 일정은 브라우저 IndexedDB에 WebCrypto AES-GCM으로 암호화되어 저장됩니다.

## Current Local Status

- 실행 URL: <http://localhost:3000>
- 현재 `/api/status` 확인 결과:
  - `ok: true`
  - `defaultModel: gemma4:e2b`
  - 사용 가능 모델: `gemma4:e4b`, `gemma4:e2b`
- 현재 로컬 `.env`는 `OLLAMA_MODEL=gemma4:e2b`를 사용합니다.
- 코드 fallback과 `.env.example`의 기본 모델은 `gemma3n:e2b`입니다.
- 서버 로그 파일: `server-start.log`

## Features

- **대화방 기반 채팅**: 여러 대화방, 방 제목 편집, 메시지 복사/편집, 스트리밍 응답, `중지` 버튼과 `Esc` 중단을 지원합니다.
- **파일 분석**: PDF, DOCX, XLSX, CSV, PPTX, HWPX, PNG, JPG, JPEG, WEBP, GIF 업로드를 지원합니다.
- **AI 캘린더 에이전트**: 왼쪽 1차 메뉴의 `대화` / `캘린더` 구조를 사용합니다. 캘린더 화면에서는 월/주/일 보기, 예정 일정 목록, 새 일정 다이얼로그, 자연어 일정 명령 입력창을 제공합니다.
- **한국 공휴일과 일정 알림**: 공식 공휴일 API 키가 있으면 한국 공휴일을 표시하고, 키가 없으면 고정 양력 공휴일 fallback을 표시합니다. 일정별 시작 시/30분 전/하루 전/이틀 전/일주일 전 알림을 설정할 수 있습니다.
- **자연어 일정 처리**: 채팅 입력 또는 캘린더 명령창에서 일정 등록, 조회, 삭제, 수정 요청을 감지하면 `/api/agent/intent`가 Ollama로 의도를 분류하고, 브라우저 코드가 검증된 payload를 실제 캘린더 상태에 적용합니다.
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
| `CHUNK_TARGET_CHARS` | `1800` | 문서 청크 목표 길이 |
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
      createdAt,
      updatedAt
    }
  ],
  cursorISO
}
```

자연어 명령 흐름:

```text
사용자 입력
-> 프론트엔드 키워드 감지
-> POST /api/agent/intent
-> server/calendarAgent.js가 Ollama에 strict JSON 의도 분류 요청
-> intent/payload 정규화
-> public/app.js가 create/list/delete/update를 실제 IndexedDB 상태에 적용
-> 캘린더 UI와 채팅 이벤트 카드 갱신
```

현재 지원 intent:

- `calendar.create`
- `calendar.list`
- `calendar.delete`
- `calendar.update`
- `chat`

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
- `POST /api/chat`: Ollama 스트리밍 채팅
- `POST /api/visualize`: CSV/XLSX 기반 plan-first 시각화 생성
- `POST /api/followups`: 후속 질문 추천
- `POST /api/agent/intent`: 캘린더/일반 대화 intent 분류

## Project Structure

```text
server/
  index.js           Express 서버, 정적 파일, API 라우트
  env.js             프로젝트 루트 .env 로더
  ollama.js          Ollama 호출, 채팅, 후속 질문, 시각화 계획/해석
  calendarAgent.js   자연어 캘린더 intent 분류와 payload 정규화
  parsers.js         업로드 파일 파싱
  retrieval.js       BM25 기반 문서 청크 선별
  visualization.js   시각화 계획 검증과 차트 데이터 계산
  documents.js       문서 summary/full payload 직렬화
  documentStore.js   서버 런타임 메모리 문서 캐시

public/
  index.html         앱 shell, 대화/캘린더 화면, 설정/일정 다이얼로그
  app.js             프론트엔드 상태, IndexedDB 암호화 저장, 채팅/캘린더 UI
  answerRenderer.js  마크다운-lite 답변 렌더러
  visualizationRenderer.js  SVG 차트/KPI/표/인포그래픽 렌더러
  fileDisplay.js     파일명 표시, 복구, 타입 배지
  textRepair.js      mojibake 점수 계산과 복구 헬퍼
  styles.css         테마 토큰, 레이아웃, 메시지/설정/캘린더 UI

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
- AI 일정 삭제/수정은 LLM 분류 결과를 바탕으로 로컬 이벤트를 변경합니다. 운영 수준의 안전성을 위해서는 삭제/대량 수정 확인 UX를 더 강화하는 것이 좋습니다.
- 파일과 캘린더 데이터는 브라우저 로컬에만 저장됩니다. export/import와 저장 공간 사용량 UI는 아직 없습니다.
- 레거시 `.hwp`와 `.xls`는 직접 지원하지 않습니다. HWPX/XLSX 변환을 권장합니다.
- `llm_performance_dummy.csv`는 tracked fixture였지만 현재 작업트리에서는 삭제 상태입니다. 시각화 smoke test에 필요하면 git에서 복구하세요.

## Deployment

Linux 서버 배포는 [`deploy/DEPLOY.md`](./deploy/DEPLOY.md)에 정리되어 있습니다.

핵심 주의사항:

- HTTPS가 필요합니다. 프론트엔드 WebCrypto는 `https://` 또는 `http://localhost` 같은 보안 컨텍스트에서 동작합니다.
- 리버스 프록시는 스트리밍을 막지 않도록 구성해야 합니다.
- 프록시 업로드 한도와 `MAX_UPLOAD_BYTES`를 맞춰야 합니다.
- CPU 전용 Ollama 추론은 느릴 수 있습니다. 실사용 환경은 GPU 권장입니다.

## License

Private project. Not yet released under an open-source license.
