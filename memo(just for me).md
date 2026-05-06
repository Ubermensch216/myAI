myAI 프로젝트 진단 보고서
핵심 방향 요약
두 계층 부서 AI 어시스턴트 — GPU 워크스테이션(Ollama + RAG 백엔드)과 개인 PC(브라우저 전용 + 암호화 IndexedDB)를 분리한 구조로, 부서 지식 공유와 개인 데이터 격리를 동시에 달성하는 것이 목표입니다.

스프린트별 완료 현황
Sprint	목표	상태
1 — RAG 프로파일 분리 + 공통 안전장치	ragConfig, departmentRag, embeddingValidator, retrievalLogger	✅ 완료
2 — Qdrant + SQLite FTS5 어댑터	dual-write, rebuild/check 스크립트	✅ 완료
3 — 비동기 인제스트 잡 큐	notebookIngestJobs, admin UI 폴링/재시도	🔶 대부분 완료, 세부 진행률 미완
4 — 멀티유저 동시성 + 운영	modelQueue, rate limit, admin RAG status	🔶 대부분 완료, 프로덕션 검증 미완
5 — Reranker + 품질 평가	reranker.js 구현 + golden fixtures + 품질 테스트	⚠️ reranker.js만 존재, 평가 인프라 전무
6 — 배포 패키지	docker-compose, Caddyfile, systemd	🔶 기본 배포는 완료, backup/restore/문서 미완


보완/수정 필요 사항
1순위 — 기능 공백 (코드가 없음)
Sprint 5: RAG 품질 평가 인프라 부재

fixtures/rag/department-golden.json — 없음
scripts/rag-quality-test.mjs — 없음
reranker가 실제로 성능을 개선하는지 측정할 수단이 없는 상태. Recall@10, MRR@10 베이스라인 없이 reranker를 배포한 것은 "효과 미검증" 상태입니다.
Sprint 6: 백업/복구 스크립트 부재

scripts/backup-department-rag.mjs — 없음
scripts/restore-department-rag.mjs — 없음
Qdrant 벡터 인덱스 + SQLite FTS + JSON 매니페스트 세 곳에 데이터가 분산되어 있는데 동기화된 백업 수단이 없습니다.
2순위 — KNOWN_ISSUES.md의 미해결 High Priority 항목
KNOWN_ISSUES.md:4-8 — 아래 항목들이 열려 있습니다:

브라우저 스모크 테스트 부재 — upload, chat, visualization, notebook selection, citations, Map-Reduce, calendar 플로우에 대한 브라우저 레벨 테스트가 없음. 현재 scripts/smoke-test.mjs는 서버 연결 수준만 확인합니다.
비캘린더 파괴적 작업의 인앱 확인 다이얼로그 미완 — 캘린더는 완료, 나머지 (문서 삭제, 룸 삭제 등) 미구현
XLSX 회귀 픽스처 확장 필요 — 현재 케이스 외 추가 케이스 필요
3순위 — 운영 위험 요소
Sprint 3 잔여: 세부 임베딩/인덱싱 진행률
RAG_REFACTOR_PLAN.md:62 — 현재 인제스트 잡은 "전체 완료/실패" 단위로만 표시됩니다. 청크 단위 임베딩 진행률이 없어서 대용량 문서 업로드 시 admin이 진행 상황을 알 수 없습니다.

Sprint 4 잔여: 프로덕션 리버스 프록시 검증
Caddy/Nginx가 SSE 스트리밍 응답을 버퍼링하지 않는지 실제 검증이 필요합니다. KNOWN_ISSUES.md:36에 명시된 위험입니다.

uploads/ 디렉토리 접근 제어
KNOWN_ISSUES.md:46 — 파싱 오류 경로에서 임시 파일이 정리되는지 확인 필요.

4순위 — 문서/관리 부채
note.md 내용이 outdated
Sprint 3/4 완료 후에도 이미 구현된 항목들(브라우저 저장소 UX, 인제스트 재시도 등)이 여전히 권고 사항으로 남아 있습니다. 이 파일을 현재 상태에 맞게 갱신하거나 삭제해야 합니다.

커밋 메시지가 모두 "s"
20개 커밋 중 17개가 s로만 표시됩니다. git 히스토리가 사실상 없는 상태입니다.

docs/DEPARTMENT_DEPLOYMENT.md 부재
Sprint 6 태스크에 명시되어 있으나 docs/ 디렉토리에 없습니다. 배포 절차가 deploy/DEPLOY.md에 부분적으로 있지만 부서 전용 배포 문서가 별도로 필요합니다.

우선순위 행동 제안

1. scripts/rag-quality-test.mjs + golden fixtures 작성   → Sprint 5 완성
2. backup/restore 스크립트 작성                          → Sprint 6 완성, 운영 안전
3. 인제스트 청크 단위 진행률 구현                         → Sprint 3 완성
4. note.md 현행화 또는 삭제                              → 관리 부채 해소
5. 브라우저 스모크 테스트 작성                           → 회귀 방지