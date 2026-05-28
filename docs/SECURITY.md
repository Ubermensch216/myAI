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
