# myAI 시스템 시작 절차

이 문서는 myAI를 로컬 또는 부서 워크스테이션에서 시작하는 절차를 OS별로 정리한다. myAI는 Node.js/Express 앱 서버, Ollama 모델 서버, 선택 사항인 Qdrant 벡터 DB, 브라우저 IndexedDB 저장소가 함께 동작한다.

## 공통 구성 요소

- 앱 서버: `http://localhost:3000`
- Ollama API: `http://127.0.0.1:11434`
- Qdrant API: `http://127.0.0.1:6333`
- 권장 채팅 모델: `gemma4:e2b`
- 권장 임베딩 모델: `bge-m3`
- 권장 임베딩 차원: `1024`

기본 시작 순서는 다음과 같다.

1. Ollama를 실행한다.
2. 필요한 모델이 설치되어 있는지 확인한다.
3. Qdrant를 사용하는 경우 Qdrant 컨테이너를 실행한다.
4. RAG 인덱스 상태를 확인하거나 재빌드한다.
5. myAI 앱 서버를 시작한다.
6. 브라우저에서 `http://localhost:3000`을 연다.

## Windows 시작 절차

### 1. 사전 요구 사항 확인

PowerShell을 열고 프로젝트 폴더로 이동한다.

```powershell
cd C:\Dev\myAI
```

Node.js, npm, Ollama가 설치되어 있는지 확인한다.

```powershell
node --version
npm --version
ollama --version
```

Node.js는 24 이상을 권장한다. SQLite FTS5 백엔드는 Node.js의 `node:sqlite`를 사용하므로 Node.js 24에서 가장 잘 맞는다.

### 2. Ollama 실행 및 모델 확인

Ollama Desktop 또는 Ollama 서비스를 먼저 실행한다. 실행 여부는 다음 명령으로 확인한다.

```powershell
curl.exe -s http://127.0.0.1:11434/api/tags
```

필요한 모델이 없다면 설치한다.

```powershell
ollama pull gemma4:e2b
ollama pull bge-m3
```

`.env`에는 최소한 다음 값이 들어 있어야 한다.

```env
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

### 3. 의존성 설치

처음 실행하거나 `package-lock.json`이 바뀐 뒤에는 의존성을 설치한다.

```powershell
npm.cmd install
```

깨끗한 재설치를 원하는 배포 환경에서는 다음을 사용할 수 있다.

```powershell
npm.cmd ci
```

### 4. Qdrant 벡터 DB 시작

부서 노트북 RAG를 Qdrant로 사용할 경우 Docker Desktop이 실행 중이어야 한다. 먼저 Docker가 동작하는지 확인한다.

```powershell
docker --version
docker compose version
docker info
```

설치 직후 현재 PowerShell에서 `docker`가 인식되지 않으면 새 PowerShell을 열거나 다음 전체 경로를 사용한다.

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" --version
```

Qdrant를 실행한다.

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env up -d
```

전체 경로를 써야 하는 환경에서는 다음처럼 실행한다.

```powershell
& "C:\Program Files\Docker\Docker\resources\bin\docker.exe" compose -f deploy/docker-compose.department.yml --env-file .env up -d
```

상태를 확인한다.

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env ps
curl.exe -s http://127.0.0.1:6333/healthz
```

`.env`에서 Qdrant를 사용할 때 권장 값은 다음과 같다.

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
DEPARTMENT_LEXICAL_BACKEND=sqlite
QDRANT_URL=http://127.0.0.1:6333
QDRANT_API_KEY=<server-only-token>
QDRANT_COLLECTION=myai_notebook_chunks
QDRANT_VECTOR_NAME=dense_bge_m3
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
```

Qdrant를 쓰지 않는 단순 로컬 실행이면 다음처럼 JSON/메모리 백엔드로 둘 수 있다.

```env
DEPARTMENT_VECTOR_BACKEND=json
DEPARTMENT_LEXICAL_BACKEND=memory
```

### 5. RAG 인덱스 확인 및 재빌드

Qdrant 또는 SQLite FTS를 사용하는 경우 앱 서버 시작 전 인덱스를 확인한다.

```powershell
npm.cmd run rag:check
```

`collection_not_found`, `mismatch`, 청크 수 불일치가 나오면 재빌드한다.

```powershell
npm.cmd run rag:rebuild
```

정상 상태 예시는 다음과 같다.

```text
"ok": true
"qdrant": { "ok": true, "status": "green" }
"sqlite": { "ok": true }
```

Node.js 24에서 SQLite 관련 `ExperimentalWarning`이 나올 수 있다. `rag:check`의 `"ok": true`라면 시작을 막는 오류는 아니다.

### 6. myAI 앱 서버 시작

일반 실행:

```powershell
npm.cmd start
```

개발 중 파일 변경 감시 실행:

```powershell
npm.cmd run dev
```

로그 파일로 남기며 실행:

```powershell
npm.cmd run start:log
```

앱이 정상적으로 뜨면 브라우저에서 연다.

```text
http://localhost:3000
```

### 7. Windows 실행 상태 점검

앱 서버 상태:

```powershell
curl.exe -s http://127.0.0.1:3000/api/status
```

Ollama 상태:

```powershell
curl.exe -s http://127.0.0.1:11434/api/tags
```

Qdrant 컬렉션 상태:

```powershell
$key = (Select-String -LiteralPath .env -Pattern '^QDRANT_API_KEY=').Line.Split('=',2)[1]
curl.exe -s -H "api-key: $key" http://127.0.0.1:6333/collections
```

빠른 앱 서버 스모크 테스트:

```powershell
npm.cmd test
```

### 8. Windows 중지 및 재시작

앱 서버는 실행 중인 터미널에서 `Ctrl+C`로 중지한다.

Qdrant 중지:

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env down
```

