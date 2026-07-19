# Security And Deployment Boundary

myAI is designed first for localhost or a trusted internal network. It is not a public internet application by itself.

Recommended production-like shape:

```text
Browser clients
-> HTTPS reverse proxy with authentication and rate limits
-> myAI Node.js server bound to 127.0.0.1 or a private interface
-> Ollama bound to 127.0.0.1 on the same workstation
```

## Trust Model

| Surface | Current behavior | Operational implication |
|---|---|---|
| Chat/upload/visualization/calendar intent | no built-in user login | expose only to localhost, VPN, trusted LAN, or reverse-proxy auth |
| Notebook reads | public until access control is configured; then group/level or Super token | configure access before shared notebook deployment |
| Notebook/admin writes | `ADMIN_TOKEN` | use a long random token |
| Personal rooms/uploads/calendar/settings | browser IndexedDB encrypted with WebCrypto AES-GCM | isolation is by browser key, not server accounts |
| Generated room sources | browser IndexedDB with generated/needs-verification metadata | personal working artifacts unless promotion is approved |
| Studio outputs/source guides | browser IndexedDB | enter notebooks only through admin promotion review |
| Source promotion requests | `data/source-promotions/promotions.json` | server-side review queue |
| File Tools merge/split | client-side only | file content is not uploaded |
| Upload temp files | `uploads/`, deleted after parse | server sees personal files during parsing |
| Runtime document cache | in-memory, scoped by `X-MyAI-Document-Key` | not durable and not listable |
| Korean Law Engine | server-side calls to official APIs | keep API keys server-side |
| Ollama | server-side local HTTP API | keep port `11434` private |

## Network Modes

### Single-user local

```env
HOST=127.0.0.1
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
```

Open `http://127.0.0.1:3000` or `http://localhost:3000`.

### Trusted LAN

```env
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
ADMIN_TOKEN=<long-random-token>
```

Bind `HOST` only as broadly as needed. Use HTTPS for remote browsers because WebCrypto may be blocked on plain `http://<lan-ip>`.

### Production-like shared

```env
HOST=127.0.0.1
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
ADMIN_TOKEN=<long-random-token>
TRUST_PROXY=true
```

The reverse proxy should provide TLS, user authentication, request rate limits, body-size limits, streaming-safe proxy settings for `/api/chat`, and body-free operational access logs.

## Reverse Proxy Notes

Nginx sketch:

