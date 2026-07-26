import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const [, , distDir, ...nextArgs] = process.argv;

if (!distDir || nextArgs.length === 0) {
  console.error("Usage: node scripts/next-with-dist-dir.mjs <distDir> <next args...>");
  process.exit(1);
}

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_DIST_DIR: distDir,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