Qdrant 재시작:

```powershell
docker compose -f deploy/docker-compose.department.yml --env-file .env up -d
```

## Linux 시작 절차

### 1. 사전 요구 사항 설치

Ubuntu/Debian 계열 기준 예시다.

```bash
sudo apt update
sudo apt install -y curl ca-certificates git
```

Node.js 24를 설치한다.

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node --version
npm --version
```

### 2. Ollama 설치 및 모델 준비

Ollama를 설치하고 서비스를 시작한다.

```bash
curl -fsSL https://ollama.com/install.sh | sh
sudo systemctl enable --now ollama
```

모델을 내려받는다.

```bash
ollama pull gemma4:e2b
ollama pull bge-m3
```

Ollama API를 확인한다.

```bash
curl -s http://127.0.0.1:11434/api/tags
```

### 3. 코드 배치 및 의존성 설치

개발 PC에서 직접 실행하는 경우:

```bash
git clone https://github.com/Ubermensch216/myAI.git
cd myAI
npm ci
cp .env.example .env
```

서버형 배포에서는 `/opt/myai` 같은 고정 경로와 전용 사용자를 권장한다.

```bash
sudo useradd --system --home /opt/myai --shell /usr/sbin/nologin myai
sudo mkdir -p /opt/myai
sudo chown myai:myai /opt/myai
sudo -u myai git clone https://github.com/Ubermensch216/myAI.git /opt/myai
cd /opt/myai
sudo -u myai npm ci --omit=dev
```

### 4. 환경 변수 설정

로컬 개발 실행은 프로젝트 루트의 `.env`를 사용한다.

```bash
cp .env.example .env
nano .env
```

부서 워크스테이션은 `.env.department.example`을 출발점으로 삼는다.

```bash
cp ".env.department.example" .env
nano .env
```

권장 핵심 값:

```env
PORT=3000
HOST=127.0.0.1
OLLAMA_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
EMBED_DIM=1024
```

서버형 systemd 실행에서는 `/etc/myai.env`를 사용하는 구성이 더 안전하다.

```bash
sudo cp deploy/myai.env.example /etc/myai.env
sudo chown root:myai /etc/myai.env
sudo chmod 0640 /etc/myai.env
sudo nano /etc/myai.env
```

### 5. Qdrant 벡터 DB 시작

Qdrant를 쓰려면 Docker를 설치한다.

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
```

그룹 변경을 적용하려면 로그아웃 후 다시 로그인하거나 새 셸을 연다. 서버형 배포에서는 필요한 데이터 디렉터리를 미리 만든다.

```bash
sudo -u myai mkdir -p /opt/myai/data/qdrant/storage \
                      /opt/myai/data/qdrant/snapshots \
                      /opt/myai/data/indexes \
                      /opt/myai/data/logs
```

프로젝트 루트에서 Qdrant를 실행한다.

```bash
docker compose -f deploy/docker-compose.department.yml --env-file .env up -d
docker compose -f deploy/docker-compose.department.yml --env-file .env ps
curl -s http://127.0.0.1:6333/healthz
```

Linux 서버에서 `/etc/myai.env`를 쓰고 있다면 compose 실행 전에 같은 Qdrant 값을 `.env`에도 두거나 셸 환경으로 export한다. compose 파일은 `QDRANT_API_KEY`를 환경 변수에서 읽는다.

```bash
export QDRANT_API_KEY="$(grep '^QDRANT_API_KEY=' /etc/myai.env | cut -d= -f2-)"
docker compose -f deploy/docker-compose.department.yml up -d
```

### 6. RAG 인덱스 확인 및 재빌드

```bash
npm run rag:check
```

인덱스가 비어 있거나 불일치하면 재빌드한다.

```bash
npm run rag:rebuild
```

특정 노트북만 확인하거나 재빌드할 수도 있다.

```bash
npm run rag:check -- nb_<id>
npm run rag:rebuild -- nb_<id>
```

### 7. myAI 앱 서버 시작

로컬 개발 실행:

```bash
npm start
```

개발 중 자동 재시작:

```bash
npm run dev
```

로그 파일로 실행:

```bash
npm run start:log
```

브라우저에서 접속한다.

```text
http://localhost:3000
```

