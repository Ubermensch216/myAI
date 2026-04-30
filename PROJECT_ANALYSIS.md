# myAI 프로젝트 분석 보고서

분석 대상 경로: `D:\Dev\myAI`
현행화 일자: 2026-04-30
대상 파일: 서버 7개, 프론트 6개, 배포 5개, 문서 3개, 루트 설정 파일 (`node_modules` 제외)

---

## 1. 한 줄 요약

myAI는 **로컬 Ollama**를 LLM 백엔드로 사용하는 1인용 한국어 AI 비서 웹앱이다. Node + Express는 정적 파일 서빙, 업로드 파일 파싱, Ollama 프록시 역할을 맡고, 대화·설정·업로드 본문은 브라우저 IndexedDB에 AES-GCM으로 암호화되어 저장된다. 서버는 재시작 가능한 stateless 도구에 가깝고, 브라우저가 영속 데이터의 source of truth다.

---

## 2. 현재 아키텍처

```text
[사용자 PC]
  ├── 브라우저
  │   ├── IndexedDB records.app-state
  │   ├── IndexedDB keys.local-aes-gcm-key
  │   └── AES-GCM 암호화된 rooms/messages/documents/settings
  │
  ├── Node/Express
  │   ├── public/ 정적 파일 서빙
  │   ├── 업로드 파일 파싱
  │   ├── /api/chat, /api/followups Ollama 프록시
  │   └── documentStore Map (휘발성 편의 캐시)
  │
  └── Ollama 데몬
      └── http://127.0.0.1:11434
```

핵심 흐름은 단순하다. 업로드 시 서버가 파일을 파싱해 전체 payload를 클라이언트에 반환하고, 클라이언트가 그 payload를 암호화해 IndexedDB에 저장한다. 이후 채팅 요청마다 활성 대화방의 문서 payload를 `/api/chat` 본문 `documents`로 다시 보낸다.

---

## 3. 파일 맵

```text
server/
  env.js            루트 .env 로더 (55 LOC)
  index.js          Express 앱, 라우트 정의 (150 LOC)
  ollama.js         Ollama 호출, 시스템 프롬프트, 후속질문 (329 LOC)
  parsers.js        PDF/DOCX/XLSX/PPTX/HWPX/이미지 파싱 (274 LOC)
  visualization.js  시각화 요청 컨텍스트 구성과 JSON 검증
  retrieval.js      BM25 청크 선택기 (94 LOC)
  documents.js      문서 요약·직렬화 헬퍼 (25 LOC)
  documentStore.js  서버 인메모리 Map (28 LOC)

public/
  index.html        앱 셸 + 설정 다이얼로그 (179 LOC)
  app.js            상태/UI/IndexedDB 암호화/스트리밍 (1,331 LOC)
  answerRenderer.js 마크다운-라이트 답변 렌더러 (254 LOC)
  visualizationRenderer.js SVG 차트/KPI/표/인포그래픽 렌더러
  fileDisplay.js    파일 배지/표시명 (22 LOC)
  textRepair.js     mojibake 점수/복구 (31 LOC)
  styles.css        테마 토큰, 레이아웃 (1,312 LOC)

deploy/
  myai.service
  myai.env.example
  Caddyfile
  nginx.conf.example
  DEPLOY.md

README.md            사용자·운영자용 첫 진입 문서
agents.md            다음 작업자용 상세 핸드오프
PROJECT_ANALYSIS.md  현재 분석 보고서
```

---

## 4. 서버 분석

### 4.1 환경변수

`server/env.js`가 프로젝트 루트의 `.env`를 의존성 없이 읽는다. 이미 지정된 `process.env` 값은 덮어쓰지 않는다. `server/index.js`와 `server/ollama.js`가 모듈 초기화 시점에 `loadLocalEnv()`를 호출하므로 `OLLAMA_URL`, `OLLAMA_MODEL`, `HOST`, 업로드 한도 등이 코드 기본값보다 먼저 반영된다.

주의점: `HOST`는 미설정 시 Express가 모든 인터페이스에서 listen한다. 개발 편의에는 맞지만 운영에서는 `deploy/myai.env.example`처럼 `HOST=127.0.0.1`로 묶고 리버스 프록시 뒤에 두는 구성이 안전하다.

### 4.2 라우트

