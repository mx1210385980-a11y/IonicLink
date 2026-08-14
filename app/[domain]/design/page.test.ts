import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const designPage = readFileSync("app/[domain]/design/page.tsx", "utf8");
const legacyEvaluationPage = readFileSync("app/[domain]/design/evaluation/page.tsx", "utf8");

assert.match(designPage, /WffStrategyPanel/);
assert.doesNotMatch(designPage, /DesignStudio|listRecords|evaluationLabHref/);
assert.match(designPage, /params\.domain !== "tribology"/);
assert.match(legacyEvaluationPage, /redirect\(`\/\$\{params\.domain\}\/design`\)/);
assert.doesNotMatch(legacyEvaluationPage, /WffStrategyPanel/);

console.log("Design route renders the compact WFF strategy page");
