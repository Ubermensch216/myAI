# Container Deployment

This guide covers the portable Docker Compose stack for myAI. The stack runs:

| Service | Image | Purpose |
|---|---|---|
| `app` | built from `Dockerfile` | Node.js 24 Express app and static frontend |
| `qdrant` | `qdrant/qdrant:${QDRANT_IMAGE_TAG:-v1.13.6}` | optional department vector index |
| `ollama` | `ollama/ollama:${OLLAMA_IMAGE_TAG:-latest}` | local model server |

Inside Compose, the app reaches Qdrant at `http://qdrant:6333` and Ollama at `http://ollama:11434`. The web app is exposed on port `3000`. Qdrant and Ollama are bound for local diagnostics only.

## Linux 서버 포팅 개요

myAI 컨테이너 스택을 Linux 서버로 옮기는 방법은 크게 두 가지입니다.

| 방식 | 추천 상황 | 핵심 아이디어 |
|---|---|---|
| 서버에서 다시 빌드 | Git 또는 압축 파일로 소스 코드를 서버에 옮길 수 있음 | Linux 서버에서 `docker compose up -d --build` 실행 |
| 빌드한 이미지를 옮기기 | 서버가 인터넷에 제한적이거나, 현재 PC에서 검증한 앱 이미지를 그대로 사용하고 싶음 | `docker save`로 app 이미지를 tar 파일로 만들고 Linux 서버에서 `docker load` |

처음 배포라면 **서버에서 다시 빌드**하는 방식을 권장합니다. 절차가 단순하고, `qdrant`와 `ollama` 같은 외부 이미지는 Linux 서버에서 직접 pull할 수 있습니다. 반대로 폐쇄망 또는 느린 네트워크 환경이라면 **이미지 tar 이전** 방식이 편합니다.

포팅할 때 기억해야 할 데이터 위치는 다음과 같습니다.

| 데이터 | 위치 | 포팅 필요 여부 |
|---|---|---|
| 앱 코드 | Git 저장소 또는 프로젝트 폴더 | 필요 |
| 앱 이미지 | `myai-app:latest` | 이미지 tar 방식일 때 필요 |
| Qdrant 벡터 인덱스 | `qdrant-storage`, `qdrant-snapshots` Docker volume | 선택. 없어도 notebook 원본에서 재빌드 가능 |
| 프로젝트 원본, SQLite FTS | `myai-data` Docker volume의 `/app/data` | 운영 데이터가 있으면 백업/복원 필요 |
| Ollama 모델 | `ollama-data` Docker volume | 보통 서버에서 다시 `ollama pull` |
| 개인 채팅방, 업로드, 캘린더, 설정 | 각 사용자 브라우저 IndexedDB | 서버로 옮기지 않음 |

운영 데이터가 이미 있다면 Linux로 옮기기 전에 백업부터 합니다.

```bash
docker compose exec app npm run rag:backup
```

백업 파일은 app 컨테이너 안의 `/app/data` 아래에 생기므로, 필요하면 `docker cp`로 호스트에 꺼낸 뒤 서버로 옮깁니다. Qdrant 볼륨 자체를 옮기지 않는 경우에도 `myai-data` 안의 프로젝트 원본만 있으면 인덱스는 재생성할 수 있습니다.

## Linux 서버 준비

아래 예시는 Ubuntu/Debian 계열 기준입니다. Rocky, RHEL, Fedora 계열은 패키지 설치 명령만 배포판에 맞게 바꾸면 나머지 Compose 절차는 같습니다.

1. Docker Engine과 Compose 플러그인을 설치합니다.

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2. 현재 사용자를 `docker` 그룹에 넣습니다.

