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
- `INITIAL_ADMIN_PASSWORD`: the initial password for the `admin` user on first database bootstrap. It must satisfy the password policy and will require a change after first login.
- `DATABASE_URL`: default `sqlite:////data/app.db`
- `SSH_KNOWN_HOSTS`: known hosts path
- `SSH_ALLOW_UNKNOWN_HOSTS`: allow unknown host keys or not
- `VITE_API_BASE`: frontend API base in development mode

Security reminder: verify both `SECRET_KEY` and `INITIAL_ADMIN_PASSWORD` are replaced before going live. Otherwise authentication is weakened and first-time admin bootstrap will fail.

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

Quick start example (note: both `SECRET_KEY` and `INITIAL_ADMIN_PASSWORD` below are examples and must be replaced in your own deployment):

```bash
docker run -d -p 8080:8080 \
  -e SECRET_KEY="67e457b4eab14012b34382b3d634f297" \
  -e INITIAL_ADMIN_PASSWORD="ChangeMe123" \
  beibeizi/websshgateway:latest
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
- Initial password comes from `INITIAL_ADMIN_PASSWORD` in `.env`
- Password change is required after first login
- To reset an existing user's password, run `cd backend && python -m app.cli reset-password --username <username>` in the backend directory on the server

## 6. Troubleshooting

- Login fails: check that `SECRET_KEY` is 16/24/32 bytes long and that `INITIAL_ADMIN_PASSWORD` was set before the first database bootstrap.
- SSH connection fails: verify host reachability, credentials, and host key policy.
- Frontend requests return 401: check whether the token expired or whether `VITE_API_BASE` points to the correct backend in development mode.
- Service diagnostics: after login, open **Logs** next to **System Settings** on the session management page, or visit `/logs` directly. The page shows recent logs from the current backend process memory buffer. Logs restart when the service restarts and are not a replacement for full host or Docker log history.
