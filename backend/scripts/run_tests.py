from __future__ import annotations

import importlib.util
import subprocess
import sys


def main() -> int:
    command = [sys.executable, "-m", "pytest"]

    if importlib.util.find_spec("pytest_cov") is not None:
        command.extend(
            [
                "--cov=backend",
                "--cov-report=term-missing",
                "--cov-report=xml",
                "--cov-report=html",
            ]
        )
    else:
        print("[test runner] pytest-cov not available in the active interpreter; running without coverage.")

    command.extend(sys.argv[1:])
    return subprocess.call(command)


if __name__ == "__main__":
    raise SystemExit(main())