```bash
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

3. 방화벽에서 서비스 포트를 엽니다.

```bash
sudo ufw allow 3000/tcp
```

Qdrant `6333`, `6334`와 Ollama `11434`는 기본 compose 설정에서 `127.0.0.1`에만 바인딩됩니다. 외부 사용자가 직접 접근할 필요가 없으므로 보통 방화벽에 열지 않습니다.

4. NVIDIA GPU 서버라면 NVIDIA Container Toolkit을 설치한 뒤 GPU compose override를 사용합니다.

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

GPU가 없거나 CPU로만 실행할 서버라면 일반 명령을 사용합니다.

```bash
docker compose up -d --build
```

## Windows에서 Linux 서버로 포팅

Windows PC에서 작업한 프로젝트를 Linux 서버로 옮기는 가장 쉬운 절차입니다.

### Windows 방식 A: 소스 코드를 옮기고 서버에서 다시 빌드

이 방식이 가장 권장됩니다. Windows에서 이미지를 빌드했는지와 상관없이 Linux 서버가 직접 Linux용 app 이미지를 만듭니다.

1. Windows에서 변경사항을 Git에 커밋하고 원격 저장소에 push합니다.

```powershell
git status
git add Dockerfile compose.yml deploy\container.env.example deploy\docker-compose.gpu.yml docs\CONTAINER_DEPLOYMENT.md README.md package.json
git commit -m "Update container deployment docs"
git push
```

2. Linux 서버에서 저장소를 clone하거나 pull합니다.

```bash
cd /opt
sudo mkdir -p /opt/myai
sudo chown "$USER":"$USER" /opt/myai
git clone <your-git-repository-url> /opt/myai
cd /opt/myai
```

이미 clone되어 있다면:

```bash
cd /opt/myai
git pull
```

3. 컨테이너 환경 파일을 만듭니다.

```bash
cp deploy/container.env.example .env
nano .env
```

반드시 바꿀 값:

```env
ADMIN_TOKEN=<long-random-token>
QDRANT_API_KEY=<long-random-token>
MYAI_BIND_ADDR=0.0.0.0
MYAI_PORT=3000
```

외부에 공개하지 않을 내부 서비스는 기본값을 유지합니다.

```env
QDRANT_BIND_ADDR=127.0.0.1
OLLAMA_BIND_ADDR=127.0.0.1
```

4. 스택을 빌드하고 실행합니다.

```bash
docker compose up -d --build
docker compose ps
```

5. Ollama 모델을 Linux 서버의 Ollama 컨테이너에 내려받습니다.

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

6. 상태를 확인합니다.

```bash
curl -s http://127.0.0.1:3000/api/status
```

브라우저에서 접속:

```text
http://<linux-server-ip>:3000
```

### Windows 방식 B: Windows에서 빌드한 app 이미지를 tar로 옮기기

이 방식은 Linux 서버가 소스 빌드를 하지 않게 하고 싶을 때 사용합니다. Docker Desktop이 **Linux containers** 모드인지 확인해야 합니다. Windows containers 모드에서 만든 이미지는 Linux 서버에서 실행되지 않습니다.

1. Windows에서 app 이미지를 빌드합니다.

```powershell
docker compose build app
```

2. 이미지가 Linux용인지 확인합니다.

```powershell
docker image inspect myai-app:latest --format "{{.Os}}/{{.Architecture}}"
```

일반적인 x86_64 Linux 서버라면 결과가 아래처럼 나와야 합니다.

```text
linux/amd64
```

ARM 서버라면 `linux/arm64` 이미지가 필요합니다. 그 경우 Windows에서 buildx로 플랫폼을 지정합니다.

```powershell
docker buildx build --platform linux/arm64 -t myai-app:latest --load .
```

3. app 이미지를 tar 파일로 저장합니다.

```powershell
docker save myai-app:latest -o myai-app.tar
```

4. 프로젝트 파일과 이미지 tar를 Linux 서버로 복사합니다.

```powershell
scp myai-app.tar <user>@<linux-server-ip>:/opt/myai-app.tar
scp compose.yml <user>@<linux-server-ip>:/opt/myai/compose.yml
scp Dockerfile <user>@<linux-server-ip>:/opt/myai/Dockerfile
scp -r deploy public server scripts docs fixtures package.json package-lock.json README.md agents.md <user>@<linux-server-ip>:/opt/myai/
```

Git을 쓸 수 있다면 프로젝트 파일은 `git clone`으로 받는 편이 더 안전합니다. 이 경우 `myai-app.tar`만 `scp`로 옮기면 됩니다.

5. Linux 서버에서 app 이미지를 불러옵니다.

```bash
cd /opt/myai
docker load -i /opt/myai-app.tar
docker image ls myai-app
```

6. `.env`를 만들고 실행합니다.

```bash
cp deploy/container.env.example .env
nano .env
docker compose up -d
```

`docker compose up -d`는 `myai-app:latest`가 이미 있으면 그 이미지를 사용합니다. 단, `qdrant`와 `ollama` 이미지는 Linux 서버에서 pull할 수 있어야 합니다. 완전한 폐쇄망이라면 아래 이미지들도 Windows에서 저장해 함께 옮깁니다.

```powershell
docker pull qdrant/qdrant:v1.13.6
docker pull ollama/ollama:latest
docker save qdrant/qdrant:v1.13.6 -o qdrant.tar
docker save ollama/ollama:latest -o ollama.tar
```

Linux 서버:

```bash
docker load -i qdrant.tar
docker load -i ollama.tar
docker compose up -d
```

7. 모델은 별도로 준비합니다.

Ollama 모델은 `myai-app` 이미지 안에 들어있지 않습니다. 인터넷이 되는 서버라면:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

인터넷이 안 되는 서버라면 기존 Ollama 데이터 볼륨이나 모델 파일을 별도 절차로 옮겨야 합니다. 이 경우 모델 용량이 크므로 서버 환경에 맞게 별도 백업 계획을 잡는 편이 좋습니다.

## Linux에서 Linux 서버로 포팅

개발 PC도 Linux이고 운영 서버도 Linux라면 절차가 더 단순합니다.

### Linux 방식 A: Git으로 서버에서 다시 빌드

1. 개발 PC에서 변경사항을 push합니다.

```bash
git status
git add Dockerfile compose.yml deploy/container.env.example docs/CONTAINER_DEPLOYMENT.md README.md package.json
git commit -m "Update container deployment docs"
git push
```

2. 운영 서버에서 코드를 받습니다.

```bash
cd /opt
git clone <your-git-repository-url> myai
cd /opt/myai
```

이미 배포된 서버라면:

```bash
cd /opt/myai
git pull
```

3. `.env`를 준비합니다.

```bash
cp deploy/container.env.example .env
openssl rand -hex 32
openssl rand -hex 32
nano .env
```

생성한 값을 각각 넣습니다.

```env
ADMIN_TOKEN=<first-random-value>
QDRANT_API_KEY=<second-random-value>
```

4. 실행합니다.

```bash
docker compose up -d --build
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

