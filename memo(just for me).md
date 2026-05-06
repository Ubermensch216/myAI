myAI 프로젝트 진단 보고서
핵심 방향 요약
두 계층 부서 AI 어시스턴트 — GPU 워크스테이션(Ollama + RAG 백엔드)과 개인 PC(브라우저 전용 + 암호화 IndexedDB)를 분리한 구조로, 부서 지식 공유와 개인 데이터 격리를 동시에 달성하는 것이 목표입니다.



보완/수정 필요 사항
1순위 — 기능 공백 (코드가 없음)
Sprint 6: 백업/복구 스크립트 부재

scripts/backup-department-rag.mjs — 없음
scripts/restore-department-rag.mjs — 없음
Qdrant 벡터 인덱스 + SQLite FTS + JSON 매니페스트 세 곳에 데이터가 분산되어 있는데 동기화된 백업 수단이 없습니다.


2순위 — KNOWN_ISSUES.md의 미해결 High Priority 항목
KNOWN_ISSUES.md:4-8 — 아래 항목들이 열려 있습니다:

브라우저 스모크 테스트 부재 — upload, chat, visualization, notebook selection, citations, Map-Reduce, calendar 플로우에 대한 브라우저 레벨 테스트가 없음. 현재 scripts/smoke-test.mjs는 서버 연결 수준만 확인합니다.
비캘린더 파괴적 작업의 인앱 확인 다이얼로그 미완 — 캘린더는 완료, 나머지 (문서 삭제, 룸 삭제 등) 미구현
XLSX 회귀 픽스처 확장 필요 — 현재 케이스 외 추가 케이스 필요

