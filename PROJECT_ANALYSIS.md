# myAI 프로젝트 분석 보고서

분석 대상 경로: `D:\Dev\myAI`
분석 일자: 2026-04-30
대상 파일: 서버 6개, 프론트 5개, 배포 5개, 문서 2개 (총 약 4,900 LOC, `node_modules` 제외)

---

## 1. 한 줄 요약

myAI는 **로컬 Ollama**를 LLM 백엔드로 사용하는 1인용 한국어 AI 비서 웹앱이다. Node + Express는 "파일 파서 + Ollama 프록시" 역할만 하고, **모든 사용자 데이터(대화·설정·업로드 본문)는 브라우저 IndexedDB에 AES‑GCM으로 암호화**되어 저장된다. 서버는 사실상 stateless이며 영속 저장소는 브라우저다.

---

## 2. 아키텍처

```
[사용자 PC]
  ├── 브라우저(IndexedDB + AES-GCM 256)  ← 진짜 데이터 보관소
  │     ├── records.app-state    (rooms, messages, documents, settings)
  │     └── keys.local-aes-gcm-key (non-extractable CryptoKey)
  │
  ├── Node/Express (server/) → 정적 파일 서빙 + 파일 파싱 + Ollama 프록시
  │     └── documentStore Map (휘발성, 재시작 시 비워짐)
  │
  └── Ollama 데몬(127.0.0.1:11434) → 실제 추론
```

핵심 디자인 결정: 브라우저가 source of truth. 서버 메모리 캐시는 같은 프로세스 수명 동안의 편의 캐시일 뿐이며, 클라이언트가 매 `/api/chat` 요청마다 전체 문서 페이로드를 함께 보낸다(`getActiveDocuments()` → 요청 본문 `documents`). 서버 재시작에도 분석 컨텍스트가 유지되는 이유다.

---

## 3. 디렉터리/파일 맵

```
server/
  index.js          Express 앱, 라우트 정의 (147 LOC)
  ollama.js         Ollama 스트리밍 호출 + 시스템 프롬프트 + 후속질문 (326 LOC)
  parsers.js        PDF/DOCX/XLSX/PPTX/HWPX/이미지 파싱 (274 LOC)
  retrieval.js      BM25 청크 선택기 (94 LOC)
  documents.js      문서 직렬화 헬퍼 (25 LOC)
  documentStore.js  서버 인메모리 Map (28 LOC)

public/
  index.html        앱 셸 + 설정 다이얼로그 (179 LOC)
  app.js            상태/UI/IndexedDB 암호화/스트리밍 (1,305 LOC)
  answerRenderer.js 마크다운-라이트 답변 렌더러 (254 LOC)
  fileDisplay.js    파일 배지/표시명 (22 LOC)
  textRepair.js     mojibake 점수/복구 (31 LOC)
  styles.css        테마 토큰, 레이아웃 (1,312 LOC)

deploy/
  myai.service       systemd 유닛 (샌드박싱 포함)
  myai.env.example   /etc/myai.env 템플릿
  Caddyfile          Caddy 자동 TLS
  nginx.conf.example nginx + certbot
  DEPLOY.md          Ubuntu/Debian 단계별 가이드

agents.md            내부 작업 메모 (785 LOC, 다음 작업자용)
README.md            사용자용 문서
```

---

## 4. 서버 (`server/*.js`)

### 4.1 라우팅 (`index.js`)

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/status` | Ollama `/api/tags` 호출, 모델 목록·기본 모델 반환 |
| GET | `/api/documents` | 서버 메모리 문서 요약 목록 |
| GET | `/api/documents/:id` | 서버 메모리에 있을 때 전체 페이로드 반환 (구식 IndexedDB 레코드 hydrate용) |
| DELETE | `/api/documents/:id` | 서버 메모리에서 제거 |
| POST | `/api/upload` | multer 단일 파일 → `parseUpload` → 클라이언트에 전체 페이로드 반환 |
| POST | `/api/chat` | text/plain 청크 스트리밍 |
| POST | `/api/followups` | 1~3개 한국어 후속 질문(JSON) |
| `app.use(...)` | catch‑all | `index.html` 반환 (SPA 폴백) |

업로드는 multer로 `uploads/`에 임시 저장 후 `finally`에서 unlink. 좋은 패턴.

### 4.2 시스템 프롬프트 (`ollama.js#buildMessages`)