| 메서드 | 경로 | 역할 |
|---|---|---|
| GET | `/api/status` | Ollama 모델 목록과 기본 모델 반환 |
| GET | `/api/documents` | 서버 메모리 문서 요약 목록 반환 |
| GET | `/api/documents/:id` | 서버 메모리에 남아 있는 전체 문서 payload 반환 |
| DELETE | `/api/documents/:id` | 서버 메모리 캐시에서 제거 |
| POST | `/api/upload` | multer 단일 파일 업로드 후 `parseUpload` 결과 반환 |
| POST | `/api/chat` | Ollama 스트리밍 응답을 text/plain으로 전달 |
| POST | `/api/visualize` | 표 데이터 기반 시각화 요청을 strict JSON으로 생성/검증 |
| POST | `/api/followups` | Ollama로 1-3개 한국어 후속 질문 생성 |
| catch-all | 기타 | SPA 폴백으로 `index.html` 반환 |

업로드 파일은 `uploads/`에 임시 저장되고 `finally`에서 unlink된다. 서버의 `documentStore`는 브라우저 IndexedDB 이전 버전 호환과 같은 프로세스 내 편의 캐시다.

### 4.3 Ollama 컨텍스트 구성

`server/ollama.js`는 시스템 메시지에 기본 응답 규칙, 가독성 규칙, 사용자 정의 프롬프트, 문서 컨텍스트를 합친다. 이미지 문서는 가장 최근 user 메시지의 `images` 배열에 base64로 붙는다.

긴 문서는 `collectChunks()`와 `chunkText()`로 나눈 뒤, 전체 컨텍스트가 `MAX_CONTEXT_CHARS`를 넘으면 `retrieval.js`의 BM25 기반 `pickRelevantChunks()`가 질문과 관련 높은 청크를 선택한다. 한국어·한자·가나 단어는 bigram을 추가해 검색 품질을 보강한다.

---

## 5. 프론트엔드 분석

### 5.1 IndexedDB 암호화 저장

- DB 이름: `ollama-chatter-secure`
- stores: `records`, `keys`
- 앱 상태 key: `records.app-state`
- 로컬 AES-GCM key: `keys.local-aes-gcm-key`
- 키 생성: AES-GCM 256bit, `extractable=false`
- 저장: 매 저장마다 12바이트 random IV 사용

최근 보완으로 `scheduleSave()`가 `persistAppState()`를 거치며, IndexedDB 저장 실패는 `handleLocalSaveError()`를 통해 화면의 상태 영역에 표시된다. 특히 quota 초과는 사용자가 큰 이미지나 문서를 삭제해야 한다는 안내로 표시된다.

남은 한계도 분명하다. 키가 같은 origin의 IndexedDB에 있으므로 이 암호화는 “디스크상 평문 노출 방지”에 가깝다. 브라우저 프로필과 origin 코드 실행 권한을 가진 공격자를 막는 모델은 아니다. 또한 export/import와 저장 용량 표시가 아직 없어 브라우저 프로필 삭제·이전·손상 시 복구 수단이 부족하다.

### 5.2 채팅 흐름

1. user 메시지 저장
2. 필요 시 `hydrateStoredDocuments()`로 구형 summary-only 문서 복구 시도
3. `/api/chat` 스트리밍 fetch
4. 청크 수신마다 `answerRenderer.js`로 점진 렌더
5. 완료 후 assistant 메시지 저장
6. `/api/followups`로 후속 질문 생성

중지는 `AbortController` 기반이다. `Esc` 또는 송신 버튼 재클릭으로 중단하며, 부분 답변이 있으면 남겨 둔다.

### 5.3 데이터 시각화 흐름

CSV/XLSX 업로드는 텍스트뿐 아니라 `headers`, `rows`, `sampleRows`, `profile`을 함께 보존한다. 사용자의 최신 요청에 차트/그래프/인포그래픽 의도가 있고 활성 대화방에 표 데이터가 있으면 프론트엔드는 `/api/chat` 대신 `/api/visualize`를 호출한다.

`/api/visualize`는 표 컨텍스트를 압축해 Ollama에 전달하고 strict JSON 응답을 요구한다. 서버는 `bar`, `line`, `pie`, `scatter`, `table`, `kpi`, `infographic` 타입만 통과시키며, 브라우저는 `visualizationRenderer.js`에서 SVG 차트와 KPI/표/인포그래픽 블록으로 렌더링한다.

### 5.4 답변 렌더링

`answerRenderer.js`는 풀 Markdown 렌더러가 아니라 의도적 lite 렌더러다. 일반 Markdown 강조 마크는 제거하고, 표·리스트·짧은 섹션 라벨만 보기 좋게 변환한다. 섹션 라벨에는 `◆`, `●`, `✓`, `※`, `→`, `◇` 심볼을 자동 부여한다.

---

## 6. 문서와 배포 상태

세 문서는 현재 역할이 분리되어 있다.

- `README.md`: 사용자와 운영자의 첫 진입 문서. 설치, 설정, 지원 형식, 배포 안내를 짧게 제공한다.
- `agents.md`: 다음 작업자용 상세 핸드오프. UI 흐름, 상태 구조, API, 주의사항, 검증 명령을 담는다.
- `PROJECT_ANALYSIS.md`: 전체 구조와 리스크를 요약하는 분석 보고서.

