# Korean Law MCP 대비 myAI 법령 기능 Gap Analysis

작성일: 2026-05-15
현행화: 2026-05-16

## 분석 소스

- Korean Law MCP reference implementation: https://github.com/chrisryugj/korean-law-mcp
- Lean Korean Law MCP implementation: https://github.com/seo-jinseok/korean-law-mcp
- myAI repository: https://github.com/Ubermensch216/myAI
- myAI README: https://github.com/Ubermensch216/myAI/blob/main/README.md
- myAI Korean Law Engine 문서: https://github.com/Ubermensch216/myAI/blob/main/docs/KOREAN_LAW_ENGINE.md
- myAI law API router: https://github.com/Ubermensch216/myAI/blob/main/server/law/lawApi.js
- myAI law tool registry: https://github.com/Ubermensch216/myAI/blob/main/server/law/tools/toolRegistry.js

2026-05-16 기준 공개 검색 결과에서 `chrisryugj/korean-law-mcp`는
“법제처 41개 API → 17개 MCP 도구”의 TypeScript 구현으로, `seo-jinseok/korean-law-mcp`는
법령·판례·행정규칙·법령해석례·서식 검색 중심의 Python 구현으로 확인된다.
이 문서는 더 넓은 기능군을 가진 `chrisryugj/korean-law-mcp` 계열을 주 비교 대상으로
두고, `seo-jinseok/korean-law-mcp`의 별표/서식·법률 체인 탐색 흐름도 보조 참고한다.

## 요약 결론

myAI는 Korean Law MCP의 핵심 기능인 법령 검색, 조문 조회, 판례·해석례·행정규칙·자치법규 검색, 인용 검증, 영향도 분석, 시점 비교, 시민 행동계획, 법령 KG 연계까지 상당 부분 이미 구현하고 있다.

다만 Korean Law MCP의 전체 툴 레지스트리는 myAI보다 전문 도메인 커버리지가 넓다. 특히 조세심판, 관세해석, 헌재 결정, 행정심판, 공정위·개인정보위·노동위·권익위 결정문, 소청심사, 조약, 영문법령, 법령용어 지식베이스, 별표/서식, 신구법 비교, 3단비교, 위임법령/자치법규 연계, 문서 법률 리스크 분석 체인 등은 myAI에 명시적으로 부족하거나 독립 기능으로 드러나지 않는다.

myAI는 단순 MCP 서버 복제가 아니라 채팅, 업로드 문서, 부서 노트북 RAG, Studio UI, 지식그래프를 결합한 네이티브 법령 엔진 구조이므로, Korean Law MCP의 기능을 그대로 복제하기보다는 myAI의 업무 흐름에 맞춰 선택적으로 흡수하는 것이 적절하다.

## 1. myAI에 이미 구현된 Korean Law MCP 핵심 기능

| 기능군 | Korean Law MCP | myAI 구현 상태 | 판단 |
|---|---|---|---|
| 법령명 검색 | `search_law` | `/api/law/search`, `search_law` | 구현됨 |
| AI/자연어 법령 검색 | `search_ai_law` | `/api/law/ai-search`, `search_ai_law` | 구현됨 |
| 조문 조회 | `get_law_text`, `get_article_detail` | `/api/law/article`, `get_article_detail`, `get_law_text` | 구현됨 |
| 인용 검증 | `verify_citations` | `/api/law/verify-citations`, `verify_citations` | 구현됨 |
| 판례 | `search_precedents`, `get_precedent_text` | `/precedents/search`, `/precedents/detail` | 구현됨 |
| 법령해석례 | `search_interpretations`, `get_interpretation_text` | `/interpretations/search`, `/interpretations/detail` | 구현됨 |
| 행정규칙 | `search_admin_rule`, `get_admin_rule` | `/admin-rules/search`, `/admin-rules/detail` | 구현됨 |
| 자치법규 | `search_ordinance`, `get_ordinance` | `/ordinances/search`, `/ordinances/detail` | 구현됨 |
| 영향도 분석 | `impact_map` | `/api/law/impact-map`, Studio Law Explorer | 구현됨 |
| 시점 비교 | `time_travel`, history 계열 | `/article/at`, `/article/diff`, `/history`, `/time-travel` | 구현됨 |
| 시민 행동계획 | `action_plan` | `/api/law/action-plan`, chat `action_plan` mode | 구현됨 |
| 툴 디스커버리 | `discover_tools`, `execute_tool` | `/api/law/tools`, `/api/law/execute` | 구현됨 |
| 법령 KG 연계 | impact/chain 중심 | 부서 노트북 KG의 `Statute`/`Article` 노드 연계 | myAI가 더 강함 |