다음 네 부분을 합쳐 한 개의 system 메시지를 만든다:

1. 베이스 규칙(한국어, 근거 중심, 마크다운 최소화, 표는 마크다운 표)
2. 가독성 규칙(섹션 라벨, 컴팩트 불릿, `◆ ● ✓ ※ →` 심볼)
3. 사용자 정의 프롬프트(앞뒤 정리 + 4,000자 제한)
4. (있을 때) `[파일 - 페이지/시트/슬라이드 - part X/Y]` 헤더 붙은 컨텍스트

가장 마지막 user 메시지에 한해 image 문서들의 base64를 `images` 배열로 부착(Ollama 멀티모달 API 규약).

### 4.3 RAG-lite (`retrieval.js`)

- 토크나이저: 영문은 lowercase 단어 단위 + 영문 stopword 제거. CJK(한글/한자/가나) 단어는 **2-그램(bigram)** 까지 추가로 펼쳐 색인.
- 점수: BM25 (k1=1.5, b=0.75), 청크 길이 정규화 포함.
- 컨텍스트 예산: `MAX_CONTEXT_CHARS` (기본 24,000) 안에서 점수 내림차순 + 헤더 오버헤드 80자 가산. 점수 0 청크는 스킵.
- 폴백: 쿼리 토큰이 비거나 점수가 모두 0이면 앞에서부터 그리디 적합.

규모상 합리적이다. 단, **BM25 인덱스를 매 요청마다 새로 만든다**(O(N×토큰)). 1인 사용에선 OK. 다중 사용자/대용량 세션이라면 색인 캐시가 필요해진다.

### 4.4 파서 (`parsers.js`)

- **PDF**: `pdf-parse` → 문자열, 페이지 수만 알려주므로 `splitIntoPages`가 글자수로 균등 분할. 즉 "page" 라벨은 근사치.
- **DOCX**: `mammoth.extractRawText` (서식·이미지 무시).
- **XLSX**: 외부 lib 없이 `JSZip` + `fast-xml-parser`로 `xl/sharedStrings.xml` + `xl/worksheets/sheet*.xml` 직접 파싱. 셀을 콤마로 join → 행 단위 텍스트. 날짜/숫자 포맷·서식은 유실.
- **PPTX**: 같은 방식으로 `ppt/slides/slide*.xml` 텍스트 노드 수집.
- **HWPX**: `Contents/section*.xml` + `Preview/PrvText.txt` 둘 다. `.hwp` 바이너리는 명시적 거부(보안).
- **.xls**: 의도적 거부.
- **이미지**: 그대로 base64화.
- `chunkText`는 `\n\n` 단락 경계로 끊어 `CHUNK_TARGET_CHARS`(기본 1800자)에 맞춤.

`mojibake` 복구는 `public/textRepair.js`의 `normalizeUploadFileName`을 server에서도 import해서 사용. 한국어 파일명이 Latin‑1로 들어와도 UTF‑8로 재해석해 점수가 낮아지면 채택.

> ⚠️ **레이어링 위반**: `server/index.js`가 `../public/textRepair.js`를 import한다. 정적 자산 디렉터리를 서버 코드가 참조하는 형태라 향후 빌드/배포 분리 시 함정이 될 수 있음. `server/textRepair.js`로 옮기거나 `shared/`로 빼는 게 깔끔.

---

## 5. 프론트엔드 (`public/*.js`)

### 5.1 암호화 저장 (`app.js`)

- IndexedDB DB: `ollama-chatter-secure`, version 1.
- 두 object store: `records`(앱 상태), `keys`(키 자체).
- 키: AES‑GCM 256bit, **`extractable=false`**로 생성. 한 번 만든 뒤 `keys` store에 `CryptoKey` 객체 그대로 저장(IndexedDB structured clone이 비추출 키를 보존).
- 저장: 매 변경마다 12바이트 random IV로 새 암호화 → `{iv, data}` base64로 저장.
- 100ms debounce(`scheduleSave`)로 다중 입력 묶음.

위협 모델: "동일 origin의 브라우저 프로필을 손에 쥔 공격자"는 사실상 막을 수 없다(키가 같은 IDB에 있고 origin 코드가 그 키로 복호화 가능). README/UI에는 "PC 내부에 암호화 저장"이라고 표현하지만, 이는 **"디스크상 평문 노출 방지"** 수준이며 OS 사용자 격리·디스크 암호화의 보완재로 이해해야 한다.

