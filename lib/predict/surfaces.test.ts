import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ---- source hygiene: this module must stay plain text, never contain NUL ---- */
{
  const source = readFileSync(new URL("./surfaces.ts", import.meta.url), "utf8");
  assert.equal(source.includes("\0"), false, "surfaces.ts must not contain a literal NUL byte");
}

console.log("predict/surfaces tests passed");