```nginx
limit_req_zone $binary_remote_addr zone=myai_per_ip:10m rate=30r/m;

server {
  listen 443 ssl http2;
  server_name myai.example.internal;

  ssl_certificate     /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;
  client_max_body_size 80m;

  location / {
    limit_req zone=myai_per_ip burst=20 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }

  location /api/chat {
    limit_req zone=myai_per_ip burst=10 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Caddy sketch:

```caddyfile
myai.example.internal {
  encode zstd gzip

  request_body {
    max_size 80MB
  }

  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
```

Add your organization SSO, VPN, `forward_auth`, or basic auth before traffic reaches Node.js.

## Size Limits

| Variable | Default | Applies to |
|---|---:|---|
| `MAX_JSON_BYTES` | `80mb` | JSON bodies |
| `MAX_UPLOAD_BYTES` | `41943040` | multipart uploads |
| `DOCUMENT_CACHE_TTL_MS` | `21600000` | runtime document cache |
| `DOCUMENT_CACHE_MAX_ENTRIES` | `256` | runtime document cache count |
| `GENERATED_SOURCE_MAX_CHARS` | `180000` | answer-as-source input |
| `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES` | `750000` | generated binary inline cap |
| `SOURCE_GUIDE_INPUT_MAX_CHARS` | `36000` | source-guide input budget |
| `SOURCE_PROMOTION_MAX_CHARS` | `180000` | promotion markdown cap |
| `STUDIO_DOCUMENT_ANSWER_MAX_CHARS` | `120000` | answer-to-document input |
| `EXPORT_MAX_CHARS` | `180000` | export/document text cap |
| `IMAGE_MAX_WIDTH` / `IMAGE_MAX_HEIGHT` | `1024` | output image resolution limit |
| `IMAGE_MAX_BATCH` | `4` | output image batch limit |
| `IMAGE_DAILY_LIMIT_PER_USER` | `50` | user daily image quota |

Keep reverse-proxy limits equal to or lower than app limits.

## Rate Limiting

The app includes an in-process fixed-window limiter. It is a safety net, not a substitute for proxy/network limits.

```env
RATE_LIMIT_CHAT_PER_MINUTE=20
RATE_LIMIT_VISUALIZE_PER_MINUTE=10
RATE_LIMIT_UPLOAD_PER_MINUTE=8
RATE_LIMIT_LIGHTWEIGHT_PER_MINUTE=30
RATE_LIMIT_ADMIN_WRITE_PER_MINUTE=10
```

*Note: `/api/image/generate` shares the chat rate limit configuration (`RATE_LIMIT_CHAT_PER_MINUTE`).*

When behind a trusted proxy:

```env
TRUST_PROXY=true
RATE_LIMIT_KEY_HEADER=x-forwarded-user
```

Only use `RATE_LIMIT_KEY_HEADER` when the proxy injects and protects that header.

## Admin Token

Generate:

```bash
openssl rand -hex 32
```

Set:

```env
ADMIN_TOKEN=<generated-value>
```

`ADMIN_TOKEN` protects management APIs. It is not a chat login and not a notebook-read identity.

## Notebook Access Control

Configured through Settings -> Admin Console -> Access Management.

- Group Management creates groups and Level 1-3 passwords.
- Level 1 is highest privilege, then Level 2, then Level 3.
- Super Access is a separate emergency/operator read credential.
- Existing Super password changes require the current Super password and matching confirmation.
- Access is inactive until at least one enabled group level password or enabled Super password exists.
- Active access requires `Authorization: Bearer <access token>` from `/api/access/login`.
- `ACCESS_TOKEN_SECRET` should be set explicitly for multi-instance deployments.
- `ACCESS_TOKEN_TTL_SECONDS` defaults to 12 hours.

## Document Security (문서보안) Module

`public/modules/safeDoc/` detects and de-identifies personal information inside uploaded documents
(TXT/CSV/XLSX/DOCX/HWPX/text PDF).

**Processing is client-only.** The module never uploads the document. It reads the file with
`File.arrayBuffer()`, parses, detects, and rewrites entirely in the browser, then hands the result back
through `URL.createObjectURL`. Nothing reaches `/api/upload` or any other endpoint.

The upstream project enforced this with a CSP of `connect-src 'none'`. myAI sets no CSP, so the guarantee
is enforced instead by a static check in `scripts/safedoc-test.mjs`, which fails the build if any file
under `public/modules/safeDoc/` contains `fetch(`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`,
`localStorage`, or `sessionStorage`. Do not weaken that check.

### What is and is not persisted

| Data | Persisted? |
| --- | --- |
| Per-type default action (`typePolicies`) | Yes — encrypted IndexedDB, via `serializeSafeDocState()` |
| User-defined regex rules | **No** — session only. Regexes are a ReDoS vector (FR-803) |
| `WorkSession` (source file bytes, extracted text, candidates, mapping table, result blob) | **No** — module-scope only, never assigned to `state`, so `saveAppState()` cannot reach it |

`disposeSafeDoc()` runs when the user leaves the view and on `beforeunload`, releasing the session. Stored
policies are re-validated through `normalizeTypePolicies()` on load, so a corrupted or downgraded record
cannot inject unknown types or actions.

### Mapping table exports personal data in cleartext

The mapping table JSON contains the **original personal information in plaintext** — that is what makes
restore possible. This conflicts with the upstream specification (FR-510, FR-703), which prohibits both
restore and mapping-table storage. The feature is retained deliberately, with these controls:

- Download is gated behind an explicit `showConfirmDialog({ danger: true })` naming the risk.
- The result screen warns that the mapping table must be stored apart from the result file.
- The result file itself never contains the originals.

Treat an exported mapping table as equivalent to the original document for classification and retention.

### Known limitations

- **PDF masking coordinates are approximate.** Rectangles are sized by string-length proportion rather
  than glyph metrics, so on proportional fonts they can drift. Padding is widened to over-cover, and the
  result screen tells the user to verify visually. Do not treat PDF output as verified without inspection.
- Regex rules run on the main thread. Nested quantifiers and patterns over 200 characters are rejected at
  registration, and a 3-second budget disables offending rules at analysis time. Worker isolation is not
  yet implemented.
- Shapes, comments, and document properties in Office/HWPX files are not scanned.

## Deployment Checklist

- Bind Ollama to `127.0.0.1`.
- Use HTTPS for remote browsers.
- Set `ADMIN_TOKEN` for any shared deployment.
- Configure notebook read access before exposing department notebooks.
- Add reverse-proxy authentication before `/` and `/api/*`.
- Disable proxy buffering for `/api/chat`.
- Align body limits.
- Configure rate limits.
- Back up `data/notebooks/` and operational logs as needed.
- Document that browser data is local-only and lost if the browser profile is cleared.

## Not Provided

- Built-in per-user accounts.
- Server-side personal-data sync.
- Full admin audit log.
- External calendar account sync.
- Public internet hardening without a reverse proxy or platform layer.
