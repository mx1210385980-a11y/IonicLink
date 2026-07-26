import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync("app/globals.css", "utf8");
const moleculeView = readFileSync("components/MoleculeView.tsx", "utf8");
const recordCard = readFileSync("components/RecordCard.tsx", "utf8");

assert.match(css, /@keyframes molecule-space-turn-anion/);
assert.match(css, /\.molecule-spin-anion\s*{[^}]*animation:\s*molecule-space-turn-anion/s);
assert.match(css, /molecule-space-turn-anion[\s\S]*scale\(1\.1[0-2]\)/);
assert.doesNotMatch(css, /molecule-space-turn-anion[\s\S]*scale\(1\.[3-9]/);
assert.match(moleculeView, /const drawWidth = isCation \? width : Math\.max\(width, 320\)/);
assert.match(moleculeView, /const drawHeight = isCation \? height : Math\.max\(height, 116\)/);
assert.doesNotMatch(moleculeView, /drawWidth \* pixelRatio/);
assert.doesNotMatch(moleculeView, /bondThickness: bondThickness \* pixelRatio/);
assert.match(moleculeView, /SmilesDrawer\.SvgDrawer/);
assert.match(moleculeView, /fontSizeLarge: atomFontSize/);
assert.match(css, /\.molecule-canvas\s+\.element\s*{[^}]*font-weight:\s*700/s);
assert.ok(
  recordCard.includes('<MoleculeView smiles={il.anionSmiles} ionLabel={anionLabel} kind="anion" label="Anion" width={320} height={116} />')
);

console.log("Molecule anion motion scale tests passed");
