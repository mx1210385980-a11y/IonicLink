# Docker Guide

This project now includes Docker support for both frontend and backend.

## Included Files

- `backend/Dockerfile`: builds the FastAPI backend image
- `frontend/Dockerfile`: builds the Vue app and serves it with Nginx
- `frontend/nginx.conf`: SPA fallback and reverse proxy configuration
- `docker-compose.yml`: local multi-container orchestration
- `.env.docker.example`: example runtime environment variables

## Quick Start

Unix-like shells:

```bash
cp .env.docker.example .env
docker compose up --build
```

PowerShell:

```powershell
Copy-Item .env.docker.example .env
docker compose up --build
```

## Default Endpoints

- Frontend: `http://localhost:8080`
- Backend API: `http://localhost:8000`
- Swagger: `http://localhost:8000/docs`

## Persistent Storage

The compose file mounts these host directories:

- `./backend/data -> /app/backend/data`
- `./temp_uploads -> /app/backend/temp_uploads`

This keeps the SQLite database and uploaded files on the host machine.

## Important Environment Variables

Change these before any production-like deployment:

- `JWT_SECRET`
- `IONICLINK_ADMIN_PASSWORD`
- `OPENAI_API_KEY`
- `LLM_VISION_API_KEY`

Optional variables are documented in `.env.docker.example`.

Default `CORS_ALLOW_ORIGINS` already covers both local Vite development and Docker frontend:

- `http://localhost:5173`
- `http://127.0.0.1:5173`
- `http://localhost:8080`
- `http://127.0.0.1:8080`

## Common Commands

```bash
docker compose up -d
docker compose down
docker compose logs -f backend
docker compose logs -f frontend
docker compose build --no-cache
```