### Linux 방식 B: Linux에서 빌드한 app 이미지를 서버로 옮기기

1. 개발 Linux PC에서 이미지를 빌드합니다.

```bash
docker compose build app
docker image inspect myai-app:latest --format '{{.Os}}/{{.Architecture}}'
```

2. 서버 CPU 아키텍처를 확인합니다.

```bash
ssh <user>@<linux-server-ip> 'uname -m'
```

일반적인 매핑:

| `uname -m` | Docker platform |
|---|---|
| `x86_64` | `linux/amd64` |
| `aarch64` | `linux/arm64` |

아키텍처가 다르면 buildx로 다시 빌드합니다.

```bash
docker buildx build --platform linux/amd64 -t myai-app:latest --load .
```

3. 이미지를 저장하고 서버로 복사합니다.

```bash
docker save myai-app:latest -o myai-app.tar
scp myai-app.tar <user>@<linux-server-ip>:/opt/myai-app.tar
```

4. 서버에서 이미지를 로드하고 실행합니다.

```bash
cd /opt/myai
docker load -i /opt/myai-app.tar
docker compose up -d
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

## 운영 데이터 이전

처음 배포가 아니라 기존 프로젝트과 인덱스를 옮겨야 한다면, app 데이터와 Qdrant 데이터를 구분해서 생각합니다.

### 권장: 프로젝트 원본을 옮기고 인덱스 재빌드

이 방식은 가장 안전합니다. Qdrant 내부 파일 형식이나 버전에 덜 민감합니다.

1. 기존 서버에서 백업합니다.

```bash
docker compose exec app npm run rag:backup
```

2. 백업 파일을 새 서버로 복사합니다.

```bash
scp <backup-file> <user>@<linux-server-ip>:/opt/myai/
```

3. 새 서버에서 복원하고 인덱스를 재빌드합니다.

```bash
cd /opt/myai
docker compose exec app npm run rag:restore -- /app/data/<backup-file-name>
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

