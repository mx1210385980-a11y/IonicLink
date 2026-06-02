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

cleanup_remote_backend_build_residue() {
  echo "==> Cleaning stale backend build-context residues"
  remote "rm -rf backend/.venv backend/.venv-* backend/.codex_vendor backend/__pycache__ backend/.pytest_cache backend/pytest-cache-files-*"
}

sync_scripts() {
  echo "==> Syncing helper scripts"
  rsync -az --delete --progress \
    scripts/ "${TARGET}:${REMOTE_DIR}/scripts/"
}

sync_literature_assets() {
  echo "==> Syncing literature PDFs and upload assets"
  ssh "${TARGET}" "mkdir -p '${REMOTE_DIR}/Reference' '${REMOTE_DIR}/backend/temp_uploads' '${REMOTE_DIR}/temp_uploads'"

  if [[ -d "Reference" ]]; then
    rsync -az --progress \
      Reference/ "${TARGET}:${REMOTE_DIR}/Reference/"
  fi

  if [[ -d "backend/temp_uploads" ]]; then
    rsync -az --progress \
      backend/temp_uploads/ "${TARGET}:${REMOTE_DIR}/backend/temp_uploads/"
    rsync -az --progress \
      backend/temp_uploads/ "${TARGET}:${REMOTE_DIR}/temp_uploads/"
  fi

  if [[ -d "temp_uploads" ]]; then
    rsync -az --progress \
      temp_uploads/ "${TARGET}:${REMOTE_DIR}/temp_uploads/"
  fi
}

build_frontend_dist() {
  echo "==> Building frontend dist locally"
  VITE_API_URL="${VITE_API_URL:-/api}" npm --prefix frontend run build
}

sync_frontend_dist() {
  echo "==> Syncing frontend dist"
  rsync -az --delete --progress \
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
  cleanup_remote_backend_build_residue
  sync_scripts
}

sync_all() {
  ensure_remote_dir
  sync_manifests
  sync_frontend
  sync_backend
  cleanup_remote_backend_build_residue
  sync_scripts
}

remote() {
  ssh "${TARGET}" "cd '${REMOTE_DIR}' && $*"
}

prune_remote_build_cache() {
  if [[ "${IONICLINK_PRUNE_BUILD_CACHE:-1}" == "0" ]]; then
    echo "==> Skipping remote Docker build cache prune"
    return
  fi
  echo "==> Pruning remote Docker build cache"
  remote "sudo docker builder prune -af"
}

hot_swap_frontend_dist_remote() {
  remote "if sudo docker inspect ioniclink-frontend >/dev/null 2>&1; then sudo docker compose up -d --no-deps --no-build frontend >/dev/null 2>&1 || sudo docker compose up -d --no-deps frontend; sudo docker exec ioniclink-frontend sh -lc 'mkdir -p /usr/share/nginx/html && find /usr/share/nginx/html -mindepth 1 -maxdepth 1 -exec rm -rf {} +'; sudo docker cp frontend/dist/. ioniclink-frontend:/usr/share/nginx/html/; sudo docker cp frontend/nginx.conf ioniclink-frontend:/etc/nginx/conf.d/default.conf; sudo docker compose exec -T frontend nginx -s reload; else sudo docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api -t repo-frontend . && sudo docker compose up -d --no-deps --no-build frontend; fi"
}

hot_swap_backend_code_remote() {
  remote "if sudo docker inspect ioniclink-backend >/dev/null 2>&1; then sudo docker compose up -d --no-deps --no-build backend >/dev/null 2>&1 || sudo docker compose up -d --no-deps backend; sudo docker cp backend/. ioniclink-backend:/app/backend/; sudo docker exec ioniclink-backend sh -lc 'find /app/backend -type d -name __pycache__ -prune -exec rm -rf {} +'; sudo docker compose restart backend; else echo 'Backend container is missing. Run scripts/deploy-server.sh backend-image first.' >&2; exit 1; fi"
}

case "$ACTION" in
  frontend)
    sync_frontend_deploy
    build_frontend_dist
    sync_frontend_dist
    hot_swap_frontend_dist_remote
    ;;
  frontend-image)
    sync_frontend_deploy
    remote "sudo docker build -f frontend/Dockerfile --build-arg VITE_API_URL=/api -t repo-frontend . && sudo docker compose up -d --no-deps --no-build frontend"
    prune_remote_build_cache
    ;;
  backend)
    sync_backend_deploy
    hot_swap_backend_code_remote
    ;;
  backend-image)
    sync_backend_deploy
    remote "sudo docker build -f backend/Dockerfile -t repo-backend . && sudo docker compose up -d --no-deps --no-build backend"
    prune_remote_build_cache
    ;;
  all)
    sync_all
    build_frontend_dist
    sync_frontend_dist
    hot_swap_backend_code_remote
    hot_swap_frontend_dist_remote
    ;;
  all-image)
    sync_all
    remote "sudo docker compose up -d --build"
    prune_remote_build_cache
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
  assets)
    ensure_remote_dir
    sync_scripts
    sync_literature_assets
    ;;
  *)
    cat >&2 <<'USAGE'
Usage: scripts/deploy-server.sh [frontend|frontend-image|backend|backend-image|all|all-image|nginx|restart|status|logs|assets]

Notes:
  frontend       Build locally and hot-swap nginx static assets on the server.
  frontend-image Rebuild the frontend Docker image on the server.
  backend        Hot-swap backend code into the running container and restart it.
  backend-image  Rebuild the backend Docker image on the server.
  all            Hot-swap frontend dist and backend code without rebuilding images.
  all-image      Rebuild Docker images for frontend and backend.
  assets         Sync literature PDFs and uploaded source files without rebuilding.

Environment overrides:
  IONICLINK_HOST=47.82.82.215
  IONICLINK_USER=root
  IONICLINK_REMOTE_DIR=/opt/ioniclink/repo
  IONICLINK_PRUNE_BUILD_CACHE=0  # skip automatic docker builder cache cleanup
USAGE
    exit 2
    ;;
esac