배포 문서는 Ubuntu/Debian 기준으로 systemd, Caddy, nginx 템플릿을 제공한다. `deploy/myai.env.example`은 운영 기본값으로 `HOST=127.0.0.1`을 사용한다.

---

## 7. 주요 의존성

| 패키지 | 설치 버전 | 용도 |
|---|---:|---|
| express | 4.22.1 | HTTP 서버 |
| multer | 2.1.1 | 업로드 처리 |
| pdf-parse | 1.1.4 | PDF 텍스트 추출 |
| mammoth | 1.12.0 | DOCX 텍스트 추출 |
| jszip | 3.10.1 | Office/HWPX ZIP 읽기 |
| fast-xml-parser | 5.7.2 | Office/HWPX XML 파싱 |

`pdf-parse`는 장기 유지보수 관점에서 가장 먼저 교체 후보가 될 수 있다. 현재 구현은 PDF 페이지 텍스트를 정확히 분리하지 못하고 글자수 기반 근사 페이지로 나눈다.

---

## 8. 남은 리스크와 우선순위

### P1

1. **API catch-all 정리**  
   현재 마지막 `app.use()`가 모든 미스 라우트를 `index.html`로 돌린다. `/api/*` 미스는 JSON 404로 분리하는 편이 디버깅과 클라이언트 오류 처리에 좋다.

2. **저장 용량 가시화와 데이터 이관**  
   quota 실패 알림은 생겼지만, 사전 경고·저장 용량 표시·export/import가 없다. 이 앱의 영속 저장소가 브라우저인 만큼 다음으로 가치가 높다.

3. **문서 전송량 다이어트**  
   `/api/chat` 요청마다 활성 문서 전체 payload를 다시 보낸다. 큰 문서와 긴 대화에서는 네트워크·JSON parse 비용이 커진다. 청크 캐시, 요약, RAG 인덱스 분리 같은 구조가 필요할 수 있다.

### P2

1. **PDF 페이지 정확도**  
   페이지 번호 근거를 중요하게 쓰려면 `pdfjs-dist`, `unpdf` 등으로 페이지별 텍스트 추출을 재구성하는 편이 낫다.

2. **파서 회귀 테스트**  
   `node --test` 기반으로 `answerRenderer`, `retrieval`, `textRepair`, 각 문서 파서의 작은 fixture 테스트를 추가하면 리팩터링 안정성이 크게 오른다.

3. **레이어링 정리**  
   서버가 `../public/textRepair.js`를 import한다. 현재는 동작하지만, 장기적으로는 `shared/`나 `server/textRepair.js`로 분리하는 편이 배포 구조에 더 안전하다.

### P3

1. **XLSX 날짜·서식 처리**  
   현재 셀 값을 문자열로 단순 join한다. 날짜 serial, 숫자 포맷, 빈 셀 위치 보존이 필요한 분석에는 한계가 있다.

2. **HWPX preview 중복 가능성**  
   `Contents/section*.xml`과 `Preview/PrvText.txt`를 함께 읽으므로 일부 문서는 유사 텍스트가 중복될 수 있다.

---

## 9. 최근 검증

최근 현행화 시 다음 검증을 실행했다.

```powershell
Get-ChildItem -Recurse -Include *.js -Path .\server,.\public | ForEach-Object { node --check $_.FullName }
node -e "import('./server/env.js').then(({loadLocalEnv})=>{loadLocalEnv('.env.example'); console.log(process.env.OLLAMA_MODEL)})"
node -e "import('./server/ollama.js').then(({DEFAULT_MODEL})=>console.log(DEFAULT_MODEL))"
```

결과: 서버와 프론트의 모든 JS 문법 검사는 통과했고, `.env.example` 로딩과 `DEFAULT_MODEL` 확인 모두 `gemma3n:e2b`를 반환했다. 문서 drift 키워드 검색도 README와 agents 문서 기준으로 통과했다. 최신 현행화에서는 `npm audit`와 실제 `/api/status` 서버 호출은 재실행하지 않았다.

---

## 10. 종합 평가

현재 코드는 “브라우저가 영속 저장소, 서버는 파서와 Ollama 프록시”라는 설계가 일관적이다. 1인용 로컬 비서라는 제품 범위에는 잘 맞고, 배포 템플릿도 비교적 탄탄하다.

가장 큰 약점은 자동 테스트 부재, 브라우저 저장소에 대한 백업/이관 부재, 큰 문서 처리 시 전송량 증가, PDF 페이지 정확도다. 즉시 치명적인 결함보다는 장기 운영성과 데이터 보존성 쪽의 개선 여지가 크다.