백업 파일이 호스트의 `/opt/myai`에만 있다면 먼저 컨테이너 안으로 복사합니다.

```bash
docker cp <backup-file-name> myai-app:/app/data/<backup-file-name>
```

### 선택: Docker volume 자체를 옮기기

볼륨을 그대로 옮기면 빠르지만, Qdrant 버전과 CPU 아키텍처가 바뀌는 경우에는 재빌드 방식이 더 안전합니다.

기존 서버:

```bash
docker compose down
docker run --rm -v myai_myai-data:/data -v "$PWD":/backup alpine tar czf /backup/myai-data.tgz -C /data .
docker run --rm -v myai_qdrant-storage:/data -v "$PWD":/backup alpine tar czf /backup/qdrant-storage.tgz -C /data .
docker compose up -d
```

새 서버:

```bash
docker compose up -d
docker compose down
docker run --rm -v myai_myai-data:/data -v "$PWD":/backup alpine sh -c "cd /data && tar xzf /backup/myai-data.tgz"
docker run --rm -v myai_qdrant-storage:/data -v "$PWD":/backup alpine sh -c "cd /data && tar xzf /backup/qdrant-storage.tgz"
docker compose up -d
docker compose exec app npm run rag:check
```

볼륨 이름은 Compose 프로젝트 이름에 따라 달라질 수 있습니다. 현재 compose는 `name: myai`이므로 기본 볼륨 이름은 `myai_myai-data`, `myai_qdrant-storage`, `myai_qdrant-snapshots`, `myai_ollama-data`입니다.

## 포팅 후 점검 체크리스트

Linux 서버에서 아래 순서로 확인합니다.

```bash
docker compose ps
docker compose logs --tail=100 app
curl -s http://127.0.0.1:3000/api/status
docker compose exec ollama ollama list
docker compose exec app npm run rag:check
```

브라우저에서는 다음을 확인합니다.

- `http://<linux-server-ip>:3000` 접속
- 일반 채팅 응답
- 파일 업로드 후 요약/질의
- 프로젝트 목록 조회
- 프로젝트 검색과 citation 표시
- Admin Console 진입

문제가 생길 때 가장 먼저 볼 곳:

```bash
docker compose logs -f app
docker compose logs -f ollama
docker compose logs -f qdrant
```

자주 나는 문제:

| 증상 | 확인할 것 |
|---|---|
| 브라우저에서 접속 불가 | `MYAI_BIND_ADDR=0.0.0.0`, 방화벽 `3000/tcp`, 서버 보안그룹 |
| `/api/status`에서 Ollama 실패 | `docker compose ps`, `docker compose exec ollama ollama list`, 모델 pull 여부 |
| Qdrant 인증 실패 | `.env`의 `QDRANT_API_KEY`와 compose 환경값 일치 여부 |
| 프로젝트 검색 결과 없음 | `rag:rebuild`, `rag:check`, notebook 원본 복원 여부 |
| GPU를 못 씀 | NVIDIA driver, NVIDIA Container Toolkit, `deploy/docker-compose.gpu.yml` 사용 여부 |

## First Run

Copy the container environment template:

```bash
cp deploy/container.env.example .env
```

On Windows PowerShell:

```powershell
copy deploy\container.env.example .env
```

Edit `.env` and set strong server-side secrets:

```env
ADMIN_TOKEN=<long-random-token>
QDRANT_API_KEY=<long-random-token>
```

The template also exposes image tags for controlled updates:

