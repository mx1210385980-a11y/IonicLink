import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const designPage = readFileSync("app/[domain]/design/page.tsx", "utf8");
assert.match(designPage, /redirect\("\/teaching#prediction"\)/);
assert.doesNotMatch(designPage, /<ModelPreview/);
assert.match(designPage, /params\.domain !== "tribology"/);

console.log("Legacy Design route redirects to teaching prediction");
