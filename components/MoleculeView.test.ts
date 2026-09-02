import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoleculeView } from "./MoleculeView";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const curated = renderToStaticMarkup(
  createElement(MoleculeView, {
    smiles: "C",
    ionLabel: "[BMIM]",
    kind: "cation",
    label: "Cation",
  }),
);
assert.match(curated, /data-ion-source="curated"/);
assert.match(curated, /data-smiles="CCCCn1cc\[n\+\]\(C\)c1"/);
assert.doesNotMatch(curated, /data-smiles="C"/, "curated identity overrides a conflicting extracted SMILES");

const iodide = renderToStaticMarkup(
  createElement(MoleculeView, { ionLabel: "[I]", kind: "anion", label: "Anion" }),
);
assert.match(iodide, /data-testid="monatomic-ion-anion"/);
assert.match(iodide, /aria-label="I− ion"/);

const unknown = renderToStaticMarkup(
  createElement(MoleculeView, { ionLabel: "[PET]", kind: "cation", label: "Cation" }),
);
assert.match(unknown, /data-ion-source="unresolved"/);
assert.match(unknown, /data-testid="unverified-structure-cation"/);
assert.match(unknown, /Structure not verified/);
assert.doesNotMatch(unknown, /molecule-placeholder/, "unknown ions must not receive an invented molecular skeleton");

console.log("MoleculeView structure-safety tests passed");
