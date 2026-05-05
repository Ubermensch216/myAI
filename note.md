CODEX의 검토 결과 (2026.05.05. 11:30)


- RAG는 BM25 + CJK bigram + cosine vector + RRF 조합입니다. 특히 AGENTS.md의 caveat와 달리, 현재 코드는 노트북 청크의 저장된 embedding을 query-time chunk에 넘기고 있습니다. [server/notebooks.js](<D:/Dev/myAI/server/notebooks.js:139>), [server/retrieval.js](<D:/Dev/myAI/server/retrieval.js:95>)

**보완 우선순위**

4. 브라우저 저장소 한계 대응이 필요합니다. 개인 문서와 이미지가 암호화된 IndexedDB에 저장되고 `/api/chat` JSON body로 다시 전송됩니다. 큰 이미지/문서가 누적되면 quota나 `MAX_JSON_BYTES`에 부딪힐 수 있어 저장 용량 표시, 파일별 크기 경고, 오래된 첨부 정리 UX가 필요합니다.

5. 노트북 RAG는 현재 구조상 소규모에는 좋지만 대규모에는 JSON 파일 + 인메모리 LRU 캐시가 병목입니다. `bge-m3` embedding은 활용 가능해졌지만, 문서가 많아지면 persistent vector index, ingest 재시도/진행률, embedding 차원 검증, retrieval 품질 로그가 필요합니다.


5. **노트북 RAG 확장성 개선**
   
   현재 RAG는 설계가 좋고 embedding도 실제로 query-time에 전달됩니다. 즉 “작동 여부”보다 다음 문제는 “대규모에서 유지 가능한가”입니다.

   권장 작업:
   - embedding 차원 검증
   - ingest 실패 재시도와 진행률
   - retrieval 품질 로그
   - 문서 수가 커질 때 persistent vector index 검토
   - JSON 파일 + LRU 캐시 병목 측정


수정된 제안 프레임
원래 Tier 1(dim 검증, 인제스트 retry, retrieval log)은 그대로 유효합니다 — 어떤 RAG 스택을 쓰든 그 셋은 필요합니다. 다만 Tier 2/3을 다음과 같이 다시 짜야 합니다.

Phase A — 현 구조의 결함 수정 + 측정 기반 마련 (이전 Tier 1 그대로)
embedding dim 검증 + manifest 기록
인제스트 배치/재시도/부분 실패 허용
retrieval JSONL 로그
→ 이게 Phase B의 마이그레이션 결정에 필요한 데이터를 만듭니다.

Phase B — Persistent vector index 도입 (새롭게 추가)
선택지를 트레이드오프와 함께 제시합니다:

옵션	강점	약점	부합도
sqlite-vec (better-sqlite3 + sqlite-vec extension)	단일 파일, 의존성 가벼움, FTS5와 같이 BM25+vector 한 DB에서 처리, 백업이 단순	HNSW 미지원(brute-force만), 수십만+ 청크엔 부족	부서당 청크 ≤ 수만이면 ★★★★★
Qdrant (Docker)	본격 ANN(HNSW), payload filter로 BM25-like 결합 가능, REST/gRPC, 멀티유저 동시쿼리 우수	Docker/서비스 추가, 운영 복잡도 ↑	부서 청크 수만+, 다부서 동시 사용이면 ★★★★★
LanceDB (embedded)	임베드형이지만 ANN 지원, 컬럼나 storage	Node.js 바인딩 미숙(Python 우선)	중간
pgvector	기존 Postgres 인프라 있을 때 자연스러움	Postgres 없으면 인프라 비용	인프라 있을 때만
권장: sqlite-vec로 시작 → 측정 후 필요시 Qdrant로 이행. JSON manifest는 source-of-truth로 유지하고 vector index는 보조 인덱스로 두면 롤백/재구축이 단순합니다.

Phase C — "고정밀"의 핵심: Reranker (벡터DB와 별개)
bge-m3는 bi-encoder. "고급-정밀"을 원하면 top-K(예: K=30) 후보를 cross-encoder로 재정렬합니다.

bge-reranker-v2-m3 (한국어 강함, 1B 파라미터)를 GPU 워크스테이션에서 Ollama 또는 별도 inference로 호스팅
검색 흐름: BM25+vector RRF로 K=30 → reranker → top-N=8 인용
GPU가 DGX/5090급이면 reranker latency는 100ms 단위로 충분히 들어옵니다
Phase D — 멀티사용자 동시성 (현재 보이지 않는 약점)
현재 단일 Node.js 프로세스 + 단일 LRU. 5명이 동시에 다른 노트북 query를 쏘면 캐시가 찢어집니다.
벡터DB 도입 시 자동 해결 (캐시 폐기), 동시에 GPU 큐(embedding/reranker 호출 직렬화) 필요
결정에 필요한 질문 (이번엔 더 구체적으로)
목표 규모: 부서당 노트북 몇 개? 노트북당 문서 몇 백/천? 총 청크 추정치는 만 단위인가요, 십만 단위인가요?
동시 사용자: 부서당 몇 명이 동시 query를 쏠 수 있나요? (single-digit이면 sqlite-vec 충분, 두 자릿수면 Qdrant)
운영 복잡도 예산: Docker/추가 서비스를 운영할 사람이 있나요? (없으면 sqlite-vec 강제)
reranker 도입 여부: "고정밀"의 정도가 재현율인지 정확도인지. 정확도 우선이면 reranker가 벡터DB보다 임팩트 큼 — 순서를 바꿀 만합니다.
이전 권고 #4(브라우저 저장소 UX)는 이미 구현되어 있는데, note.md에는 아직 권고로 남아 있습니다. 노트는 outdated인가요, 추가로 보완할 점이 있나요?
답을 주시면 Phase A를 코드로 시작할지, 아니면 Phase B의 옵션부터 결정할지 정하겠습니다. 메모리에는 "벡터DB는 도입 여부가 아니라 시점/선택의 문제"로 저장했습니다.