서버에서 `HOST=127.0.0.1`로 묶은 경우 같은 서버 내부 또는 reverse proxy를 통해서만 접근된다. 부서 네트워크에서 직접 접속하게 하려면 방화벽, TLS, 인증 정책을 먼저 정한 뒤 `HOST=0.0.0.0` 또는 적절한 인터페이스로 조정한다.

### 8. Linux systemd 서비스 시작

서버형 배포에서는 앱을 systemd 서비스로 등록한다.

```bash
sudo cp deploy/myai.service /etc/systemd/system/myai.service
sudo systemctl daemon-reload
sudo systemctl enable --now myai.service
sudo systemctl status myai.service
```

로그 확인:

```bash
journalctl -u myai -f
```

Qdrant도 systemd로 관리하려면 별도 서비스를 만들 수 있다.

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
sudo systemctl status myai-qdrant.service
```

### 9. Linux 실행 상태 점검

앱 서버 상태:

```bash
curl -s http://127.0.0.1:3000/api/status
```

Ollama 상태:

```bash
curl -s http://127.0.0.1:11434/api/tags
```

Qdrant 상태:

```bash
curl -s http://127.0.0.1:6333/healthz
```

Qdrant 컬렉션 확인:

```bash
QDRANT_API_KEY="$(grep '^QDRANT_API_KEY=' .env | cut -d= -f2-)"
curl -s -H "api-key: $QDRANT_API_KEY" http://127.0.0.1:6333/collections
```

빠른 스모크 테스트:

```bash
npm test
```

### 10. Linux 중지 및 재시작

터미널에서 직접 실행한 앱은 `Ctrl+C`로 중지한다.

systemd 앱 서비스:

```bash
sudo systemctl restart myai.service
sudo systemctl stop myai.service
sudo systemctl start myai.service
```

Qdrant compose:

```bash
docker compose -f deploy/docker-compose.department.yml --env-file .env down
docker compose -f deploy/docker-compose.department.yml --env-file .env up -d
```

Qdrant systemd 서비스:

```bash
sudo systemctl restart myai-qdrant.service
sudo systemctl stop myai-qdrant.service
sudo systemctl start myai-qdrant.service
```

## 시작 문제 해결

### `/api/status`가 실패한다

앱 서버가 실행 중인지 확인한다.

```bash
curl -s http://127.0.0.1:3000/api/status
```

Windows에서는:

```powershell
npm.cmd start
```

Linux에서는:

```bash
npm start
```

systemd 환경에서는:

```bash
sudo systemctl status myai.service
journalctl -u myai -n 100 --no-pager
```

### 채팅 응답이 안 나오거나 모델 오류가 난다

Ollama가 켜져 있고 모델이 설치되어 있는지 확인한다.

```bash
curl -s http://127.0.0.1:11434/api/tags
ollama pull gemma4:e2b
```

`.env` 또는 `/etc/myai.env`의 `OLLAMA_MODEL` 값이 실제 설치된 모델 이름과 같아야 한다.

### 노트북 검색 결과가 비어 있다

임베딩 모델과 RAG 인덱스를 확인한다.

```bash
ollama pull bge-m3
npm run rag:check
npm run rag:rebuild
```

Windows에서는 `npm.cmd`를 사용한다.

```powershell
npm.cmd run rag:check
npm.cmd run rag:rebuild
```

### Qdrant가 연결되지 않는다

컨테이너 상태를 확인한다.

```bash
docker compose -f deploy/docker-compose.department.yml --env-file .env ps
curl -s http://127.0.0.1:6333/healthz
```

`.env`의 `QDRANT_API_KEY`와 Qdrant 컨테이너 실행 시 전달된 `QDRANT_API_KEY`가 같아야 한다. 키를 바꾼 뒤에는 Qdrant 컨테이너를 재생성하고 인덱스를 재빌드한다.

```bash
docker compose -f deploy/docker-compose.department.yml --env-file .env up -d --force-recreate
npm run rag:rebuild
```

### 브라우저 저장소나 보안 오류가 난다

myAI의 개인 데이터는 브라우저 IndexedDB에 AES-GCM으로 암호화되어 저장된다. WebCrypto는 보안 컨텍스트에서 동작하므로 운영 배포에서는 HTTPS를 사용해야 한다. `localhost` 개발 접속은 예외적으로 허용된다.

## 권장 시작 체크리스트

시작 전:

- `.env` 또는 `/etc/myai.env`가 현재 실행 방식과 맞는지 확인한다.
- Ollama가 실행 중인지 확인한다.
- `gemma4:e2b`, `bge-m3` 모델이 설치되어 있는지 확인한다.
- Qdrant를 쓰는 경우 Docker Desktop 또는 Docker Engine이 실행 중인지 확인한다.

시작 후:

- `/api/status`가 정상 응답하는지 확인한다.
- `npm run rag:check` 또는 `npm.cmd run rag:check`가 `"ok": true`인지 확인한다.
- 브라우저에서 `http://localhost:3000` 접속을 확인한다.