### 5.2 채팅 흐름

1. `chatForm` submit → `sendMessage(prompt)` → `requestAssistantResponse(room)`
2. `hydrateStoredDocuments()`로 누락된 본문 복구 시도
3. `AbortController` 만들고 `/api/chat`로 스트리밍 fetch
4. `ReadableStream` reader로 청크 받으며 `renderAssistantContent`로 점진 렌더
5. 스트림 종료 후 `ensureAddressedAnswer`로 사용자 별명 호명 보강
6. 후속질문은 별도 `/api/followups` 호출 (12초 타임아웃, 실패 시 로컬 폴백)
7. 모든 단계에서 `scheduleSave()` 트리거

중지: `Esc` 또는 송신 버튼 재클릭 → `controller.abort()`. abort 에러는 무시(부분 답변 유지).

### 5.3 답변 렌더러 (`answerRenderer.js`)

풀 마크다운 파서가 아닌 의도적 lite 구현:

- `**bold**`, `__b__`, `*i*`, `_i_`, `` `code` ``, `# heading` 마크 모두 **제거**
- 마크다운 표만은 살려서 `<table>`로 변환
- `- * + • -> ※`, `1. 1)` → 컴팩트 리스트
- 짧은 라벨 라인(`Summary`, `Key points`, `요약`, `근거`, `주의점`, ...)은 섹션 타이틀로 인식, 라벨 종류에 따라 `◆ ● ✓ ※ → ◇` 심볼 자동 부여
- 모델이 라벨 앞에 글리프를 직접 찍어 보내도 `cleanSectionLabel`이 떼어내 중복 방지

### 5.4 모자이크/문자 인코딩 보정 (`textRepair.js`)

`mojibakeScore = mojibake×4 + control×8 − hangul`로 점수를 매겨, Latin‑1로 잘못 해석된 한글을 UTF‑8로 다시 디코드한 결과의 점수가 더 낮으면 채택. 업로드와 표시 양쪽에서 동일 로직을 쓴다.

### 5.5 테마

`--accent` / `--accent-dark` 두 토큰만 바꿔도 사이드바 활성 강조, 섹션 심볼 배지, 버튼 등 모든 강조색이 자동 재착색되도록 CSS 변수만 갈아끼우는 깔끔한 구조.

- 밝기: `:root[data-theme="light|dark"]`
- 색상: `:root[data-color-theme="busan|water"]` (부산 CI/부산 상수도 CI)

---

## 6. 배포 (`deploy/`)

`DEPLOY.md`는 Ubuntu/Debian 기반으로 잘 정리되어 있다. 핵심 포인트:

- **HTTPS 필수**: WebCrypto AES‑GCM은 secure context에서만. localhost 또는 https://가 아니면 저장이 깨진다.
- `HOST=127.0.0.1` + 리버스 프록시(Caddy or nginx).
- 스트리밍 보존: nginx `proxy_buffering off`, Caddy `flush_interval -1`.
- 업로드 한도 일치: 앱 `MAX_UPLOAD_BYTES` ↔ 프록시 `client_max_body_size` / `request_body max_size` (40MB).
- `myai.service`의 systemd 샌드박싱이 충실: `ProtectSystem=strict`, `ProtectHome=true`, `MemoryDenyWriteExecute=true`, `NoNewPrivileges=true`, `ReadWritePaths=/opt/myai/uploads`만 쓰기 허용. 운영 표준 수준.
- 인증은 앱이 아니라 프록시 단(basic auth, oauth2-proxy, authelia)에서 부과하라고 명시.

---

## 7. 의존성 / 보안 노트

| 패키지 | 버전 | 메모 |
|---|---|---|
| express | 4.22.1 | OK. v5 GA 됐지만 호환 이슈 없음. |
| multer | 2.1.1 | 신규 메이저(2.x). 좋다. |
| pdf-parse | 1.1.4 | **장기 미관리**. 잘 알려진 require‑side‑effect 이슈가 있고 알트가 다양함(`pdfjs-dist`, `unpdf`, `pdf2json`). |
| mammoth | 1.12.0 | 안정. |
| jszip | 3.10.1 | 안정. |
| fast-xml-parser | 5.7.2 | 5.x 사용. 양호. |

