# Linux Deployment Guide

대상: Ubuntu 22.04/24.04 LTS, Debian 12. 다른 systemd 기반 배포판도 거의 동일.

## 0. 핵심 전제

- **HTTPS는 선택이 아닙니다.** 프론트엔드는 `WebCrypto AES-GCM`으로 IndexedDB를 암호화합니다. `crypto.subtle`은 보안 컨텍스트(`https://` 또는 `http://localhost`)에서만 동작하므로, 외부에서 평문 HTTP로 접속하면 저장이 실패합니다.
- **Ollama가 LLM 자체를 실행**합니다. CPU 전용에서도 동작은 하지만 응답이 매우 느립니다. 실서비스라면 NVIDIA GPU를 권장합니다(설치 스크립트가 자동 감지).
- 모든 사용자 데이터는 **각자의 브라우저 IndexedDB**에 저장됩니다. 서버는 모델 호출, 파일 파싱, 정적 파일 서빙만 합니다.

## 1. 시스템 패키지

```bash
sudo apt update
sudo apt install -y curl ca-certificates git ufw
```

## 2. Node.js 20

NodeSource 저장소가 가장 단순:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # v20.x 확인
```

## 3. Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
ollama pull gemma3n:e2b   # 기본 모델 (또는 사용할 모델)
ollama pull bge-m3        # 부서 RAG 임베딩 모델
```

## 3a. 부서 RAG 외부 서비스 (Qdrant)

부서 노트북 기능을 사용하지 않는다면 이 단계를 건너뛰고 `.env`에서 `DEPARTMENT_VECTOR_BACKEND=memory`로 설정하세요.

### Docker 설치

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # 재로그인 필요
```

### Qdrant 실행

```bash
cd /opt/myai

# API 키를 환경변수로 전달하거나 프로젝트 루트 .env 파일에 기재
export QDRANT_API_KEY="$(openssl rand -hex 32)"

docker compose -f deploy/docker-compose.department.yml up -d
docker compose -f deploy/docker-compose.department.yml ps   # healthy 확인
```

같은 API 키를 `/etc/myai.env`의 `QDRANT_API_KEY`에도 설정하세요.

### 데이터 디렉터리

Qdrant 스토리지와 SQLite FTS 인덱스는 아래 경로에 자동 생성됩니다:

```
/opt/myai/data/qdrant/storage/    ← Qdrant 벡터 스토리지
/opt/myai/data/qdrant/snapshots/  ← Qdrant 스냅샷
/opt/myai/data/indexes/           ← SQLite FTS5 인덱스 (자동 생성)
/opt/myai/data/logs/              ← 리트리벌 로그 JSONL
```

```bash
sudo -u myai mkdir -p /opt/myai/data/qdrant/storage \
                      /opt/myai/data/qdrant/snapshots \
                      /opt/myai/data/indexes \
                      /opt/myai/data/logs
```

### Qdrant 자동 시작 등록

```bash
sudo tee /etc/systemd/system/myai-qdrant.service > /dev/null << 'EOF'
[Unit]
Description=myAI Qdrant vector store
After=docker.service network-online.target
Requires=docker.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/myai
ExecStart=docker compose -f deploy/docker-compose.department.yml up
ExecStop=docker compose -f deploy/docker-compose.department.yml down
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now myai-qdrant.service
```

## 4. 전용 사용자와 코드 배치

```bash
sudo useradd --system --home /opt/myai --shell /usr/sbin/nologin myai
sudo mkdir -p /opt/myai
sudo chown myai:myai /opt/myai

sudo -u myai git clone https://github.com/Ubermensch216/myAI.git /opt/myai
cd /opt/myai
sudo -u myai npm ci --omit=dev
sudo -u myai mkdir -p /opt/myai/uploads /opt/myai/data/notebooks
```

## 5. 환경변수 파일

```bash
sudo cp deploy/myai.env.example /etc/myai.env
sudo chown root:myai /etc/myai.env
sudo chmod 0640 /etc/myai.env
sudo nano /etc/myai.env   # PORT/HOST/OLLAMA_MODEL 등 조정
```

`HOST=127.0.0.1`로 두면 앱은 외부 인터페이스에 노출되지 않고 리버스 프록시 뒤에서만 도달 가능합니다.

## 6. systemd 서비스 등록

```bash
sudo cp deploy/myai.service /etc/systemd/system/myai.service
sudo systemctl daemon-reload
sudo systemctl enable --now myai.service
sudo systemctl status myai.service
journalctl -u myai -f          # 실시간 로그
```

서비스 유닛은 `ProtectSystem=strict`, `NoNewPrivileges`, 메모리/시스템콜 제한 등 기본 샌드박싱이 적용되어 있습니다. `uploads/`와 부서노트북 저장소인 `data/`만 쓰기 허용.

## 7. 리버스 프록시 + TLS

DNS A/AAAA 레코드를 미리 서버 IP로 맞춰 주세요. 둘 중 하나를 선택:

### 옵션 A: Caddy (권장 — TLS 자동)

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile   # myai.example.com을 실제 도메인으로 교체
sudo systemctl reload caddy
```