myAI 문서 기준으로 Korean Law Engine은 Phase 1~5와 Knowledge Graph track이 완료된 상태이며, 실제 라우터에도 주요 법령 API가 등록되어 있다.

## 2. Korean Law MCP에는 있으나 myAI에 부족한 기능

### 2.1 전문 결정례/심판례 도메인

Korean Law MCP는 다음 전문 도메인 도구를 제공한다.

- 조세심판: `search_tax_tribunal_decisions`, `get_tax_tribunal_decision_text`
- 관세해석: `search_customs_interpretations`, `get_customs_interpretation_text`
- 헌재 결정: `search_constitutional_decisions`, `get_constitutional_decision_text`
- 행정심판: `search_admin_appeals`, `get_admin_appeal_text`
- 공정위 결정문: `search_ftc_decisions`, `get_ftc_decision_text`
- 개인정보위 결정문: `search_pipc_decisions`, `get_pipc_decision_text`
- 노동위 결정문: `search_nlrc_decisions`, `get_nlrc_decision_text`
- 권익위 결정문: `search_acr_decisions`, `get_acr_decision_text`
- 소청심사: `search_appeal_review_decisions`, `get_appeal_review_decision_text`
- 권익위 특별행정심판: `search_acr_special_appeals`, `get_acr_special_appeal_text`

myAI는 현재 판례·법령해석례·행정규칙·자치법규 중심이다. 공공부문 실무에서는 헌재, 행심, 소청심사, 노동위, 공정위, 개인정보위 결정례의 활용도가 높으므로 우선 도입 가치가 크다.

권장 우선순위: 높음

### 2.2 별표/서식 조회

Korean Law MCP에는 `get_annexes`가 독립 도구로 존재한다. 행정처분 기준, 과태료, 수수료, 제출서류, 서식은 본문보다 별표·별지에 있는 경우가 많다.

myAI 법령 엔진 문서와 라우터에는 별표/서식 독립 엔드포인트가 명시적으로 보이지 않는다.

권장 우선순위: 매우 높음

권장 구현안:

```text
POST /api/law/annexes
tool: get_annexes
Studio Law Explorer: 별표/서식 탭
chat: “필요서류/처분기준/별표” 질의 시 자동 호출
```

### 2.3 신구법 비교·3단비교·법령체계 고급 분석

Korean Law MCP에는 다음 기능이 존재한다.

- `compare_old_new`: 신구법 대조표
- `get_three_tier`: 법률-시행령-시행규칙 3단비교
- `compare_articles`: 두 법령 조문 비교
- `get_law_tree`: 편·장·절 목차 구조
- `get_law_system_tree`: 상위법·하위법·관련법령 관계
- `get_delegated_laws`: 위임법령 목록
- `get_linked_ordinances`
- `get_linked_ordinance_articles`
- `get_linked_laws_from_ordinance`

myAI에는 `/history`, `/article/at`, `/article/diff`, `impact-map`이 있어 시점 비교와 영향도는 구현되어 있지만, 법률-시행령-시행규칙 3단 구조, 위임 미제정, 법령-자치법규 조문 대응은 별도 API로 보이지 않는다.

권장 우선순위: 높음

권장 구현안:

```text
POST /api/law/three-tier
POST /api/law/delegated-laws
POST /api/law/linked-ordinances
POST /api/law/linked-ordinance-articles
POST /api/law/linked-laws-from-ordinance
```

### 2.4 조약·영문법령

Korean Law MCP에는 다음 도구가 있다.

- `search_treaties`, `get_treaty_text`
- `search_english_law`, `get_english_law_text`

myAI에는 명시적 조약/영문법령 라우트가 없다. 일반 행정 업무에서는 우선순위가 낮을 수 있으나, 국제협력·통상·외국인·조달·FTA 업무가 있다면 도입 가치가 있다.

권장 우선순위: 중간

### 2.5 법령용어 지식베이스

Korean Law MCP에는 다음 용어 관련 도구가 있다.

- `search_legal_terms`
- `get_legal_term_kb`
- `get_legal_term_detail`
- `get_daily_term`
- `get_daily_to_legal`
- `get_legal_to_daily`
- `get_term_articles`
- `get_related_laws`

