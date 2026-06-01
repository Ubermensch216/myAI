# Usage Telemetry And Admin Statistics

Usage telemetry backs the Admin Console statistics dashboard. It is designed for internal deployments without per-user server accounts and records metadata only.

## Purpose

The dashboard helps answer:

- Which groups are using myAI?
- Which notebooks are queried?
- Are law, compliance, Studio, graph, and RAG features being used?
- Are latencies or errors increasing?
- Are sessions producing repeated queries that may indicate retrieval or answer-quality issues?

It is not a personal user analytics system.

## Code Structure

```text
server/stats/statsLogger.js     writes privacy-safe JSONL events
server/stats/statsLogReader.js  aggregates recent JSONL files
server/stats/statsApi.js        exposes Admin Stats endpoints
public/modules/adminStats.js    renders the Admin Console dashboard
```

Router mount:

```text
/api/admin/stats/*
```

Admin access requires `Authorization: Bearer <ADMIN_TOKEN>`.

## Storage

```text
data/logs/usage-YYYY-MM-DD.jsonl
```

The current reader scans recent JSONL files directly. High-volume deployments should add a daily summary cache.

Telemetry can be disabled with:

```env
USAGE_LOG_ENABLED=false
```

## Event Shape

Typical event:

```js
{
  ts: 1770000000000,
  date: "2026-05-28",
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

Exact fields can vary by event type, but events must remain metadata-only.

## Privacy Rules

Do not store:

- raw prompts
- assistant answers
- uploaded document text
- notebook chunk text
- IP addresses in the Admin UI
- raw access tokens
- API keys or upstream query secrets
- personal names as user identifiers

Allowed:

- group id and level
- privacy-safe session id
- event type and endpoint
- notebook id
- feature flags
- model name
- latency
- success/error marker

## Current Coverage

Confirmed server-side event types include:

- `chat_query`
- `login`
- `logout`
- `image_generate` (logged when requesting image generation)

Stats aggregation can infer feature usage from chat metadata for RAG, law, compliance, and related features. Additional explicit events can be added for Studio export, graph render, direct law route usage, and calendar use without changing the privacy model.

## Admin API

```text
GET /api/admin/stats/summary?range=7d
GET /api/admin/stats/groups?range=7d
GET /api/admin/stats/notebooks?range=7d
GET /api/admin/stats/knowledge-packs?range=7d
GET /api/admin/stats/sessions?range=7d&page=1&pageSize=50
```

`range` accepts `<N>d` and is clamped by the server. `pageSize` is clamped server-side.

## Aggregates

`server/stats/statsLogReader.js` computes KPI and table data such as:

- total sessions
- total queries
- active groups
- average latency
- law usage
- compliance usage
- Studio conversion/export signals when logged
- error rate
- feature usage distribution
- per-group activity
- per-notebook activity
- recent sessions
- knowledge-pack activity endpoint data

## Operational Notes

- Logging failures must not block chat, law, RAG, or Studio flows.
- JSONL files can grow; add retention cleanup for long-running deployments.
- For high-volume installations, add daily summary caching instead of scanning many files per request.
- Do not reinterpret group/session telemetry as individual-user analytics.
