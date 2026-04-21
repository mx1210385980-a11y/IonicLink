tell application "Terminal"
    activate

    do script "cd \"/Users/julyanffzz/项目/Ioniclink/backend\" && ./.venv/bin/uvicorn main:app --reload --host 127.0.0.1 --port 8000"

    delay 1

    do script "cd \"/Users/julyanffzz/项目/Ioniclink/frontend\" && env PATH=\"/Users/julyanffzz/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:$PATH\" \"/Users/julyanffzz/.local/share/pnpm/pnpm\" dev --host 127.0.0.1 --port 5173"
end tell