myAI는 자연어 `action_plan`과 `ai-search`가 있으므로 일부 대체 가능하지만, 시민 질문을 법령 용어로 변환하거나 행정문서 용어를 정제하는 데는 전용 용어 KB가 더 안정적이다.

권장 우선순위: 중간~높음

### 2.6 문서 법률 리스크 분석 체인

Korean Law MCP에는 `analyze_document`와 `chain_document_review`가 있다. 계약서/약관/협정서 본문을 조항별로 파싱하고 리스크를 관련 법령/판례와 매핑하는 용도다.

myAI는 업로드 문서 분석, 부서 노트북, 컴플라이언스 검토, Studio 문서화가 이미 강점이므로, Korean Law MCP식 “조항별 위험조항 탐지 → 근거법령 → 판례 매핑”을 독립 기능으로 강화하면 실무성이 높다.

권장 우선순위: 매우 높음

권장 구현안:

```text
mode: department_legal_review
subtype:
- contract_review
- ordinance_review
- policy_review
- agreement_review
- procurement_review
```

권장 출력 형식:

```text
조항 | 위험도 | 문제 가능성 | 공식 근거 | 내부자료 근거 | 수정 제안
```

## 3. myAI가 Korean Law MCP보다 강한 부분

### 3.1 채팅/RAG/업로드 자료와 법령 엔진의 통합

myAI는 법령 근거 `[L]`, 부서 노트북 `[N]`, 웹 검색 `[W]`를 분리하고, 업로드 문서·노트북 자료와 공식 법령 근거를 함께 쓰도록 설계되어 있다. MCP 단독 서버보다 업무 맥락 통합성이 높다.

### 3.2 Studio Law Explorer

myAI는 impact-map 결과를 Studio Law Explorer에서 시각화하고, 조문 이력 탭에서 개정 이력·스냅샷·diff를 보여주는 구조를 갖추고 있다. Korean Law MCP 기능을 추가할 때도 단순 API보다 Studio UI와 결합하는 방식이 바람직하다.

### 3.3 부서 노트북 KG와 법령 KG 결합

myAI는 부서 노트북 지식그래프에서 `Statute`, `Article`, `REFERS_TO_ARTICLE` 관계를 만들고, 답변 시 공식 법령을 재조회한다. 이 기능은 MCP보다 myAI의 업무지식 기반 구조에 더 잘 맞는다.

## 4. 도입 우선순위 제안

### 1순위: 별표/서식 조회

가장 먼저 도입할 기능이다.

이유:

- 행정처분 기준, 수수료, 서식, 과태료, 제출서류가 별표·별지에 많음
- `action_plan`, `department_legal_review`, Studio 문서 작성과 바로 연결 가능
- Korean Law MCP에서도 직노출 도구로 관리됨

### 2순위: 헌재·행심·소청심사·위원회 결정례 통합

myAI의 법령 적합성 검토 기능을 실무형으로 끌어올리는 기능이다.

우선 도메인:

1. 헌법재판소 결정
2. 행정심판례
3. 소청심사
4. 노동위 결정
5. 개인정보위 결정
6. 공정위 결정
7. 권익위 결정
8. 조세심판/관세해석

권장 구현안:

```text
POST /api/law/decisions/search
POST /api/law/decisions/detail

domain:
- precedent
- constitutional
- admin_appeal
- tax_tribunal
- customs
- ftc
- pipc
- nlrc
- acr
- appeal_review
```

### 3순위: 3단비교·위임법령·자치법규 연계

지자체/공공기관 내부 규정 검토에 직접적인 기능이다.

권장 구현안:

```text
POST /api/law/three-tier
POST /api/law/delegated-laws
POST /api/law/linked-ordinances
POST /api/law/linked-ordinance-articles
POST /api/law/linked-laws-from-ordinance
```

Studio Law Explorer에는 “법체계/위임/자치법규 연계” 탭으로 연결하는 것이 좋다.

### 4순위: 조항별 문서 리스크 리뷰

myAI의 기존 문서 업로드·부서 노트북·Studio 문서 기능과 궁합이 좋다.

권장 구현 방향:

- 업로드 문서 조항 단위 파서
- 위험도 평가 스키마
- 공식 근거 자동 매핑
- Studio 문서 템플릿 “법률 검토의견서” 출력