Let's Encrypt 인증서가 자동 발급/갱신됩니다.

### 옵션 B: nginx + certbot

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
sudo cp deploy/nginx.conf.example /etc/nginx/sites-available/myai
sudo ln -s /etc/nginx/sites-available/myai /etc/nginx/sites-enabled/myai
sudo nano /etc/nginx/sites-available/myai   # myai.example.com 교체
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d myai.example.com
```

certbot이 vhost에 인증서 경로를 자동 삽입하고 `/etc/cron.d/certbot`로 자동 갱신을 등록합니다.

## 8. 방화벽

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

앱이 `HOST=127.0.0.1`로 묶여 있다면 3000은 외부에서 닿을 수 없으므로 따로 막을 필요는 없습니다.

## 9. 인증 (선택)

이 앱은 자체 로그인 기능이 없습니다. 사내망/VPN이 아니라면 프록시 단에서 인증을 추가하세요.

- Caddy 기본: `basicauth`(주석 처리된 예가 `Caddyfile`에 있음)
- nginx 기본: `auth_basic` + `htpasswd`
- SSO가 필요하면 [oauth2-proxy](https://github.com/oauth2-proxy/oauth2-proxy) 또는 [authelia](https://www.authelia.com/) 같은 게이트를 앞단에 두세요.

## 10. 업그레이드

```bash
cd /opt/myai
sudo -u myai git pull
sudo -u myai npm ci --omit=dev
sudo systemctl restart myai
```

## 11. 백업

서버에는 영속 데이터가 거의 없습니다. 챙길 것:

- `/etc/myai.env` — 운영 설정
- `/opt/myai/data/notebooks/` — 부서노트북 manifest와 파싱된 문서 청크
- `/opt/myai/data/qdrant/storage/` — Qdrant 벡터 인덱스 (부서 RAG 사용 시)
- `/opt/myai/data/indexes/department-rag.sqlite` — SQLite FTS5 인덱스 (부서 RAG 사용 시)
- `/etc/caddy/Caddyfile` 또는 `/etc/nginx/sites-available/myai` — 프록시 설정
- `/var/lib/caddy/.local/share/caddy/` (Caddy ACME 데이터) 또는 `/etc/letsencrypt/` (certbot)

`data/notebooks/`, `data/indexes/`, Qdrant 스냅샷을 한 번에 백업하려면 내장 스크립트를 사용하세요:

```bash
cd /opt/myai
sudo -u myai npm run rag:backup                  # backups/ 디렉터리에 타임스탬프 백업 생성
sudo -u myai npm run rag:restore -- <backup-dir> # 백업에서 복구 (확인 프롬프트 있음)
```

Qdrant 벡터 인덱스와 SQLite FTS 인덱스는 노트북 재인제스트로 재생성할 수 있으므로, 원본 문서(`data/notebooks/`)만 있으면 복구 가능합니다. 복구 후 인덱스를 재구축하려면:

```bash
sudo -u myai npm run rag:rebuild
```

사용자 대화/룸 첨부파일은 각 사용자 브라우저에만 있으므로 서버 백업으로는 복구되지 않습니다.

## 12. 트러블슈팅

| 증상 | 원인/해결 |
|---|---|
| `crypto.subtle is undefined` 또는 IndexedDB 저장 실패 | HTTPS가 아니거나 `localhost`가 아닌 호스트로 접속. TLS 종단 확인. |
| 응답이 한 번에 와르르 떨어짐 | nginx에서 `proxy_buffering off` 누락. Caddy면 `flush_interval -1`. |
| 큰 파일 업로드 시 `413` | 프록시의 `client_max_body_size` / Caddy `request_body max_size`와 앱의 `MAX_UPLOAD_BYTES` 불일치. |
| 답변 도중 502/504 | 프록시 read timeout이 짧음. 1h 권장. Ollama가 모델 로딩 중일 수도 있음 — `journalctl -u ollama -f`로 확인. |
| `HOST=127.0.0.1`인데 외부에서 닿음 | 리버스 프록시가 `proxy_pass http://127.0.0.1:3000` 으로 잡혀 있는지, ufw가 활성화돼 있는지 확인. |
| 노트북 인제스트 후 검색이 항상 빈 결과 | `bge-m3` 모델 미설치(`ollama pull bge-m3`) 또는 Qdrant 미실행. `/api/status`에서 `rag.department.qdrant` 상태 확인. |
| `/api/status`에서 `qdrant: { ok: false }` | Qdrant 컨테이너가 실행 중인지 확인: `docker compose -f deploy/docker-compose.department.yml ps`. API 키 불일치도 원인이 될 수 있음. |
| 인제스트 작업이 `failed` 상태로 멈춤 | `journalctl -u myai -f`로 에러 확인. 임베딩 dim 불일치(`EMBED_DIM`)나 Qdrant 연결 오류가 가장 흔한 원인. |
