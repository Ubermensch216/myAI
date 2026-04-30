# myAI

로컬 Ollama를 백엔드로 쓰는 개인용 AI 비서 웹앱. 여러 대화방, 문서·이미지 업로드 분석, 스트리밍 응답, 후속 질문 추천, 색상 테마, 그리고 모든 대화·설정·업로드 내용을 **브라우저 IndexedDB에 AES-GCM으로 암호화**해 보관하는 것이 특징.

## Features

- **다중 대화방**: 방 단위로 메시지·업로드 파일이 분리 저장
- **문서/이미지 분석**: PDF / DOCX / XLSX / PPTX / HWPX, PNG / JPG / WEBP / GIF
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

- **Node.js 20+** (또는 18 LTS 이상)
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

모든 설정은 환경변수 또는 `.env`로 주입. (자세한 기본값은 [`.env.example`](./.env.example) 참고)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | HTTP 포트 |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama API 엔드포인트 |
| `OLLAMA_MODEL` | `gemma3n:e2b` | 기본 채팅 모델 |
| `MAX_CONTEXT_CHARS` | `24000` | 한 요청에 포함할 최대 문서 컨텍스트 글자 수 |
| `MAX_JSON_BYTES` | `80mb` | Express JSON body 한도 |
| `MAX_UPLOAD_BYTES` | `41943040` | 업로드 파일 한 개당 최대 바이트 (40MB) |

## Deployment Notes

- **HTTPS 필수**: WebCrypto Subtle API는 보안 컨텍스트(`https://` 또는 `http://localhost`)에서만 동작합니다. 외부 호스트로 노출할 때 HTTP로 접속하면 암호화 저장이 작동하지 않으니 nginx/Caddy 등으로 TLS를 종단시키세요.
- **리버스 프록시**: 스트리밍 응답이 끊기지 않도록 `proxy_buffering off` (nginx) 설정과 충분한 `proxy_read_timeout`을 권장. 업로드 한도는 `client_max_body_size`도 같이 맞추세요.
- **systemd 서비스**: `WorkingDirectory`, `ExecStart=/usr/bin/node server/index.js`, `Restart=on-failure`, `Environment=…` 패턴으로 단순 등록 가능.
- **GPU 권장**: CPU 전용에서도 동작하지만 응답 지연이 큽니다. 실서비스라면 NVIDIA GPU + Ollama 자동 감지 사용.

## Supported Inputs

- **이미지**: PNG, JPG, JPEG, WEBP, GIF
- **문서**: PDF, DOCX, XLSX, PPTX, HWPX

레거시 `.hwp` 바이너리는 의도적으로 미지원입니다 — HWPX로 변환해 주세요. `.xls`도 안전한 파싱을 위해 `.xlsx`로 변환 권장.

## Project Structure

```
server/
  index.js           Express 서버 + 라우트
  ollama.js          Ollama 호출 / 시스템 프롬프트 / 후속 질문
  parsers.js         업로드 파일 파싱 (PDF/Office/HWPX/이미지)
  documents.js       문서 직렬화·병합 헬퍼
  documentStore.js   서버 메모리 문서 캐시 (런타임용)
  fileNames.js       업로드 파일명 mojibake 복구
public/
  index.html         앱 셸 + 설정 다이얼로그
  app.js             프론트엔드 상태/UI/암호화 IndexedDB 영속화
  answerRenderer.js  마크다운-라이트 답변 렌더러 (섹션/리스트/표)
  fileDisplay.js     파일명 표시·복구·타입 배지
  styles.css         테마 토큰, 레이아웃, 메시지/설정 UI
```

내부 작업 메모와 다음 작업자용 가이드는 [`agents.md`](./agents.md) 참고.

## License

Private project. Not yet released under an open-source license.
