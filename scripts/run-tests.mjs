import { existsSync, mkdtempSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const testFilePattern = /\.test\.(?:ts|tsx|mjs)$/;
const testRoots = ["app", "components", "lib", "scripts"];

function findTests(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findTests(fullPath));
    else if (entry.isFile() && testFilePattern.test(entry.name)) files.push(fullPath);
  }
  return files;
}

function resolveRequestedTests(requested) {
  if (!requested.length) return testRoots.flatMap((dir) => findTests(path.join(root, dir))).sort();

  return requested.map((input) => {
    const fullPath = path.resolve(root, input);
    if (!existsSync(fullPath) || !statSync(fullPath).isFile() || !testFilePattern.test(fullPath)) {
      throw new Error(`Expected a .test.ts, .test.tsx, or .test.mjs file: ${input}`);
    }
    return fullPath;
  });
}

const requested = process.argv.slice(2);
const tempRoot = mkdtempSync(path.join(tmpdir(), "ioniclink-tests-"));
let exitCode = 0;

try {
  const tests = resolveRequestedTests(requested);
  if (!tests.length) throw new Error("No test files found.");

  for (const [index, testFile] of tests.entries()) {
    const relative = path.relative(root, testFile);
    const dataDir = path.join(tempRoot, String(index));
    mkdirSync(dataDir, { recursive: true });
    console.log(`RUN ${relative}`);

    const result = spawnSync(process.execPath, [tsxCli, testFile], {
      cwd: root,
      env: {
        ...process.env,
        IONICLINK_DATA_DIR: dataDir,
        WFF_STRATEGY_CACHE_DIR: path.join(dataDir, "wff-strategy-cache"),
      },
      stdio: "inherit",
    });

    if (result.error) throw result.error;
    if (result.status !== 0) {
      exitCode = result.status ?? 1;
      break;
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3 });
}

process.exitCode = exitCode;
