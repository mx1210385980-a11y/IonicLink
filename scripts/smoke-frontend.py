#!/usr/bin/env python3
"""Smoke test the deployed IonicLink frontend with a real browser.

The check is intentionally small and deployment-oriented:
- verify the backend health endpoint
- verify the compressed entry bundle is not a broken Vite intermediate artifact
- login through the public API and seed localStorage
- open core SPA routes and fail on blank pages or fatal console errors
"""

from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


DEFAULT_BASE_URL = os.getenv("IONICLINK_BASE_URL", "http://47.82.82.215")
DEFAULT_ROUTES = ["/pipeline", "/knowledge", "/review", "/modeling"]
DEFAULT_EXPECTED_TEXT = {
    "/pipeline": ["Literature Extraction", "Upload Document", "抽取"],
    "/knowledge": ["KNOWLEDGE", "宏观摩擦库", "数据浏览"],
    "/review": ["Review", "提取记录", "文献列表"],
    "/modeling": ["Modeling", "训练设置", "开始训练"],
    "/quality": ["Extraction Quality", "提取质量评估"],
    "/admin": ["ADMIN", "Runtime Monitor", "系统监控"],
}


@dataclass
class RouteResult:
    route: str
    status: int | None = None
    app_html_len: int = 0
    body_text_len: int = 0
    sample_text: str = ""
    errors: list[str] = field(default_factory=list)
    artifacts: list[Path] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a browser smoke test against the deployed IonicLink frontend.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"Target base URL. Default: {DEFAULT_BASE_URL}")
    parser.add_argument(
        "--routes",
        default=",".join(DEFAULT_ROUTES),
        help="Comma-separated SPA routes to verify. Default: /pipeline,/knowledge,/review,/modeling",
    )
    parser.add_argument("--username", default=os.getenv("IONICLINK_SMOKE_USERNAME", "admin"))
    parser.add_argument("--password", default=os.getenv("IONICLINK_SMOKE_PASSWORD", "ChangeMe123!"))
    parser.add_argument("--scope-key", default=os.getenv("IONICLINK_SMOKE_SCOPE_KEY", "group_library"))
    parser.add_argument("--timeout-ms", type=int, default=int(os.getenv("IONICLINK_SMOKE_TIMEOUT_MS", "45000")))
    parser.add_argument("--min-app-html", type=int, default=int(os.getenv("IONICLINK_SMOKE_MIN_APP_HTML", "8000")))
    parser.add_argument("--min-body-text", type=int, default=int(os.getenv("IONICLINK_SMOKE_MIN_BODY_TEXT", "200")))
    parser.add_argument("--headful", action="store_true", help="Open a visible browser for debugging.")
    parser.add_argument(
        "--screenshot-dir",
        default=os.getenv("IONICLINK_SMOKE_ARTIFACT_DIR", "artifacts/smoke-frontend"),
        help="Directory for failure screenshots and HTML snapshots.",
    )
    return parser.parse_args()


def normalize_base_url(value: str) -> str:
    return value.rstrip("/")


def request_json(url: str, timeout: int = 15) -> Any:
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def request_text(url: str, headers: dict[str, str] | None = None, timeout: int = 15) -> str:
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
        if response.headers.get("Content-Encoding", "").lower() == "gzip":
            payload = gzip.decompress(payload)
        return payload.decode("utf-8", errors="replace")


def login(base_url: str, username: str, password: str, timeout: int = 15) -> str:
    payload = json.dumps({"username": username, "password": password}).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/api/auth/login",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Login failed with HTTP {error.code}: {detail}") from error
    token = data.get("accessToken")
    if not token:
        raise RuntimeError("Login response did not include accessToken")
    return str(token)


def check_health(base_url: str) -> None:
    health = request_json(f"{base_url}/health")
    if health.get("status") != "healthy":
        raise RuntimeError(f"Unexpected health response: {health}")


def check_entry_bundle(base_url: str) -> str:
    html = request_text(f"{base_url}/", headers={"Cache-Control": "no-cache"})
    match = re.search(r'<script[^>]+src="([^"]+)"', html)
    if not match:
        raise RuntimeError("Could not find frontend entry script in index.html")

    entry_path = match.group(1)
    entry_url = entry_path if entry_path.startswith("http") else f"{base_url}{entry_path}"
    js = request_text(entry_url, headers={"Accept-Encoding": "gzip", "Cache-Control": "no-cache"})
    broken_markers = ["__VITE_PRELOAD__", "__vitePreload"]
    found = [marker for marker in broken_markers if marker in js]
    if found:
        raise RuntimeError(f"Entry bundle still contains broken Vite marker(s): {', '.join(found)}")
    return entry_path


def expected_text_for(route: str) -> list[str]:
    return DEFAULT_EXPECTED_TEXT.get(route, [])


def save_failure_artifacts(page: Any, route: str, screenshot_dir: Path) -> list[Path]:
    screenshot_dir.mkdir(parents=True, exist_ok=True)
    safe_name = route.strip("/").replace("/", "-") or "root"
    stamp = time.strftime("%Y%m%d-%H%M%S")
    screenshot_path = screenshot_dir / f"{stamp}-{safe_name}.png"
    html_path = screenshot_dir / f"{stamp}-{safe_name}.html"
    page.screenshot(path=str(screenshot_path), full_page=True)
    html_path.write_text(page.content(), encoding="utf-8")
    return [screenshot_path, html_path]


