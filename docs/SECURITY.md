# Security And Deployment Boundary

myAI is designed first as a local or trusted-network assistant. It is not a public internet application by itself.

The safest production-like shape is:

```text
Browser clients
-> HTTPS reverse proxy with authentication and rate limits
-> myAI Node.js server bound to 127.0.0.1 or a private interface
-> Ollama bound to 127.0.0.1 on the same workstation
```

## Trust Model

| Surface | Current behavior | Operational implication |
|---|---|---|
| Chat, upload, visualization, calendar intent | No built-in user login | Only expose to localhost, VPN, or a trusted LAN unless a reverse proxy adds auth. |
| Notebook reads | Public until Department Notebook Access Control is configured; then requires group/level or Super access token | Existing local installs keep working, while shared deployments can restrict notebook visibility and RAG by policy. |
| Notebook writes/admin actions | Protected by `ADMIN_TOKEN` | Use a long random token. Admin manages groups/passwords/policies but is not itself a notebook-read identity for chat. |
| Personal rooms, uploads, calendar, settings | Encrypted in each browser IndexedDB | Isolation is by browser key, not by server-side accounts. Clearing browser storage deletes the data. |
| AI-generated room sources | Stored with the room in encrypted browser IndexedDB after `/api/source-workflow/from-answer` conversion | Treat as personal working artifacts. They are marked generated / needs verification and are not official or department-approved sources. |
| File Tools (Merge/Split) | Entirely client-side (browser) | No file content or metadata is sent to the server. Maximum privacy for sensitive documents. |
| Upload temp files | Written under `uploads/`, then removed after parse | The server sees personal files during parsing. Keep the host and temp directory private. |
| Runtime upload cache | In-memory, scoped by `X-MyAI-Document-Key`, TTL/LRU bounded | Convenience hydration cache only; not listable and not durable. |
| Korean Law Engine | Server-side calls to law.go.kr when explicit legal prompts or `/api/law/*` routes are used | `LAW_OC` stays server-side; only normalized law names/article refs are sent upstream, not full prompts. |
| Ollama | Server-side local HTTP API | Keep Ollama on `127.0.0.1`; do not expose port `11434` directly. |

## Recommended Network Modes

### Single-user local mode

Use the defaults:

```env
HOST=127.0.0.1
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
```

Open `http://127.0.0.1:3000` on the same machine.

### Department trusted-LAN mode

This is acceptable when the workstation is reachable only by trusted personal PCs on a private network.

```env
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
ADMIN_TOKEN=<long-random-token>
```

Bind `HOST` only as broadly as the network policy requires. If the host has more than one network interface, prefer a private interface over all interfaces.

### Production-like shared mode

Bind the app behind a reverse proxy:

```env
HOST=127.0.0.1
PORT=3000
OLLAMA_URL=http://127.0.0.1:11434
ADMIN_TOKEN=<long-random-token>
MAX_JSON_BYTES=80mb
MAX_UPLOAD_BYTES=41943040
```

The reverse proxy should provide:

- TLS termination.
- User authentication before any `/api/*` route reaches Node.js.
- Request rate limits for chat, upload, visualization, follow-ups, calendar intent, and notebook admin routes.
- Body-size limits aligned with `MAX_JSON_BYTES` and `MAX_UPLOAD_BYTES`.
- Streaming proxy settings that do not buffer `/api/chat`.
- Access logs suitable for operational debugging, without logging request bodies.

## Reverse Proxy Notes

### Nginx sketch

