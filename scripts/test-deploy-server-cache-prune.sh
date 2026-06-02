#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

FAKE_BIN="${TMP_DIR}/bin"
LOG_FILE="${TMP_DIR}/ssh.log"
mkdir -p "${FAKE_BIN}"

cat > "${FAKE_BIN}/ssh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${IONICLINK_TEST_SSH_LOG}"
exit 0
EOF

cat > "${FAKE_BIN}/rsync" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

cat > "${FAKE_BIN}/npm" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF

chmod +x "${FAKE_BIN}/ssh" "${FAKE_BIN}/rsync" "${FAKE_BIN}/npm"

PATH="${FAKE_BIN}:${PATH}" \
IONICLINK_TEST_SSH_LOG="${LOG_FILE}" \
IONICLINK_HOST="deploy-test-host" \
IONICLINK_REMOTE_DIR="/tmp/ioniclink-test-repo" \
  "${ROOT_DIR}/scripts/deploy-server.sh" backend >/dev/null

if ! grep -q "docker cp backend/. ioniclink-backend:/app/backend/" "${LOG_FILE}"; then
  echo "Expected backend deploy to hot-swap backend code into the running container." >&2
  exit 1
fi

if ! grep -q "docker compose restart backend" "${LOG_FILE}"; then
  echo "Expected backend deploy to restart backend after hot-swapping code." >&2
  exit 1
fi

if grep -q "docker build -f backend/Dockerfile" "${LOG_FILE}"; then
  echo "Backend deploy should not rebuild the Docker image by default." >&2
  exit 1
fi

if grep -q "docker builder prune -af" "${LOG_FILE}"; then
  echo "Backend hot-swap deploy should not prune Docker build cache." >&2
  exit 1
fi

if ! grep -q "backend/.venv" "${LOG_FILE}" || ! grep -q "backend/.venv-\\*" "${LOG_FILE}"; then
  echo "Expected backend deploy to remove stale remote virtualenv residues before hot-swap." >&2
  exit 1
fi

if grep -q "backend/data" "${LOG_FILE}" || grep -q "backend/temp_uploads" "${LOG_FILE}"; then
  echo "Backend deploy cleanup must not remove runtime data or upload volumes." >&2
  exit 1
fi

: > "${LOG_FILE}"
PATH="${FAKE_BIN}:${PATH}" \
IONICLINK_TEST_SSH_LOG="${LOG_FILE}" \
IONICLINK_HOST="deploy-test-host" \
IONICLINK_REMOTE_DIR="/tmp/ioniclink-test-repo" \
  "${ROOT_DIR}/scripts/deploy-server.sh" backend-image >/dev/null

if ! grep -q "docker build -f backend/Dockerfile" "${LOG_FILE}"; then
  echo "Expected backend-image deploy to rebuild the Docker image." >&2
  exit 1
fi

if ! grep -q "docker builder prune -af" "${LOG_FILE}"; then
  echo "Expected backend-image deploy to prune Docker build cache after rebuild." >&2
  exit 1
fi

if ! grep -q "backend/.venv" "${LOG_FILE}" || ! grep -q "backend/.venv-\\*" "${LOG_FILE}"; then
  echo "Expected backend-image deploy to remove stale remote virtualenv residues before rebuild." >&2
  exit 1
fi

if grep -q "backend/data" "${LOG_FILE}" || grep -q "backend/temp_uploads" "${LOG_FILE}"; then
  echo "Backend-image deploy cleanup must not remove runtime data or upload volumes." >&2
  exit 1
fi

: > "${LOG_FILE}"
PATH="${FAKE_BIN}:${PATH}" \
IONICLINK_TEST_SSH_LOG="${LOG_FILE}" \
IONICLINK_HOST="deploy-test-host" \
IONICLINK_REMOTE_DIR="/tmp/ioniclink-test-repo" \
IONICLINK_PRUNE_BUILD_CACHE=0 \
  "${ROOT_DIR}/scripts/deploy-server.sh" backend-image >/dev/null

if grep -q "docker builder prune -af" "${LOG_FILE}"; then
  echo "Expected IONICLINK_PRUNE_BUILD_CACHE=0 to skip Docker build cache prune." >&2
  exit 1
fi

: > "${LOG_FILE}"
PATH="${FAKE_BIN}:${PATH}" \
IONICLINK_TEST_SSH_LOG="${LOG_FILE}" \
IONICLINK_HOST="deploy-test-host" \
IONICLINK_REMOTE_DIR="/tmp/ioniclink-test-repo" \
  "${ROOT_DIR}/scripts/deploy-server.sh" all >/dev/null

if grep -q "docker compose up -d --build" "${LOG_FILE}" || grep -q "docker build -f backend/Dockerfile" "${LOG_FILE}"; then
  echo "Default all deploy should not rebuild images or machine-learning dependencies." >&2
  exit 1
fi

if ! grep -q "docker cp backend/. ioniclink-backend:/app/backend/" "${LOG_FILE}"; then
  echo "Expected all deploy to hot-swap backend code." >&2
  exit 1
fi

if ! grep -q "docker cp frontend/dist/. ioniclink-frontend:/usr/share/nginx/html/" "${LOG_FILE}"; then
  echo "Expected all deploy to hot-swap frontend dist." >&2
  exit 1
fi

: > "${LOG_FILE}"
PATH="${FAKE_BIN}:${PATH}" \
IONICLINK_TEST_SSH_LOG="${LOG_FILE}" \
IONICLINK_HOST="deploy-test-host" \
IONICLINK_REMOTE_DIR="/tmp/ioniclink-test-repo" \
  "${ROOT_DIR}/scripts/deploy-server.sh" all-image >/dev/null

if ! grep -q "docker compose up -d --build" "${LOG_FILE}"; then
  echo "Expected all-image deploy to rebuild Docker images." >&2
  exit 1
fi