def run_browser_checks(args: argparse.Namespace, token: str) -> list[RouteResult]:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError as error:
        repo_root = Path(__file__).resolve().parents[1]
        venv_python = repo_root / "backend" / ".venv" / "bin" / "python"
        if (
            venv_python.exists()
            and Path(sys.executable).resolve() != venv_python.resolve()
            and os.getenv("IONICLINK_SMOKE_NO_REEXEC") != "1"
        ):
            env = os.environ.copy()
            env["IONICLINK_SMOKE_NO_REEXEC"] = "1"
            os.execve(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]], env)
        raise RuntimeError(
            "Playwright is not installed. Run: backend/.venv/bin/pip install -r backend/requirements.txt"
        ) from error

    base_url = normalize_base_url(args.base_url)
    routes = [route.strip() for route in args.routes.split(",") if route.strip()]
    screenshot_dir = Path(args.screenshot_dir)
    results: list[RouteResult] = []

    with sync_playwright() as playwright:
        try:
            browser = playwright.chromium.launch(headless=not args.headful)
        except Exception as error:
            raise RuntimeError(
                "Could not launch Chromium. Run: backend/.venv/bin/python -m playwright install chromium"
            ) from error

        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.goto(f"{base_url}/", wait_until="domcontentloaded", timeout=args.timeout_ms)
        page.evaluate(
            """({ token, scopeKey }) => {
              localStorage.setItem('ioniclink-access-token', token)
              localStorage.setItem('ioniclink-scope-key', scopeKey)
              sessionStorage.clear()
            }""",
            {"token": token, "scopeKey": args.scope_key},
        )

        for route in routes:
            result = RouteResult(route=route)
            console_errors: list[str] = []
            request_failures: list[str] = []

            def on_console(message: Any) -> None:
                if message.type == "error":
                    console_errors.append(message.text)

            def on_page_error(error: Exception) -> None:
                console_errors.append(str(error))

            def on_request_failed(request: Any) -> None:
                if request.resource_type in {"document", "script", "xhr", "fetch"}:
                    failure = request.failure or {}
                    request_failures.append(f"{request.resource_type} {request.url}: {failure}")

            page.on("console", on_console)
            page.on("pageerror", on_page_error)
            page.on("requestfailed", on_request_failed)

            try:
                response = page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=args.timeout_ms)
                page.wait_for_timeout(800)
                result.status = response.status if response else None
                result.app_html_len = int(page.locator("#app").evaluate("(el) => el.innerHTML.length"))
                body_text = page.locator("body").inner_text(timeout=5000)
                result.body_text_len = len(body_text)
                result.sample_text = " | ".join(body_text.splitlines())[:220]

                if result.status != 200:
                    result.errors.append(f"HTTP status is {result.status}, expected 200")
                if result.app_html_len < args.min_app_html:
                    result.errors.append(
                        f"#app HTML is too small ({result.app_html_len} < {args.min_app_html}); page may be blank"
                    )
                if result.body_text_len < args.min_body_text:
                    result.errors.append(
                        f"body text is too small ({result.body_text_len} < {args.min_body_text}); page may be blank"
                    )

                markers = expected_text_for(route)
                if markers and not any(marker in body_text for marker in markers):
                    result.errors.append(f"missing expected text marker for {route}: one of {markers}")
                if console_errors:
                    result.errors.extend([f"console/page error: {item}" for item in console_errors])
                if request_failures:
                    result.errors.extend([f"request failed: {item}" for item in request_failures])
            except Exception as error:
                result.errors.append(f"route check crashed: {error}")
            finally:
                page.remove_listener("console", on_console)
                page.remove_listener("pageerror", on_page_error)
                page.remove_listener("requestfailed", on_request_failed)

            if result.errors:
                try:
                    result.artifacts = save_failure_artifacts(page, route, screenshot_dir)
                except Exception as artifact_error:
                    result.errors.append(f"failed to save artifacts: {artifact_error}")

            results.append(result)

        browser.close()

    return results


def print_results(base_url: str, entry_path: str, results: list[RouteResult]) -> None:
    print(f"Smoke target: {base_url}")
    print(f"Entry bundle: {entry_path}")
    for result in results:
        label = "PASS" if result.ok else "FAIL"
        print(
            f"[{label}] {result.route} status={result.status} "
            f"app_html={result.app_html_len} body_text={result.body_text_len}"
        )
        if result.sample_text:
            print(f"      {result.sample_text}")
        for error in result.errors:
            print(f"      - {error}")
        if result.artifacts:
            print("      artifacts:")
            for path in result.artifacts:
                print(f"      - {path}")


def main() -> int:
    args = parse_args()
    base_url = normalize_base_url(args.base_url)

    try:
        check_health(base_url)
        entry_path = check_entry_bundle(base_url)
        token = login(base_url, args.username, args.password)
        results = run_browser_checks(args, token)
        print_results(base_url, entry_path, results)
    except Exception as error:
        print(f"[FAIL] smoke setup failed: {error}", file=sys.stderr)
        return 2

    if any(not result.ok for result in results):
        return 1
    print("[PASS] frontend smoke test completed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