```env
NODE_IMAGE=node:24-bookworm-slim
QDRANT_IMAGE_TAG=v1.13.6
OLLAMA_IMAGE_TAG=latest
```

Optional Naver Search configuration belongs in this same `.env` file:

```env
NAVER_SEARCH_ENABLED=true
NAVER_SEARCH_CLIENT_ID=<naver-client-id>
NAVER_SEARCH_CLIENT_SECRET=<naver-client-secret>
NAVER_SEARCH_TYPES=news,webkr
```

Start the stack:

```bash
docker compose up -d --build
```

Pull the recommended local models into the Ollama container:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

Open:

```text
http://localhost:3000
```

Check status:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

## GPU Mode

On Linux hosts with NVIDIA drivers and NVIDIA Container Toolkit installed, use the GPU override:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

Without NVIDIA GPU support, use the plain stack:

```bash
docker compose up -d --build
```

## Host Ollama

If Ollama is already running on the host machine, run only the app and Qdrant and point the app at the host:

```env
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434
```

```bash
docker compose up -d --build app qdrant
```

On Linux, `host.docker.internal` is provided by the Compose configuration through `host-gateway`. If your Docker version does not support it, replace the URL with the bridge gateway address used on your host.

## Department RAG Indexes

The Compose stack is designed for the indexed department RAG path:

```env
DEPARTMENT_VECTOR_BACKEND=qdrant
DEPARTMENT_LEXICAL_BACKEND=sqlite
QDRANT_URL=http://qdrant:6333
SQLITE_FTS_PATH=data/indexes/department-rag.sqlite
```

After importing or restoring department notebooks, rebuild and check indexes:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

Run the fast quality fixture when changing retrieval settings:

```bash
docker compose exec app npm run rag:quality-test:quick
```

## Web Search Behavior

Naver Search is server-side only. When enabled and configured, the app uses it for explicit search prompts in normal chat.

It is intentionally disabled for:

- prompts with uploaded room files in the chat payload
- prompts where a department notebook is selected

Those paths must stay grounded in the uploaded file or notebook RAG evidence.

## Persistence

Docker volumes:

| Volume | Contents |
|---|---|
| `myai-data` | department notebooks, SQLite FTS index, ingest jobs, retrieval logs |
| `qdrant-storage` | Qdrant vector index |
| `qdrant-snapshots` | Qdrant snapshots |
| `ollama-data` | downloaded Ollama models |

`data/notebooks/` is the source of truth for department notebooks. Qdrant and SQLite indexes can be rebuilt from it.

Personal rooms, uploads, calendar events, chat history, and settings remain in each user's browser IndexedDB, not in Docker volumes.

## Backup And Restore

Back up department notebooks and indexes:

```bash
docker compose exec app npm run rag:backup
```

Restore through the matching restore script, then rebuild/check indexes:

```bash
docker compose exec app npm run rag:restore -- <backup-file>
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

If Qdrant storage is lost but `myai-data` is intact, run `rag:rebuild`.

## Updates

```bash
git pull
docker compose pull qdrant ollama
docker compose build --pull app
docker compose up -d
docker compose exec app npm run rag:check
```

The same container refresh can be run through npm:

```bash
npm run docker:update
docker compose exec app npm run rag:check
```

Pull models again only when model names change:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

When changing `QDRANT_IMAGE_TAG` and keeping the existing `qdrant-storage`
volume, upgrade one minor version at a time. If you intentionally recreate the
Qdrant volume, rebuild the department indexes from `myai-data` afterward:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

## Operations Notes

- Keep `ADMIN_TOKEN`, `QDRANT_API_KEY`, and Naver API secrets server-side.
- Use the main gear button -> Admin Console to manage department notebooks,
  access groups/levels, Super read access, notebook policies, and system status.
- Use `docs/SECURITY.md` before exposing the app beyond localhost or a trusted LAN.
- Reverse proxies must not buffer `/api/chat`; streamed responses should flush as they arrive.
- Docker Desktop may need at least 8 GiB memory for `gemma4:e2b` inside the Ollama container.
- If port `3000` is already occupied, stop the old process or change `PORT` in `.env`.
