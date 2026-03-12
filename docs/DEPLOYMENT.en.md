# Development and Deployment Guide (Community Edition)

> 中文版请见：[DEPLOYMENT.md](./DEPLOYMENT.md)

## 1. Prerequisites

- Python 3.11+
- Node.js 20+
- npm 10+
- Docker 24+ (for container deployment)

## 2. Environment Variables

```bash
cp .env.example .env
```

Important variables:

- `SECRET_KEY`: must be 16/24/32 bytes (32 chars recommended). You must replace it with your own strong random value and never keep example/default values.
- `DATABASE_URL`: default `sqlite:////data/app.db`
- `SSH_KNOWN_HOSTS`: known hosts path
- `SSH_ALLOW_UNKNOWN_HOSTS`: allow unknown host keys or not
- `VITE_API_BASE`: frontend API base in development mode

Security reminder: verify `SECRET_KEY` is replaced before going live, otherwise authentication/session security is at risk.

## 3. Local Development

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
set -a
source ../.env
set +a
uvicorn app.main:app --host 0.0.0.0 --port 8080 --reload
```

### Frontend

```bash
cd frontend
npm ci
VITE_API_BASE=http://127.0.0.1:8080 npm run dev -- --host 0.0.0.0 --port 5173
```

## 4. Docker Deployment

Docker Hub image: `https://hub.docker.com/r/beibeizi/websshgateway`

Quick start example (note: `SECRET_KEY` is an example, replace it in your own deployment; a 32‑char UUID is enough):

```bash
docker run -d -p 8080:8080 -e SECRET_KEY="67e457b4eab14012b34382b3d634f297" beibeizi/websshgateway:latest
```

### Single Container

```bash
docker build -t webssh-gateway:community .
export DOCKER_IMAGE=beibeizi/websshgateway:latest

docker run -d \
  --name webssh-gateway \
  -p 8080:8080 \
  --env-file .env \
  -v webssh-data:/data \
  ${DOCKER_IMAGE:-webssh-gateway:community}
```

### Docker Compose

```bash
docker compose up -d --build
```

## 5. First Login

- Default user: `admin`
- Initial password is printed in backend logs at first startup
- Password change is required after first login
