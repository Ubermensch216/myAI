# Usage Telemetry and Admin Statistics

This document describes the current usage telemetry implementation behind the Admin Console **통계** dashboard.

The telemetry layer is designed for public-sector / internal-network deployments where myAI does not have individual user accounts. It records group/session-level operational metadata only and intentionally avoids raw prompt, document, IP, and personal-user tracking.

## Scope

The statistics dashboard measures system adoption and operational health across:

- group / level sessions
- chat and department notebook usage
- Korean Law Engine usage
- compliance-review usage
- Studio document usage
- feature adoption ratios
- latency and error trends
- recent sessions

It is not a personal user analytics system.

## Identity Role

The Admin Statistics dashboard acts as a **Knowledge Operations Dashboard**.

It helps answer:

- Which groups are using myAI?
- Which notebooks are actually queried?
- Is Law grounding being used?
- Is Compliance Review being used?
- Are answers being converted into Studio documents?
- Are response latencies or errors increasing?
- Are users re-querying within the same session, suggesting possible answer-quality or RAG-quality issues?

## Authentication Model

myAI currently uses group/level notebook-read access rather than per-user server accounts.

Telemetry therefore records:

```text
groupId
level
sessionId
```

It does not identify a person.

`sessionId` is derived from available request/session material in a privacy-safe way. Raw access tokens are not stored.

## Code Structure

```text
server/stats/
  statsLogger.js       writes privacy-safe JSONL usage events
  statsLogReader.js    reads recent JSONL files and aggregates dashboard data
  statsApi.js          exposes Admin Console statistics endpoints

public/modules/
  adminStats.js        renders the Admin Console statistics dashboard
```

The router is mounted from `server/index.js` under:

```text
/api/admin/stats/*
```

Admin access requires `Authorization: Bearer <ADMIN_TOKEN>`.

## Storage

Raw telemetry is append-only JSONL:

```text
data/logs/usage-YYYY-MM-DD.jsonl
```

Current implementation reads recent JSONL files directly when Admin Stats APIs are requested. This is adequate for MVP and small internal deployments.

Future large deployments should add a daily summary cache, for example:

```text
data/indexes/stats-summary.sqlite
```

or:

```text
data/stats/daily-summary.json
```

## Event Schema

Typical usage event shape:

```js
{
  ts: 1715488234123,
  date: "2026-05-12",
  sessionId: "sess_abc123",
  groupId: "planning",
  level: "L2",
  eventType: "chat_query",
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
  model: "gemma4:e2b",
  latencyMs: 1240,
  success: true,
  errorType: ""
}
```

The exact event payload may vary by endpoint, but it must remain metadata-only.

## Privacy Rules

Telemetry must not store:

```text
raw user prompts
raw assistant answers
uploaded document text
notebook chunk text
IP addresses exposed in Admin UI
raw access tokens
law.go.kr API keys or upstream OC query values
personal names as user identifiers
```

Telemetry may store:

```text
groupId
level
privacy-safe sessionId
eventType
endpoint
notebookId
feature flags
model name
latencyMs
success/error marker
```

## Current Event Coverage

Confirmed from `server/index.js`:

- `chat_query` is logged after `/api/chat` completes.
- `login` is logged on `/api/access/login` success.
- `logout` is logged on `/api/access/logout`.

Additional feature-level events should be checked and expanded as needed:

- `law_query`
- `compliance_run`
- `studio_open`
- `studio_export`
- `kg_render`
- `calendar_query`
- `notebook_access`

The dashboard can still show Law/Compliance usage from chat metadata when those features run inside `/api/chat`, but direct endpoint-specific event coverage is useful for more precise adoption metrics.

## Aggregated Metrics

`server/stats/statsLogReader.js` currently computes:

```text
totalSessions
totalQueries
activeGroups
avgLatencyMs
lawUsageRatio
complianceUsageRatio
studioConversionRate
errorRate
reQueryRate
featureUsage
per-group activity
per-notebook activity
recent sessions
```

### Strategic KPIs

These metrics are especially important for myAI's product identity:

```text
Law Usage Ratio
Compliance Usage Ratio
Studio Conversion Rate
Notebook RAG Usage Ratio
Re-query Rate
```

They show whether myAI is being used merely as a chatbot or as a law-grounded, document-producing, measurable knowledge operations system.

## Admin API

All endpoints require `ADMIN_TOKEN`.

```text
GET /api/admin/stats/summary?range=7d
GET /api/admin/stats/groups?range=7d
GET /api/admin/stats/notebooks?range=7d
GET /api/admin/stats/sessions?range=7d&page=1&pageSize=50
```

`range` uses `<N>d` format and is clamped to 1–365 days.

Session page size is clamped to 1–200.

## Admin UI

The Admin Console has a **통계** tab that renders:

- KPI cards
- strategic KPI bars
- feature usage distribution
- group activity chart
- top notebooks table
- recent session list
- range selector
- refresh action

The implementation uses lightweight DOM/SVG rendering and does not require an external charting library.

## Operational Notes

- The stats layer must be non-critical. Logging or aggregation failure must not block chat, law, RAG, or Studio features.
- JSONL files can grow over time. Add retention cleanup before long-term production use.
- For high-volume deployments, add a daily summary cache rather than scanning many JSONL files on each request.
- Do not reinterpret group-level telemetry as individual-user analytics.

## Recommended Next Improvements

1. Add `STATS_RETENTION_DAYS` and cleanup old JSONL files.
2. Add daily summary caching for faster long-range queries.
3. Add explicit `studio_export` logging inside Studio document export flow.
4. Add direct `law_query` logging for `/api/law/*` routes.
5. Add `kg_render` logging for Studio graph view activity.
6. Add an Admin help tooltip explaining that statistics are group/session-level, not user-level.

## Current Positioning

Usage telemetry makes myAI measurable.

```text
myAI is not just an AI assistant.
It is a group-based, law-grounded, document-producing, measurable knowledge operations system.
```