총 111 패키지(트리). 비교적 슬림. `npm audit` 자체는 agents.md상 "초기 검증 후 재실행 필요"로 적혀 있어 의존성 신규 추가 시 재실행 권장.

---

## 8. 발견된 이슈 / 개선 후보

### A. 문서/코드 불일치 (agents.md drift)

`agents.md` 안에 실제 코드와 어긋나는 내용이 다수 있다. 다음 작업자가 혼동할 위험:

1. **존재하지 않는 파일을 언급**: `server/fileNames.js` — 실제로는 `public/textRepair.js`를 import해서 씀.
2. **존재하지 않는 함수**: `server/documents.js`의 `mergeDocuments`. grep 결과 정의/사용처 모두 없음.
3. **`/api/chat` 본문에 `documentIds`** 라고 적혀 있지만 실제 핸들러는 `documentIds`를 읽지 않음 (`documents`만 읽음).
4. **기본 모델 표기 차이**: agents.md "기본 모델: gemma4:e2b" vs README/.env.example/코드 기본값 `gemma3n:e2b`. (실제 동작은 `gemma3n:e2b`.)
5. agents.md의 "Recent Verification" 섹션이 `gemma4:e2b` 기준 status 응답을 예시로 둠.

> 권장: agents.md의 4개 섹션(Important Files / Server API / Recent Changes / Recent Verification)을 한 번 일제 재정렬하면 다음 사람이 시간을 크게 절약함.

### B. 보안 / 운영

1. **앱 자체 인증 없음**: 의도된 결정이지만, 프록시 미설정 환경에서 `HOST` 미지정 시 0.0.0.0:3000으로 노출됨. README가 경고하나, 기본값을 `127.0.0.1`로 두는 것이 안전한 디폴트일 수 있음.
2. **CORS 미설정**: 같은 origin 가정. 외부 프런트엔드 분리 시 보강 필요.
3. **Catch-all SPA 폴백이 모든 메서드를 흡수**: 잘못된 메서드의 `/api/...` 요청에 HTML이 200으로 응답 가능. 라우트 미스 핸들러를 `/api/*` 한정으로 분리해 JSON 404로 답하면 더 명확.
4. **인메모리 documentStore에 LRU/상한 없음**: 서버 단일 사용자 가정이라 사실상 문제는 없으나, 다중 사용자 + 대형 페이로드일 때 OOM 가능.
5. **`/api/chat` 본문에 documents 전체 echo**: `MAX_JSON_BYTES=80mb` + 매 턴 모든 활성 문서 재전송. 큰 PDF를 첨부한 긴 대화는 RTT마다 수십 MB 왕복. RAG 외부 색인이나 chunk 캐시가 필요할 수 있음 (agents.md "Known Constraints"에서 본인도 언급).

### C. 데이터/파싱 정밀도

1. **PDF 페이지 분할이 근사치**: `pdf-parse`가 페이지별 텍스트를 주지 않아 글자 수 균등 분할. 페이지 번호로 근거를 인용해 달라는 시스템 프롬프트와 충돌. 정밀 인용이 중요하면 `pdfjs-dist`로 전환.
2. **XLSX 셀 타입/날짜/포맷 유실**: 콤마 join이라 표 같은 데이터 분석 품질이 떨어질 수 있음. 최소한 셀 타입(`s/n/b/d`)에 따라 변환 + 날짜 시리얼 처리 정도는 추가 가치 큼.
3. **HWPX preview 텍스트 중복**: `Preview/PrvText.txt`는 본문의 일부 발췌 사본인데 본문 XML과 함께 모두 컨텍스트에 들어감. 한국어 문서에서 "같은 단락 두 번"이 모델 답변에 영향을 줄 수 있음.

### D. UX/렌더링

1. **`pdf-parse` 동기 로딩**: 큰 PDF 파싱 동안 이벤트 루프 블록. multer는 이미 비동기지만 `pdf-parse` 자체가 CPU 작업. 상관없지만 동시 사용자 시 응답성 저하.
2. **`requestSubmit()` 직후의 `editUserPrompt`** 흐름에서 `originalText` fallback이 `dataset.copyText`(이전 텍스트)이라, 편집 도중 다른 곳에서 텍스트가 갱신되면 취소 시 동기화가 어긋날 수 있음(현실적으론 거의 없음).
3. **`renderRooms`가 메시지마다 DOM 전부 재생성**: 방 목록만 갱신해도 매번 생성. 1인용 규모라 무시 가능.

