import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConductivityCard } from "./ConductivityCard";
import { ingest } from "@/lib/conductivity/ingest";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const draft = ingest({
  paper: { title: "Test conductivity paper" },
  cation: "[BMIM]",
  anion: "[BF4]",
  surface: "Pt",
  temperature: "298.15 K",
  conductivity: "3.5 mS/cm",
  method: "EIS",
  viscosity: "104 cP",
});
const record = { ...draft, id: "#001", status: "official" as const, createdAt: "" };
record.flexible = [{ key: "instrument note", value: "kept as flexible context" }];

const html = renderToStaticMarkup(createElement(ConductivityCard, { record }));

// σ readout renders the reported value + label
assert.match(html, /3\.5 mS\/cm/);
assert.match(html, /Ionic conductivity/);
// the ionic-identity section is reused from the shared parts
assert.match(html, /data-testid="ionic-liquid-panel"/);
assert.match(html, /\[BMIM\]/);
// the electrochemical zone shows surface + method
assert.match(html, /data-testid="cell-panel"/);
assert.match(html, /Pt/);
assert.match(html, /EIS/);
// friction visuals must NOT leak into the conductivity card
assert.doesNotMatch(html, /afm-probe-illustration/);
assert.doesNotMatch(html, /Coefficient of friction/);
// official records keep flexible/raw context collapsed by default
assert.match(html, /data-testid="raw-flexible-panel"/);
assert.match(html, /aria-expanded="false"/);
assert.doesNotMatch(html, /kept as flexible context/);

console.log("ConductivityCard tests passed");
