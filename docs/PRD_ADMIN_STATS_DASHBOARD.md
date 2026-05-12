현재 세션에서는 GitHub API 커넥터가 활성화되어 있지 않아 저장소에 직접 파일을 생성할 수 없습니다.

아래 내용을 그대로 복사하여 저장소에 추가하시면 됩니다.

권장 파일 경로:

```
docs/PRD_ADMIN_STATS_DASHBOARD.md
```

---

# PRD: Admin Statistics Dashboard (Knowledge Operations Dashboard)

## 1. Purpose

Add a new Admin menu: **통계 (Statistics)**.

This feature is not only for operational monitoring. It is designed as a:

```
Knowledge Operations Dashboard
```

It must measure how myAI is actually used across groups, features, notebooks, and legal/compliance workflows, and validate whether the system is functioning as a public-sector AI knowledge platform.

---

## 2. Core Design Principle

myAI does NOT have individual user accounts.

Authentication model:

```
group + level password
anonymous session per group
```

Therefore:

```
No individual user tracking
Group-level and session-level statistics only
```

This avoids personal data issues and fits public-sector deployment.

---

## 3. Goals

The dashboard must answer:

1. Which groups use the system most?
2. Which features are actually adopted?
3. Is Law Engine being used?
4. Is Compliance Review being used?
5. Is Studio Document Editor being used?
6. Which notebooks are most queried?
7. Are responses fast enough?
8. Is RAG quality stable?

---

## 4. Scope (MVP)

### 4.1 Included

* Session statistics
* Query counts
* Feature usage distribution
* Notebook access TOP N
* Law usage ratio
* Compliance usage ratio
* Studio conversion rate
* Average latency
* Session list view

### 4.2 Excluded (Later Phase)

* Individual user tracking
* Real-time streaming dashboard
* Cross-instance federation
* Billing/cost accounting integration

---

## 5. Logging Architecture

### 5.1 Centralized Logging Layer

Create:

```
server/stats/
  sessionLogger.js
  eventLogger.js
  statsAggregator.js
  statsApi.js
  statsDailySummary.js
```

All modules must call a central logger instead of writing logs directly.

Example:

```js
statsLogger.logEvent({
  type: "chat_query",
  groupId,
  level,
  notebookId,
  features,
  latencyMs,
  tokenEstimate
});
```

---

### 5.2 Event Types

```
chat_query
law_query
compliance_run
studio_open
studio_export
notebook_access
kg_render
calendar_query
login
logout
```

---

### 5.3 Log Storage Strategy

Two-layer design:

Layer 1: Append-only JSONL

```
data/logs/stats-YYYY-MM-DD.jsonl
```

Layer 2: SQLite summary cache

```
data/indexes/stats-summary.sqlite
```

Reason:

* JSONL = audit trail
* SQLite = fast KPI aggregation

---

## 6. Event Schema

```js
{
  ts: 1715488234123,
  date: "2026-05-12",
  sessionId: "sess_abc123",
  groupId: "planning",
  level: "L2",
  endpoint: "/api/chat",
  notebookId: "nb_regulation",
  features: {
    rag: true,
    law: false,
    compliance: false,
    kg: false,
    calendar: false,
    documentStudio: false
  },
  model: "gemma3n:e2b",
  latencyMs: 1240,
  tokenEstimate: 912,
  success: true,
  errorType: ""
}
```

---

## 7. Metrics (KPI Layer)

### 7.1 Core KPIs

```
Total Sessions
Total Queries
Active Groups
Average Latency (ms)
```

### 7.2 Strategic KPIs

These define myAI identity.

```
Law Usage Ratio
Compliance Usage Ratio
Studio Conversion Rate
Notebook RAG Usage Ratio
```

### 7.3 Quality Indicators

```
Re-query Rate (same session within 3 minutes)
Error Rate
Future: Notebook Confidence Average
```

---

## 8. API Design

### 8.1 Summary

```
GET /api/admin/stats/summary?range=7d
```

Response:

```js
{
  ok: true,
  kpi: {
    totalSessions: 142,
    totalQueries: 891,
    activeGroups: 3,
    avgLatencyMs: 1240,
    lawUsageRatio: 0.19,
    complianceUsageRatio: 0.08,
    studioConversionRate: 0.05
  }
}
```

---

### 8.2 Groups

```
GET /api/admin/stats/groups?range=7d
```

### 8.3 Notebooks

```
GET /api/admin/stats/notebooks?range=7d
```

### 8.4 Sessions

```
GET /api/admin/stats/sessions?range=7d&page=1&pageSize=50
```

---

## 9. Admin UI Design

Add Admin tab:

```
[통계]
```

Layout:

```
Header: 통계  [기간: 오늘 | 7일 | 30일 | 커스텀]

KPI Cards
- 총 세션
- 총 쿼리
- 활성 그룹
- 평균 응답 ms

Strategic KPIs
- Law 사용률
- Compliance 사용률
- Studio 전환율

Charts
- 그룹별 활동 비중
- 시간대별 쿼리 분포
- 기능 사용 비중

Top Notebooks

Session List
```

Use SVG/Canvas, no heavy external chart library required for MVP.

---

## 10. Privacy Rules

Strictly:

```
No personal user tracking
No IP exposure in Admin UI
No raw prompt logging
No document content logging
```

Log metadata only.

---

## 11. Retention

Add config:

```
STATS_RETENTION_DAYS=90
```

Cleanup job:

* Delete JSONL older than retention
* Delete SQLite summary rows

---

## 12. Acceptance Criteria

MVP complete when:

1. Admin panel shows 통계 tab.
2. KPI summary loads for 7d range.
3. Law usage ratio visible.
4. Compliance usage ratio visible.
5. Studio conversion rate visible.
6. Group activity chart renders.
7. Notebook Top N renders.
8. Session list paginates.
9. No personal user data exposed.
10. Logging does not affect system performance.

---

## 13. Identity Impact

This feature transforms myAI from:

```
Answer generator
```

into:

```
Measurable knowledge operations platform
```

It enables leadership to verify:

* Law grounding adoption
* Compliance workflow usage
* Studio document production
* Department-level adoption
* RAG quality trends

---

If you want, I can next:

* Refactor this into a shorter MVP-only PRD
* Or expand it into a Phase 1–3 roadmap version
* Or produce an implementation-ready task breakdown for AI coding execution
