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
| Notebook reads | Public to anyone who can reach the server | Department notebooks are shared knowledge, not private per-user data. |
| Notebook writes/admin actions | Protected by `ADMIN_TOKEN` | Use a long random token. Keep it out of screenshots, docs, and shell history. |
| Personal rooms, uploads, calendar, settings | Encrypted in each browser IndexedDB | Isolation is by browser key, not by server-side accounts. Clearing browser storage deletes the data. |
| Upload temp files | Written under `uploads/`, then removed after parse | The server sees personal files during parsing. Keep the host and temp directory private. |
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

The browser also preflights large personal chat payloads:

- Warns before large file uploads.
- Shows approximate room and attachment storage.
- Offers active-room attachment cleanup.
- Blocks `/api/chat` before the request gets too close to the server JSON body limit.

Keep proxy body limits equal to or lower than the server limits. If the proxy allows larger bodies than Node.js, users will see late server failures. If the proxy limit is lower, document that limit in the deployment runbook.

## Rate Limiting

myAI currently relies on the reverse proxy or network layer for rate limiting. Add limits before exposing it to more than a small trusted group.

Suggested starting points:

| Route family | Suggested limit | Why |
|---|---:|---|
| `/api/chat` | 10-30 requests/minute per user or IP | Streams can hold GPU work for a long time. |
| `/api/visualize` | 10 requests/minute per user or IP | LLM plan/repair/interpretation can make multiple model calls. |
| `/api/upload` | 5-10 uploads/minute per user or IP | Parsing and document analysis can be expensive. |
| `/api/notebooks/*` admin writes | 5-10 writes/minute per admin | Prevent accidental bulk ingest loops. |
| `/api/agent/intent`, `/api/followups` | 30 requests/minute per user or IP | Lightweight, but still calls Ollama. |

Tune these based on GPU capacity and the expected number of department users.

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

## Deployment Checklist

- `HOST=127.0.0.1` when behind a reverse proxy.
- `OLLAMA_URL=http://127.0.0.1:11434`; do not expose Ollama directly.
- `ADMIN_TOKEN` set for any shared notebook deployment.
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
- No role-based permissions for notebook reads.
- No audit log for admin operations.
- No built-in CSRF/session protection because there is no cookie login model.
- No built-in rate limiter.
- No external calendar synchronization or account isolation.

If those are required, put myAI behind an existing internal platform that already provides identity, access policy, TLS, logging, and rate limiting.
