CODEX의 검토 결과 (2026.05.05. 11:30)

분석해보니 이 프로젝트는 꽤 실전형으로 잘 자란 “로컬 AI 비서”입니다. 구조는 단순한 편인데 기능은 넓습니다: Express 서버가 파일 파싱, Ollama 호출, 노트북 RAG, Map-Reduce, 시각화 계획 검증을 맡고, 브라우저는 채팅방/첨부파일/캘린더/설정을 IndexedDB에 AES-GCM으로 저장합니다.

**주요 내용**
- 서버 진입점은 [server/index.js](<D:/Dev/myAI/server/index.js:45>)입니다. `/api/upload`, `/api/chat`, `/api/visualize`, `/api/agent/intent`, `/api/notebooks` 계열을 제공합니다.
- 업로드 파서는 PDF/DOCX/XLSX/CSV/PPTX/HWPX/이미지를 처리합니다. CSV/XLSX는 테이블 프로필까지 만들어 시각화에 씁니다. [server/parsers.js](<D:/Dev/myAI/server/parsers.js:27>)
- RAG는 BM25 + CJK bigram + cosine vector + RRF 조합입니다. 특히 AGENTS.md의 caveat와 달리, 현재 코드는 노트북 청크의 저장된 embedding을 query-time chunk에 넘기고 있습니다. [server/notebooks.js](<D:/Dev/myAI/server/notebooks.js:139>), [server/retrieval.js](<D:/Dev/myAI/server/retrieval.js:95>)
- 긴 문서 전체 분석은 Map-Reduce 방식입니다. 청크 배치를 병렬 map한 뒤 reduce 응답을 스트리밍합니다. [server/mapReduce.js](<D:/Dev/myAI/server/mapReduce.js:35>)
- 프론트는 `public/app.js`가 orchestration을 하고, 기능별 모듈이 분리되어 있습니다: 채팅 [chat.js](<D:/Dev/myAI/public/modules/chat.js:166>), 캘린더 [calendar.js](<D:/Dev/myAI/public/modules/calendar.js:472>), 노트북 [notebook.js](<D:/Dev/myAI/public/modules/notebook.js:1>), 암호화 저장 [persistence.js](<D:/Dev/myAI/public/modules/persistence.js:30>).
- 현재 서버 상태는 정상입니다. `/api/status` 기준 `defaultModel=gemma4:e2b`, 설치 모델은 `bge-m3:latest`, `gemma4:e2b`로 확인됐습니다.

**보완 우선순위**
1. 테스트 체계를 먼저 나누는 게 좋습니다. 현재 `npm test`는 앱 shell/status/calendar intent까지는 통과했지만, 노트북 CRUD/임베딩/분석 단계에서 120초 제한에 걸렸습니다. 빠른 단위 smoke와 Ollama live integration test를 분리해야 CI/로컬 검증이 믿을 만해집니다.

2. 서버 쪽 취소/타임아웃 전파가 약합니다. 프론트는 `AbortController`로 중지하지만 [public/modules/chat.js](<D:/Dev/myAI/public/modules/chat.js:168>), 서버의 Ollama streaming fetch는 클라이언트 disconnect와 강하게 연결되어 있지 않습니다. 긴 Map-Reduce나 큰 파일 분석 중 사용자가 중지해도 서버/Ollama 작업이 계속 돌 가능성이 있습니다.

3. 운영 보안 모델을 명확히 해야 합니다. 노트북 쓰기만 `ADMIN_TOKEN`으로 보호되고, 채팅/업로드/노트북 읽기는 LAN 신뢰 모델입니다. 부서 워크스테이션에 올릴 거라면 reverse proxy, TLS, 외부 auth, 요청 크기/rate 제한을 추가하는 게 안전합니다.

4. 브라우저 저장소 한계 대응이 필요합니다. 개인 문서와 이미지가 암호화된 IndexedDB에 저장되고 `/api/chat` JSON body로 다시 전송됩니다. 큰 이미지/문서가 누적되면 quota나 `MAX_JSON_BYTES`에 부딪힐 수 있어 저장 용량 표시, 파일별 크기 경고, 오래된 첨부 정리 UX가 필요합니다.

5. 노트북 RAG는 현재 구조상 소규모에는 좋지만 대규모에는 JSON 파일 + 인메모리 LRU 캐시가 병목입니다. `bge-m3` embedding은 활용 가능해졌지만, 문서가 많아지면 persistent vector index, ingest 재시도/진행률, embedding 차원 검증, retrieval 품질 로그가 필요합니다.

6. 캘린더는 로컬 비서로는 꽤 탄탄하지만 아직 개인 생산성 앱 수준의 안정성은 부족합니다. 반복 일정은 실제 recurrence 모델이 아니라 daily expansion이고, 알림은 열린 브라우저 탭에 의존합니다. Google/Outlook/ICS sync, timezone UI, rich confirmation dialog가 다음 큰 보완점입니다.

7. 시각화는 설계가 좋습니다. LLM은 plan만 만들고 서버가 검증/계산하는 구조라 안전합니다. 다만 XLSX 파싱은 서식/날짜/수식 평가까지 완전한 spreadsheet engine은 아니므로, 실무 엑셀 호환성을 높이려면 날짜 serial 변환, formula cached value 처리 검증, 더 많은 chart QA가 필요합니다.

검증하면서 생긴 임시 Smoke Test 노트북은 정리했고, `git status`는 깨끗합니다. 다만 이전 실행에서 남은 것으로 보이는 `data/notebooks/nb_5e2e26981932773d`의 Smoke Test 노트북은 제가 만든 것이 아니라 그대로 두었습니다.