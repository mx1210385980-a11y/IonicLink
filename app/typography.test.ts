import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const layout = readFileSync("app/layout.tsx", "utf8");
const tailwind = readFileSync("tailwind.config.ts", "utf8");

assert.doesNotMatch(layout, /next\/font\/google/);
assert.doesNotMatch(layout, /IBM_Plex/);
assert.doesNotMatch(layout, /--font-(sans|mono|serif)/);

assert.match(tailwind, /sans:\s*\["ui-sans-serif", "system-ui", "sans-serif"\]/);
assert.match(tailwind, /mono:\s*\["ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"\]/);
assert.match(tailwind, /serif:\s*\["ui-serif", "Georgia", "Cambria", '"Times New Roman"', "serif"\]/);

console.log("Typography system font tests passed");
