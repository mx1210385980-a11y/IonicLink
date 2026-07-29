#!/usr/bin/env bash
set -euo pipefail

SHARD_INDEX="${1:-}"
if [[ "$SHARD_INDEX" != "0" && "$SHARD_INDEX" != "1" && "$SHARD_INDEX" != "2" ]]; then
  echo "Usage: bash scripts/run-wff-cache-shard.sh 0|1|2"
  exit 1
fi

SHARD_COUNT="${WFF_SHARD_COUNT:-3}"
FIXED_Q1="${WFF_FIXED_Q1:-34}"
FIXED_Q2="${WFF_FIXED_Q2:-84}"
SERVER_URL="${WFF_PREWARM_SERVER_URL:-http://127.0.0.1:8080}"
CONCURRENCY="${WFF_PREWARM_CONCURRENCY:-1}"
CACHE_DIR="data/wff-strategy-cache"
LOG_FILE="${CACHE_DIR}/prewarm-shard-${SHARD_INDEX}.log"
PACKAGE_FILE="wff-strategy-cache-shard-${SHARD_INDEX}.tar.gz"

mkdir -p "$CACHE_DIR"

echo "Starting Ioniclink service with Docker..."
docker compose -f docker-compose.prod.yml up -d --build

echo "Waiting for ${SERVER_URL} ..."
for attempt in $(seq 1 60); do
  if curl -fsS "${SERVER_URL}/tribology/design/evaluation" >/dev/null; then
    break
  fi
  if [[ "$attempt" == "60" ]]; then
    echo "Server did not become ready at ${SERVER_URL}."
    exit 1
  fi
  sleep 2
done

echo "Running shard ${SHARD_INDEX}/${SHARD_COUNT} with q1=${FIXED_Q1}, q2=${FIXED_Q2}."
node scripts/prewarm-wff-strategy-cache.mjs \
  --student-grid \
  --independent-region-grid \
  --fixed-q1="${FIXED_Q1}" \
  --fixed-q2="${FIXED_Q2}" \
  --shard-count="${SHARD_COUNT}" \
  --shard-index="${SHARD_INDEX}" \
  --server-url="${SERVER_URL}" \
  --concurrency="${CONCURRENCY}" 2>&1 | tee "$LOG_FILE"

echo "Packaging cache into ${PACKAGE_FILE} ..."
tar -czf "$PACKAGE_FILE" -C data wff-strategy-cache
echo "Done. Send ${PACKAGE_FILE} back to Julyan."