```nginx
limit_req_zone $binary_remote_addr zone=myai_per_ip:10m rate=30r/m;

server {
  listen 443 ssl http2;
  server_name myai.example.internal;

  ssl_certificate     /path/to/fullchain.pem;
  ssl_certificate_key /path/to/privkey.pem;

  client_max_body_size 80m;

  # Add SSO, auth_request, or basic auth here.

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

### Caddy sketch

```caddyfile
myai.example.internal {
  encode zstd gzip

  # Add forward_auth, basic_auth, or your SSO plugin here.

  request_body {
    max_size 80MB
  }

  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
```

Use your organization's normal authentication layer where possible. Basic auth is better than no auth, but SSO or VPN-backed access is preferable for shared department deployments.

## Size Limits

The server has two direct limits:

| Variable | Default | Applies to |
|---|---:|---|
| `MAX_JSON_BYTES` | `80mb` | JSON bodies such as `/api/chat`, `/api/visualize`, `/api/followups`, and `/api/agent/intent` |
| `MAX_UPLOAD_BYTES` | `41943040` | Single multipart upload handled by `/api/upload` and notebook document upload |
| `DOCUMENT_CACHE_TTL_MS` | `21600000` | Same-browser runtime cache for recently uploaded personal documents |
| `DOCUMENT_CACHE_MAX_ENTRIES` | `256` | Max in-memory personal document cache entries |
| `GENERATED_SOURCE_MAX_CHARS` | `180000` | Max assistant-answer text accepted by source workflow conversion |
| `GENERATED_SOURCE_BINARY_INLINE_MAX_BYTES` | `750000` | Max generated binary payload returned inline as base64 |

The browser also preflights large personal chat payloads:

- Warns before large file uploads.
- Shows compact room material status and detailed active materials in the composer material panel.
- Offers active-room attachment cleanup from the composer material panel.
- Blocks `/api/chat` before the request gets too close to the server JSON body limit.

Generated sources created from assistant answers are included in later chat
requests as document context. They are deliberately labeled as secondary
references in the prompt and UI to avoid confusing AI-generated working notes
with original uploads, official law evidence, or approved department notebook
content.

Keep proxy body limits equal to or lower than the server limits. If the proxy allows larger bodies than Node.js, users will see late server failures. If the proxy limit is lower, document that limit in the deployment runbook.

## Rate Limiting

myAI includes a small in-process fixed-window limiter for model-calling routes.
It is a local safety net, not a replacement for reverse-proxy or network-layer
limits. Add proxy limits before exposing it to more than a small trusted group.

Suggested starting points:

| Route family | Suggested limit | Why |
|---|---:|---|
| `/api/chat` | 10-30 requests/minute per user or IP | Streams can hold GPU work for a long time. |
| `/api/visualize` | 10 requests/minute per user or IP | LLM plan/repair/interpretation can make multiple model calls. |
| `/api/upload` | 5-10 uploads/minute per user or IP | Parsing and document analysis can be expensive. |
| `/api/notebooks/*` admin writes | 5-10 writes/minute per admin | Prevent accidental bulk ingest loops. |
| `/api/agent/intent`, `/api/followups` | 30 requests/minute per user or IP | Lightweight, but still calls Ollama. |

Tune these based on GPU capacity and the expected number of department users.

Server-side defaults can be adjusted with:

```env
RATE_LIMIT_CHAT_PER_MINUTE=20
RATE_LIMIT_VISUALIZE_PER_MINUTE=10
RATE_LIMIT_UPLOAD_PER_MINUTE=8
RATE_LIMIT_LIGHTWEIGHT_PER_MINUTE=30
RATE_LIMIT_ADMIN_WRITE_PER_MINUTE=10
```

When running behind a trusted reverse proxy, enable Express proxy IP handling so
the in-process limiter keys by the real client address instead of the proxy:

```env
TRUST_PROXY=true
```

Only set this when the proxy overwrites `X-Forwarded-*` headers from clients.
If the proxy adds a verified user identity header, such as `X-Forwarded-User`,
you can key limits by that header:

```env
RATE_LIMIT_KEY_HEADER=x-forwarded-user
```

## Admin Token Guidance

Generate a long random token:

```bash
openssl rand -hex 32
```

Set it only on the server:

```env
ADMIN_TOKEN=<generated-value>
```

The token only protects notebook management routes. It does not add login to chat, uploads, notebook reads, calendar intent, or visualization. Use reverse-proxy auth for those.

## Department Notebook Access Control

Department notebook read access is configured in the browser UI through
Settings → Admin Console → Access Management. Admins authenticate with
`ADMIN_TOKEN`, then create access groups, set Level 1-3 passwords, optionally
set a Super read-access password, and assign notebook policies from Department
Notebook Management.

Access Management separates Group Management from Super Access. Group
Management is for routine reader groups and Level 1-3 passwords; Level 1 is
highlighted in the UI because it can satisfy every notebook policy that allows
the group. Level 2 can read notebooks requiring Level 2 or 3; Level 3 can read
only Level 3 notebooks. Super Access is isolated behind its own tab and should
be treated as emergency or operator-level read access. When a Super password
already exists, changing it requires the current Super password and a
double-entered new password; the API never returns existing password values.

Access control is inactive until at least one enabled group level password or
an enabled Super password exists. While inactive, notebook reads remain public
for compatibility. Once active, `/api/notebooks`, `/api/notebooks/:id`, and
chat or Precision Analysis / Map-Reduce requests that include `notebookId` require
`Authorization: Bearer <access token>` from `/api/access/login`.

`ADMIN_TOKEN` is intentionally not accepted as a notebook-read credential for
normal chat. Keep it as a management secret and distribute separate group/level
or Super passwords to readers.

Access tokens are stateless signed bearer tokens. By default the signing secret
is generated under `data/access/access-token-secret`; set `ACCESS_TOKEN_SECRET`
explicitly if multiple app instances must validate the same tokens. Token
lifetime defaults to 12 hours and can be adjusted with
`ACCESS_TOKEN_TTL_SECONDS`.

## Deployment Checklist

- `HOST=127.0.0.1` when behind a reverse proxy.
- `OLLAMA_URL=http://127.0.0.1:11434`; do not expose Ollama directly.
- `ADMIN_TOKEN` set for any shared notebook deployment.
- Department notebook access groups/passwords configured when notebook reads should be restricted.
- Reverse proxy terminates TLS.
- Reverse proxy enforces user auth before `/` and `/api/*`.
- Proxy body limits match `MAX_JSON_BYTES` / `MAX_UPLOAD_BYTES`.
- Proxy buffering disabled for `/api/chat`.
- Rate limits configured for model-calling routes.
- `uploads/` is not web-served and is cleaned after parse failures.
- Back up `data/notebooks/` if department notebooks are operationally important.
- Document that personal browser data is local-only and lost if the browser profile is cleared.

## What This App Does Not Yet Provide

- No built-in per-user accounts or server-side sessions.
- No per-user role database; notebook read access is group/level password based with optional Super access.
- No audit log for admin operations.
- No built-in CSRF/session protection because there is no cookie login model.
- No external calendar synchronization or account isolation.

If those are required, put myAI behind an existing internal platform that already provides identity, access policy, TLS, logging, and rate limiting.
