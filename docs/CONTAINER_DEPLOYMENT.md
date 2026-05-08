# Container Deployment

myAI를 Docker Compose 스택으로 실행하는 절차입니다.

## 서비스 구성

| 서비스 | 이미지 | 역할 |
|---|---|---|
| `app` | `Dockerfile` 빌드 | Node.js 24 Express 앱 + 정적 프론트엔드 |
| `qdrant` | `qdrant/qdrant:v1.13.6` | 부서 노트북 벡터 인덱스 |
| `ollama` | `ollama/ollama:latest` | 로컬 모델 서버 |

앱은 Compose 내부 네트워크를 통해 `http://qdrant:6333`, `http://ollama:11434`로 접근합니다.  
기본적으로 앱만 모든 호스트 인터페이스에 노출되고, Qdrant·Ollama는 진단 목적으로 `127.0.0.1`에만 바인딩됩니다.

---

## Linux

### 사전 요건

- Docker Engine 24+ 및 Compose 플러그인 v2
- GPU 사용 시: NVIDIA 드라이버 + [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)

### 첫 실행

```bash
cp deploy/container.env.example .env
```

토큰 생성 후 `.env` 편집:

```bash
openssl rand -hex 32   # ADMIN_TOKEN 값으로 사용
openssl rand -hex 32   # QDRANT_API_KEY 값으로 사용
```

```env
ADMIN_TOKEN=<위에서 생성한 값>
QDRANT_API_KEY=<위에서 생성한 값>
```

스택 시작:

```bash
docker compose up -d --build
```

모델 다운로드:

```bash
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

상태 확인:

```bash
docker compose ps
curl -s http://127.0.0.1:3000/api/status
```

### GPU 모드

NVIDIA Container Toolkit 설치 후 GPU 오버레이를 추가하여 실행:

```bash
docker compose -f compose.yml -f deploy/docker-compose.gpu.yml up -d --build
```

NVIDIA 런타임이 없는 호스트는 오버레이 없이 `docker compose up -d --build`를 사용합니다.

### 외부 Ollama (Linux)

Ollama를 호스트에서 직접 실행하는 경우:

```bash
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434 \
  docker compose up -d --build app qdrant
```

> Linux 호스트는 `host.docker.internal`이 기본 정의되지 않을 수 있습니다.  
> 그 경우 `compose.yml`에 `extra_hosts: host.docker.internal:host-gateway`를 추가하거나, 브리지 IP(보통 `172.17.0.1`)를 직접 사용하세요.

---

## Windows

### 사전 요건

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) 4.x 이상 (WSL 2 백엔드 권장)
- WSL 2 백엔드: Docker Desktop → Settings → General → "Use the WSL 2 based engine" 활성화

### 첫 실행

```powershell
copy deploy\container.env.example .env
```

토큰 생성 (PowerShell):

```powershell
[Convert]::ToBase64String(
  [System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
)
```

생성된 값으로 `.env` 편집:

```env
ADMIN_TOKEN=<위에서 생성한 값>
QDRANT_API_KEY=<위에서 생성한 값>
```

스택 시작:

```powershell
docker compose up -d --build
```

모델 다운로드:

```powershell
docker compose exec ollama ollama pull gemma4:e2b
docker compose exec ollama ollama pull bge-m3
```

상태 확인:

```powershell
docker compose ps
curl http://127.0.0.1:3000/api/status
```

### Docker Desktop 메모리 설정

`gemma4:e2b`는 Docker VM 안에서 약 7 GiB를 사용합니다. Ollama가 모델 로딩에 실패하면:

1. Docker Desktop → Settings → Resources → Memory를 **8 GiB 이상**으로 늘린 뒤 Docker Desktop 재시작, 또는
2. Ollama를 Windows 호스트에서 직접 실행하고 아래 외부 Ollama 설정을 사용

### 외부 Ollama (Windows)

Ollama를 Windows에 직접 설치하여 실행하는 경우 `.env`에 추가:

```env
MYAI_CONTAINER_OLLAMA_URL=http://host.docker.internal:11434
```

그런 다음 app과 qdrant만 시작:

```powershell
docker compose up -d --build app qdrant
```

`host.docker.internal`은 Windows Docker Desktop에서 자동으로 해석됩니다.

---

## 공통 작업

### 부서 인덱스 재구축

노트북을 가져오거나 복원한 후 Qdrant·SQLite 인덱스를 재구축:

```bash
docker compose exec app npm run rag:rebuild
docker compose exec app npm run rag:check
```

### 업데이트

```bash
git pull
docker compose build app
docker compose up -d
```

Named 볼륨은 이미지 재빌드 후에도 노트북, 벡터 인덱스, SQLite 인덱스, 로그, Ollama 모델을 보존합니다.

### 백업 대상

아래 Docker 볼륨을 함께 백업합니다:

| 볼륨 | 내용 |
|---|---|
| `myai-data` | `data/notebooks/` — 부서 노트북 원본 (인덱스의 소스) |
| `qdrant-storage` | Qdrant 벡터 인덱스 |
| `qdrant-snapshots` | Qdrant 스냅샷 |
| `ollama-data` | Ollama 모델 (재다운로드를 피하려면 포함) |

`myai-data`의 `data/notebooks/`가 인덱스의 소스이므로, Qdrant는 노트북에서 언제든 재구축할 수 있습니다.
