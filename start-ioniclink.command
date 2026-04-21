#!/bin/zsh

set -euo pipefail

PROJECT_ROOT="/Users/julyanffzz/项目/Ioniclink"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
NODE_BIN="/Users/julyanffzz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
PNPM_BIN="/Users/julyanffzz/.local/share/pnpm/pnpm"

osascript <<EOF
tell application "Terminal"
    activate

    do script "cd \"$BACKEND_DIR\" && ./.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000"

    delay 1

    do script "cd \"$FRONTEND_DIR\" && env PATH=\"$NODE_BIN:\$PATH\" \"$PNPM_BIN\" dev --host 127.0.0.1 --port 5173"
end tell
EOF
