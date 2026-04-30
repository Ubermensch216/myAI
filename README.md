# myAI

로컬 Ollama를 백엔드로 쓰는 개인용 AI 비서 웹앱. 여러 대화방, 문서·이미지 업로드 분석, 스트리밍 응답, 후속 질문 추천, 색상 테마, 그리고 모든 대화·설정·업로드 내용을 **브라우저 IndexedDB에 AES-GCM으로 암호화**해 보관하는 것이 특징.

## Features

- **Data visualizations**: CSV/XLSX table data can be analyzed into validated JSON specs and rendered as chart, KPI, table, or infographic blocks.

- **다중 대화방**: 방 단위로 메시지·업로드 파일이 분리 저장
- **문서/이미지 분석**: PDF / DOCX / XLSX / CSV / PPTX / HWPX, PNG / JPG / WEBP / GIF
- **스트리밍 응답**: 생성 중 `중지` 버튼 또는 `Esc`로 중단 가능
- **후속 질문 추천**: 답변 완료 후 1–3개 한국어 후속 질문 자동 생성
- **개인화 설정**:
  - 시스템 명칭 / 사용자 별명 / AI 별명
  - 시스템 아이콘(파비콘과 사이드바에 반영)
  - 사용자 정의 프롬프트
  - 밝기 (라이트/다크)
  - 색상 테마 (부산 CI / 부산 상수도 CI)
- **로컬 우선·암호화 저장**: 모든 데이터는 브라우저 IndexedDB에만 저장되며 WebCrypto AES-GCM으로 암호화. 서버는 모델 호출과 파일 파싱 외에 데이터를 영속화하지 않음.

## Requirements

- **Node.js 20+**
- **Ollama** 로컬 데몬 — <https://ollama.com/download>
- 사용할 모델을 미리 pull (기본값 `gemma3n:e2b`)

```bash
ollama pull gemma3n:e2b
```

## Quick Start

### Linux / macOS

```bash
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
cp .env.example .env   # 필요한 값 조정
npm start
```

### Windows (PowerShell)

```powershell
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
copy .env.example .env
npm start
```

브라우저에서 <http://localhost:3000> 열기. 개발 중 자동 재시작은 `npm run dev`.

## Configuration

모든 설정은 환경변수 또는 프로젝트 루트의 `.env`로 주입. 서버가 시작될 때 `.env`를 자동으로 읽으며, 이미 지정된 환경변수가 `.env` 값보다 우선합니다. (자세한 기본값은 [`.env.example`](./.env.example) 참고)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API 엔드포인트 |
| `OLLAMA_MODEL` | `gemma3n:e2b` | 기본 채팅 모델 |
| `MAX_CONTEXT_CHARS` | `24000` | 한 요청에 포함할 최대 문서 컨텍스트 글자 수 |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body 한도 |
| `MAX_UPLOAD_BYTES` | `41943040` | 업로드 파일 한 개당 최대 바이트 (40MB) |
| `HOST` | 미설정 | HTTP 바인딩 호스트. 미설정 시 모든 인터페이스에서 listen |

## Local Storage Notes

대화, 설정, 업로드 파일 본문은 서버가 아니라 브라우저 IndexedDB에 저장됩니다. 큰 이미지나 문서를 많이 저장하면 브라우저 저장 공간 제한에 걸릴 수 있으며, 이 경우 앱 화면에 저장 실패 안내가 표시됩니다.

서버 백업만으로는 사용자 대화나 업로드 파일을 복구할 수 없습니다. 브라우저 프로필을 삭제하거나 다른 브라우저·기기로 이동하면 기존 대화 데이터는 자동으로 따라가지 않습니다.

## Deployment

Linux 서버 배포는 [`deploy/DEPLOY.md`](./deploy/DEPLOY.md)에 단계별로 정리되어 있습니다. `deploy/` 안에는 바로 쓸 수 있는 템플릿이 있습니다.

| 파일 | 용도 |
|---|---|
| [`deploy/DEPLOY.md`](./deploy/DEPLOY.md) | Ubuntu/Debian 배포 단계별 가이드 |
| [`deploy/myai.service`](./deploy/myai.service) | systemd 유닛 (샌드박싱 포함) |
| [`deploy/myai.env.example`](./deploy/myai.env.example) | `/etc/myai.env`로 복사할 환경변수 |
| [`deploy/Caddyfile`](./deploy/Caddyfile) | Caddy 리버스 프록시 (Let's Encrypt 자동) |
| [`deploy/nginx.conf.example`](./deploy/nginx.conf.example) | nginx vhost (certbot 사용) |

핵심 주의사항:

- **HTTPS는 필수**입니다. 프론트엔드 `WebCrypto AES-GCM`은 보안 컨텍스트(`https://` 또는 `http://localhost`)에서만 동작합니다.
- 운영에서는 `HOST=127.0.0.1`로 묶고 리버스 프록시 뒤에 두세요. (`server/index.js`가 `HOST` 환경변수를 읽어 바인딩합니다.)
- 프록시는 스트리밍을 차단하지 않도록: nginx면 `proxy_buffering off` + `proxy_read_timeout 1h`, Caddy면 `flush_interval -1`.
- 업로드 한도(`MAX_UPLOAD_BYTES`)는 프록시 한도(`client_max_body_size` / Caddy `request_body max_size`)와 일치시킬 것.
- CPU 전용 추론은 매우 느립니다. 실서비스에는 NVIDIA GPU 권장 (Ollama 설치 스크립트가 자동 감지).

## Supported Inputs

- **이미지**: PNG, JPG, JPEG, WEBP, GIF
- **문서**: PDF, DOCX, XLSX, CSV, PPTX, HWPX

레거시 `.hwp` 바이너리는 의도적으로 미지원입니다 — HWPX로 변환해 주세요. `.xls`도 안전한 파싱을 위해 `.xlsx`로 변환 권장.

## Project Structure

```
server/
  index.js           Express 서버 + 라우트
  env.js             루트 .env 로더
  ollama.js          Ollama 호출 / 시스템 프롬프트 / 후속 질문
  parsers.js         업로드 파일 파싱 (PDF/Office/HWPX/이미지)
  visualization.js   차트/인포그래픽 JSON 컨텍스트와 검증 헬퍼
  documents.js       문서 요약·직렬화 헬퍼
  documentStore.js   서버 메모리 문서 캐시 (런타임용)
public/
  index.html         앱 셸 + 설정 다이얼로그
  app.js             프론트엔드 상태/UI/암호화 IndexedDB 영속화
  answerRenderer.js  마크다운-라이트 답변 렌더러 (섹션/리스트/표)
  visualizationRenderer.js  SVG 차트/KPI/표/인포그래픽 렌더러
  fileDisplay.js     파일명 표시·복구·타입 배지
  textRepair.js      mojibake 점수 계산·복구 헬퍼
  styles.css         테마 토큰, 레이아웃, 메시지/설정 UI
```

내부 작업 메모와 다음 작업자용 가이드는 [`agents.md`](./agents.md) 참고.

## License

Private project. Not yet released under an open-source license.