### E. 버그 후보(낮은 가능성)

- `parseListItem` 정규식이 `-> | ※`를 허용하나, `parseAnswerBlocks`가 첫 라인이 ordered인지 unordered인지로 그룹을 나눈다. `※`는 ordered=false 그룹에 속하므로 일반 불릿과 섞인다(의도된 것으로 보임).
- `cleanPlainText`가 `*텍스트*`도 강조 마크업으로 보고 `*`을 떼므로, 곱셈 표현 `2*3` 같은 수식이 `23`으로 보일 수 있다.

### F. 테스트 부재

자동화 테스트가 없다. 다음 단위는 가성비 높음:
- `parseAnswerBlocks` 입력→출력 스냅샷 (이미 agents.md에 인라인 테스트 명령이 있음)
- `pickRelevantChunks` BM25 동작
- `repairMojibake` 한글 패턴 회귀
- 각 파서별 작은 픽스처(.docx 한글 짧은 본문, .xlsx 1행1셀, .pptx 1슬라이드, .hwpx PrvText만 있는 케이스)

---

## 9. 수정 한 줄로 잡을 수 있는 것들

1. `server/index.js` 마지막의 catch-all을 SPA 라우트로만 좁히고 `/api/*`엔 JSON 404 반환.
2. `agents.md`의 `gemma4:e2b` 표기 두 군데를 `gemma3n:e2b`로 정정. `mergeDocuments`/`fileNames.js`/`documentIds` 언급 제거.
3. `.env.example`/README의 기본 `HOST`를 `127.0.0.1`로 두고, 외부 노출이 필요할 때 명시 변경하도록 안내(현재는 미설정 = 0.0.0.0).
4. `server/index.js`가 `../public/textRepair.js`를 import 하는 부분을 `server/textRepair.js`로 옮기고 public은 별도 카피 또는 빌드 파이프라인 거치게.

## 10. 더 큰 개선 후보

- `pdf-parse` → `unpdf` 또는 `pdfjs-dist`로 교체해 페이지별 텍스트 + 정확한 페이지 번호 인용.
- 문서를 IndexedDB에 저장하되 **/api/chat 본문에는 임베딩/요약/청크 ID만 전송**, 서버는 클라이언트가 미리 캐시해 둔 청크 인덱스를 받아 BM25만 수행. 토큰/대역폭 절약.
- 비밀번호 기반 KEK(PBKDF2/Argon2) 도입해 디바이스 도난 시 추가 방어선.
- 자동 테스트(노드 내장 `node --test`로 충분).
- 로컬 OCR(테서랙트.js)로 스캔 PDF/이미지 내 텍스트도 컨텍스트화.

---

## 11. 종합 평가

- **설계**: 1인용 로컬 비서로서의 위치 잡기가 명확. "브라우저가 진실, 서버는 stateless 도구"라는 결정이 일관되게 적용되어 있어 디버깅이나 장애 시 사고 모델이 단순.
- **코드 품질**: ESM, 작은 함수 단위 분해, 명확한 네이밍, 사이드 이펙트 적은 헬퍼들. 파서 직접 구현은 외부 의존을 줄이고 빌드를 가볍게 한다.
- **운영 준비도**: systemd 샌드박싱, Caddy/nginx 양쪽 템플릿, HTTPS·스트리밍·업로드 한도 등 운영자가 실수하기 쉬운 포인트를 모두 짚어 둔 `DEPLOY.md`. 동급 사이드 프로젝트 중 상위.
- **약점**: 자동 테스트 부재, agents.md 문서 drift, RAG 캐싱 부재, PDF 페이지 단위 정확도, 인증 외부 의존.
- **즉시 위험은 없음**. 다음 작업자가 가장 먼저 손대면 좋은 것은 (a) agents.md 동기화, (b) `/api/chat` 본문 다이어트(또는 RAG 분리), (c) 작은 파서 회귀 테스트.

---

문서 작성: 자동 분석. 의문 가는 부분이 있으면 해당 절·라인을 짚어 말씀해 주세요. 더 깊게 파고들거나, 위 후보 중 일부를 실제 패치로 정리해 드릴 수 있습니다.
