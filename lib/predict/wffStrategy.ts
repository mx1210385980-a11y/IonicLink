import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeStrategyRequest, type WffStrategyRequest, type WffStrategyResult } from "./wffStrategy.shared";

export { normalizeStrategyRequest, type WffStrategyRequest, type WffStrategyResult } from "./wffStrategy.shared";

const execFileAsync = promisify(execFile);
const VENV_PYTHON = "/opt/wff-venv/bin/python";

function pythonCommand(): string {
  return fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3";
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function getWffStrategyCacheDir(root: string) {
  return process.env.WFF_STRATEGY_CACHE_DIR || path.join(root, "data", "wff-strategy-cache");
}

function cachePath(root: string, request: WffStrategyRequest) {
  const key = crypto.createHash("sha1").update(stableStringify(request)).digest("hex");
  return path.join(getWffStrategyCacheDir(root), `${key}.json`);
}

async function readCachedResult(root: string, request: WffStrategyRequest): Promise<WffStrategyResult | null> {
  try {
    return JSON.parse(await readFile(cachePath(root, request), "utf8")) as WffStrategyResult;
  } catch {
    return null;
  }
}

async function writeCachedResult(root: string, request: WffStrategyRequest, result: WffStrategyResult) {
  await mkdir(getWffStrategyCacheDir(root), { recursive: true });
  await writeFile(cachePath(root, request), JSON.stringify(result), "utf8");
}

export async function runWffStrategy(request: WffStrategyRequest, root = process.cwd()): Promise<WffStrategyResult> {
  const normalized = normalizeStrategyRequest(request);
  const cached = await readCachedResult(root, normalized);
  if (cached) return cached;
  const script = path.join(root, "scripts", "wff_paper_reproduction.py");
  const { stdout } = await execFileAsync(
    pythonCommand(),
    [
      script,
      "--root",
      root,
      "--mode",
      "model-strategy",
      "--strategy",
      normalized.strategy,
      "--strategy-options",
      JSON.stringify(normalized.options),
      "--json-only",
    ],
    { cwd: root, maxBuffer: 1024 * 1024 * 8 }
  );
  const result = JSON.parse(stdout) as WffStrategyResult;
  await writeCachedResult(root, normalized, result);
  return result;
}

export function streamWffStrategy(request: WffStrategyRequest, root = process.cwd()): ReadableStream<Uint8Array> {
  const normalized = normalizeStrategyRequest(request);
  const script = path.join(root, "scripts", "wff_paper_reproduction.py");
  const encoder = new TextEncoder();
  const eventChunk = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const cached = await readCachedResult(root, normalized);
      if (cached) {
        controller.enqueue(eventChunk("progress", { progress: 100, stage: "loaded from local cache", cached: true }));
        controller.enqueue(eventChunk("result", cached));
        controller.close();
        return;
      }
      let stdout = "";
      let stderrBuffer = "";
      const child = spawn(
        pythonCommand(),
        [
          script,
          "--root",
          root,
          "--mode",
          "model-strategy",
          "--strategy",
          normalized.strategy,
          "--strategy-options",
          JSON.stringify(normalized.options),
          "--json-only",
          "--progress",
        ],
        { cwd: root }
      );

      controller.enqueue(eventChunk("progress", { progress: 3, stage: "starting python" }));

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split(/\r?\n/);
        stderrBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as { type?: string };
            if (event.type === "progress") controller.enqueue(eventChunk("progress", event));
          } catch {
            controller.enqueue(eventChunk("log", { message: line }));
          }
        }
      });

      child.on("error", (error) => {
        controller.enqueue(eventChunk("error", { error: error.message }));
        controller.close();
      });

      child.on("close", (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout) as WffStrategyResult;
            void writeCachedResult(root, normalized, parsed);
            controller.enqueue(eventChunk("progress", { progress: 100, stage: "complete" }));
            controller.enqueue(eventChunk("result", parsed));
          } catch (error) {
            controller.enqueue(eventChunk("error", { error: error instanceof Error ? error.message : "Invalid model output" }));
          }
        } else {
          controller.enqueue(eventChunk("error", { error: `Model process exited with code ${code}` }));
        }
        controller.close();
      });
    },
  });
}
