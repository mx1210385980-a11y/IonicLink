#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-frontend}"
HOST="${IONICLINK_HOST:-ioniclink}"
USER="${IONICLINK_USER:-root}"
REMOTE_DIR="${IONICLINK_REMOTE_DIR:-/opt/ioniclink/repo}"

if [[ "$HOST" == *@* ]]; then
  TARGET="$HOST"
else
  TARGET="${USER}@${HOST}"
fi

ensure_remote_dir() {
  echo "==> Ensuring remote directory exists: ${TARGET}:${REMOTE_DIR}"
  ssh "${TARGET}" "mkdir -p '${REMOTE_DIR}/frontend' '${REMOTE_DIR}/backend' '${REMOTE_DIR}/scripts'"
}

sync_manifests() {
  echo "==> Syncing deploy manifests"
  rsync -az --progress \
    AGENTS.md docker-compose.yml .dockerignore .env.docker.example \
    "${TARGET}:${REMOTE_DIR}/"
}

sync_frontend() {
  echo "==> Syncing frontend"
  rsync -az --delete --progress \
    --exclude "node_modules/" \
    --exclude "dist/" \
    frontend/ "${TARGET}:${REMOTE_DIR}/frontend/"
}

sync_backend() {
  echo "==> Syncing backend"
  rsync -az --delete --progress \
    --exclude ".env" \
    --exclude ".venv/" \
    --exclude ".venv-*/" \
    --exclude ".codex_vendor/" \
    --exclude "__pycache__/" \
    --exclude "*.pyc" \
    --exclude ".pytest_cache/" \
    --exclude "pytest-cache-files-*/" \
    --exclude "data/" \
    --exclude "temp_uploads/" \
    backend/ "${TARGET}:${REMOTE_DIR}/backend/"
}

sync_scripts() {
  echo "==> Syncing helper scripts"
  rsync -az --delete --progress \
    scripts/ "${TARGET}:${REMOTE_DIR}/scripts/"
}

build_frontend_dist() {
  echo "==> Building frontend dist locally"
  VITE_API_URL="${VITE_API_URL:-/api}" npm --prefix frontend run build
}

sync_frontend_dist() {
  echo "==> Syncing frontend dist"
  rsync -az --progress \
    frontend/dist/ "${TARGET}:${REMOTE_DIR}/frontend/dist/"
}

sync_frontend_deploy() {
  ensure_remote_dir
  sync_manifests
  sync_frontend
  sync_scripts
}

sync_backend_deploy() {
  ensure_remote_dir
  sync_manifests
  sync_backend
  sync_scripts
}

sync_all() {
  ensure_remote_dir
  sync_manifests
  sync_frontend
  sync_backend
  sync_scripts
}

remote() {
  ssh "${TARGET}" "cd '${REMOTE_DIR}' && $*"
}

case "$ACTION" in
  frontend)
    sync_frontend_deploy
    build_frontend_dist
    sync_frontend_dist
    remote "if sudo docker inspect ioniclink-frontend >/dev/null 2>&1; then sudo docker compose up -d --no-deps frontend && sudo docker exec ioniclink-frontend sh -lc 'mkdir -p /usr/share/nginx/html' && sudo docker cp frontend/dist/. ioniclink-frontend:/usr/share/nginx/html/ && sudo docker cp frontend/nginx.conf ioniclink-frontend:/etc/nginx/conf.d/default.conf && sudo docker compose exec -T frontend nginx -s reload; else sudo docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api -t repo-frontend . && sudo docker compose up -d --no-deps --no-build frontend; fi"
    ;;
  frontend-image)
    sync_frontend_deploy
    remote "sudo docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api -t repo-frontend . && sudo docker compose up -d --no-deps --no-build frontend"
    ;;
  backend)
    sync_backend_deploy
    remote "sudo docker build -f backend/Dockerfile -t repo-backend . && sudo docker compose up -d --no-deps --no-build backend"
    ;;
  all)
    sync_all
    remote "sudo docker compose up -d --build"
    ;;
  nginx)
    sync_frontend_deploy
    remote "sudo docker cp frontend/nginx.conf ioniclink-frontend:/etc/nginx/conf.d/default.conf && sudo docker compose exec -T frontend nginx -s reload"
    ;;
  restart)
    remote "sudo docker compose restart"
    ;;
  status)
    remote "sudo docker compose ps"
    ;;
  logs)
    remote "sudo docker compose logs --tail=120 backend"
    ;;
  *)
    cat >&2 <<'USAGE'
Usage: scripts/deploy-server.sh [frontend|frontend-image|backend|all|nginx|restart|status|logs]

Notes:
  frontend       Build locally and hot-swap nginx static assets on the server.
  frontend-image Rebuild the frontend Docker image on the server.

Environment overrides:
  IONICLINK_HOST=47.82.82.215
  IONICLINK_USER=root
  IONICLINK_REMOTE_DIR=/opt/ioniclink/repo
USAGE
    exit 2
    ;;
esac