### 5순위: 법령용어 KB

시민 친화 질문, 행정문서 작성, RAG 검색어 확장에 유용하다.

권장 구현안:

```text
POST /api/law/terms/search
POST /api/law/terms/detail
POST /api/law/terms/daily-to-legal
POST /api/law/terms/legal-to-daily
```

## 5. 기존 myAI 법령 기능 개선 제안

### 5.1 `/api/law/tools`의 툴 목록 세분화

myAI의 현재 `toolRegistry.js`는 핵심 도구를 압축적으로 노출한다. 사용자가 “어떤 법률 도구가 있는지” 탐색하기에는 Korean Law MCP의 전체 툴 구성이 더 상세하다.

개선안:

```json
{
  "name": "get_annexes",
  "implemented": false,
  "priority": "high",
  "mcpEquivalent": "get_annexes",
  "recommendedUi": "Studio Law Explorer > 별표/서식"
}
```

### 5.2 `search_all`의 범위 명확화

myAI의 `search_all`은 기본 법령 리서치 성격이고, Korean Law MCP의 `search_decisions`는 18개 결정례 도메인 통합 검색에 가깝다.

권장 분리:

```text
search_all              → 현행 유지, 기본 법령 리서치
search_official_sources → 법령+판례+해석례+행정규칙+자치법규
search_decisions        → 헌재/행심/위원회/조세/관세 등 결정례 통합
```

### 5.3 `impact_map`의 역방향 탐색 강화

Korean Law MCP의 `impact_map`은 특정 조문을 인용한 판례·헌재·해석례·행심·자치법규를 역방향 탐색하고, 조문이 인용한 다른 법령을 정방향으로 추출하며, Mermaid 시각화까지 제공하는 방향이다.

myAI의 impact map은 공식 조문과 자료 신호 기반의 구조적 영향도 분석에 가깝다. 다음 방향으로 강화하면 좋다.

- 역방향 인용 출처 확대: 판례, 헌재, 행심, 조례, 행정규칙
- 정방향 참조 추출: 해당 조문 본문 내 다른 법령/조문 참조
- Studio에서 “역방향 영향 / 정방향 참조 / 내부자료 영향” 분리 표시
- Mermaid export 추가

## 6. 권장 로드맵

### Phase A — 빠른 실효성 확보

1. `get_annexes` 추가
2. Studio Law Explorer 별표/서식 탭 추가
3. `action_plan`의 “필요서류/양식” 단계에 별표/별지 자동 연결
4. 법령 답변에서 “별표/별지” 문구 감지 시 follow-up 제안

### Phase B — 공식 결정례 확장

1. `search_decisions`, `get_decision_text` 추가
2. 우선 도메인: 헌재, 행심, 소청심사, 노동위, 개인정보위, 공정위
3. 기존 `department_legal_review`의 detailed_report에서 자동 호출
4. citation family를 새로 만들기보다 기존 law metadata의 `sourceType`을 확장

### Phase C — 법체계/위임/자치법규 연계

1. `get_three_tier`
2. `get_delegated_laws`
3. `get_linked_ordinances`
4. `get_linked_ordinance_articles`
5. Studio에 “법체계” 탭 추가

### Phase D — 문서 리스크 리뷰 고도화

1. 업로드 문서 조항 단위 파서
2. 위험도 평가 스키마
3. 공식 근거 자동 매핑
4. Studio 문서 템플릿 “법률 검토의견서” 출력

## 7. 최종 권고

myAI는 Korean Law MCP의 핵심 킬러 기능을 대부분 흡수했다. 특히 인용 검증, 영향도, 시점 비교, 행동계획, 법령 KG 연계는 구현 수준이 높다.

남은 핵심 과제는 Korean Law MCP의 넓은 전문 도메인 커버리지를 myAI의 업무 흐름에 맞춰 선택적으로 흡수하는 것이다. 다음 네 가지를 우선 도입하면 myAI의 공공행정·법무 실무 활용성이 크게 올라간다.

1. 별표/서식 조회
2. 헌재·행심·위원회·조세·관세 등 결정례 통합 검색
3. 3단비교·위임법령·자치법규 연계
4. 업로드 문서 조항별 법률 리스크 리뷰

가장 먼저 할 작업은 `get_annexes`와 `search_decisions/get_decision_text` 계열을 myAI 네이티브 API로 이식하는 것이다.
