import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  afmProbeDisplay,
  buildConditionItems,
  RecordCard,
  tribopairMaterialDisplay,
  tribopairRoughnessDisplay,
  type UnitMode,
} from "./RecordCard";
import { parseQuantity } from "../lib/units";
import type { IonicRecord } from "../lib/schema";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

assert.deepEqual(afmProbeDisplay("silicon nitride", "Tip · 2 nm"), {
  material: "silicon nitride",
  shape: "Tip",
  radius: "2 nm",
});
assert.deepEqual(afmProbeDisplay("silica", "Colloid · Ø 5 µm"), {
  material: "silica",
  shape: "Colloid",
  radius: "≈2.5 µm (from Ø 5 µm)",
});
assert.deepEqual(afmProbeDisplay("silica", "Colloid · radius 4.4 ± 0.4 µm"), {
  material: "silica",
  shape: "Colloid",
  radius: "4.4 ± 0.4 µm",
});
assert.deepEqual(afmProbeDisplay("silica", "Colloid · Ø 8.8 ± 0.8 µm"), {
  material: "silica",
  shape: "Colloid",
  radius: "≈4.4 ± 0.4 µm (from Ø 8.8 ± 0.8 µm)",
});
assert.deepEqual(afmProbeDisplay("silicon (NSC36, Micromasch)", "sharp AFM tip"), {
  material: "silicon",
  shape: "sharp AFM tip",
  radius: "—",
});

assert.deepEqual(tribopairMaterialDisplay("silica (SiO2)"), {
  formula: "SiO₂",
  family: "Silica",
  tone: "cyan",
});
assert.deepEqual(tribopairMaterialDisplay("alumina (Al2O3)"), {
  formula: "Al₂O₃",
  family: "Oxide ceramic",
  tone: "amber",
});
assert.deepEqual(tribopairMaterialDisplay("PTFE surface"), {
  formula: "PTFE",
  family: "Fluoropolymer",
  tone: "violet",
});

const pairedRoughness = parseQuantity("7 ± 1 nm (surface); 17 ± 3 nm (probe)", "length") ?? undefined;
assert.deepEqual(tribopairRoughnessDisplay(pairedRoughness, "raw"), {
  probe: "17 ± 3 nm",
  substrate: "7 ± 1 nm",
});
const surfaceOnlyRoughness = parseQuantity("0.60 ± 0.04 nm", "length") ?? undefined;
assert.deepEqual(tribopairRoughnessDisplay(surfaceOnlyRoughness, "raw"), {
  substrate: "0.60 ± 0.04 nm",
});

function makeRecord(): IonicRecord {
  return {
    id: "R-001",
    status: "review",
    confidence: 0.82,
    createdAt: "2026-06-08T00:00:00.000Z",
    paper: { title: "Test paper" },
    core: {
      ionicLiquid: {
        cation: "[BMIM]",
        anion: "[PF6]",
      },
      substrate: "graphite",
      temperature: parseQuantity("25 °C", "temperature"),
      load: parseQuantity("5 nN", "force"),
      cof: 0.083,
    },
    extended: {
      scale: "nano",
      method: "AFM",
      cofMethod: "slope of friction force vs normal load fitting line (Amontons’ law)",
      probe: "silicon nitride",
      probeType: "Tip · 2 nm",
      velocity: parseQuantity("2 µm/s", "velocity") ?? undefined,
      potential: parseQuantity("+0.5 V", "potential") ?? undefined,
      roughness: parseQuantity("~0.1 nm", "length") ?? undefined,
      additives: "water trace",
      afm: {
        scanRate: "1 Hz",
        scanSize: "2 µm",
      },
      surface: {
        surfaceEnergy: parseQuantity("55 mJ/m2", "surfaceEnergy") ?? undefined,
        surfaceChargeDensity: parseQuantity("0 C/m2", "surfaceChargeDensity") ?? undefined,
        contactAngle: parseQuantity("75°", "angle") ?? undefined,
        materialClass: "carbon",
        plane: "(0001)",
        conductor: true,
        layered: true,
      },
    },
    flexible: [],
    provenance: {
      surfaceEnergy: {
        basis: "direct",
        page: 4,
        quote: "The surface energy was 55 mJ/m2.",
      },
    },
  };
}

function labelsFor(units: UnitMode) {
  return buildConditionItems(makeRecord(), units).map((item) => `${item.label}:${item.value}`);
}

assert.deepEqual(labelsFor("raw"), [
  "Load:5 nN",
  "Temp:25 °C",
  "Velocity:2 µm/s",
  "Potential:+0.5 V",
  "Additives:water trace",
]);

assert.deepEqual(labelsFor("std"), [
  "Load:5 nN",
  "Temp:298.1 K",
  "Velocity:2 µm/s",
  "Potential:0.5 V",
  "Additives:water trace",
]);

console.log("RecordCard condition mapping tests passed");

const visualFigureRecord = makeRecord();
visualFigureRecord.flexible = [
  { key: "medium", value: "EAN", note: "Legend series in Fig. 3b." },
  { key: "cof_uncertainty", value: "±0.02", note: "Estimated from the plotted error bar." },
];
const visualFigureConditions = buildConditionItems(visualFigureRecord, "raw");
assert.ok(
  visualFigureConditions.some((item) => item.label === "Environment" && item.value === "EAN"),
  "the data-list condition chips expose the figure legend environment",
);
const visualFigureHtml = renderToStaticMarkup(createElement(RecordCard, { record: visualFigureRecord }));
assert.match(
  visualFigureHtml,
  /data-ui="cof-summary"[\s\S]*?0\.0830[\s\S]*?±0\.02/,
  "the data-list COF summary keeps the extracted uncertainty beside the value",
);

console.log("RecordCard visual environment and COF uncertainty tests passed");

const materialContrastRecord = makeRecord();
materialContrastRecord.extended.probe = "silica";
materialContrastRecord.extended.probeType = "Colloid · radius 4.4 ± 0.4 µm";
materialContrastRecord.core.substrate = "PTFE surface";
const materialContrastHtml = renderToStaticMarkup(createElement(RecordCard, { record: materialContrastRecord }));
assert.doesNotMatch(materialContrastHtml, /data-testid="material-signature"/);

console.log("RecordCard tribopair material contrast tests passed");

const rangeLoadRecord = makeRecord();
rangeLoadRecord.core.load = parseQuantity("15-30n N", "force");
const rangeLoadItem = buildConditionItems(rangeLoadRecord, "std").find((item) => item.label === "Load");
assert.equal(rangeLoadItem?.value, "15-30 nN");
assert.equal(rangeLoadItem?.variant, "range");

const rangeLoadHtml = renderToStaticMarkup(createElement(RecordCard, { record: rangeLoadRecord, units: "std" }));
assert.match(rangeLoadHtml, /data-testid="condition-range-chip"/);
assert.match(rangeLoadHtml, /aria-label="15-30 nN"/);
assert.match(rangeLoadHtml, />15<\/span>/);
assert.match(rangeLoadHtml, />-<\/span>/);
assert.match(rangeLoadHtml, />30<\/span>/);
assert.match(rangeLoadHtml, />nN<\/span>/);
assert.doesNotMatch(rangeLoadHtml, /≈30 nN/);

console.log("RecordCard condition range display tests passed");

const flexibleRecord = makeRecord();
flexibleRecord.flexible = [
  {
    key: "IL film preparation",
    value:
      "10-3 mL of ILs/mL of acetone; 1 µL deposited onto graphite substrate (area = 1 cm2), acetone evaporated under vacuum at 35 °C for 12 h",
  },
  { key: "atmosphere", value: "ambient conditions" },
];

const html = renderToStaticMarkup(createElement(RecordCard, { record: flexibleRecord }));
assert.doesNotMatch(html, /data-testid="raw-flexible-panel"/);
assert.doesNotMatch(html, /IL film preparation/);
assert.doesNotMatch(html, /ambient conditions/);

const officialFlexibleRecord = makeRecord();
officialFlexibleRecord.status = "official";
officialFlexibleRecord.flexible = flexibleRecord.flexible;
const officialFlexibleHtml = renderToStaticMarkup(createElement(RecordCard, { record: officialFlexibleRecord }));
assert.doesNotMatch(officialFlexibleHtml, /data-testid="raw-flexible-panel"/);
assert.doesNotMatch(officialFlexibleHtml, /IL film preparation/);
assert.doesNotMatch(officialFlexibleHtml, /ambient conditions/);

console.log("RecordCard flexible layout tests passed");

const reviewHtml = renderToStaticMarkup(createElement(RecordCard, { record: makeRecord() }));
assert.match(reviewHtml, /conf 82%/);

const reviewActionsHtml = renderToStaticMarkup(
  createElement(RecordCard, {
    record: makeRecord(),
    actions: createElement("button", null, "Edit"),
  }),
);
assert.doesNotMatch(reviewActionsHtml, /core complete/);
assert.match(reviewActionsHtml, />Edit<\/button>/);

const officialRecord = makeRecord();
officialRecord.status = "official";
const officialHtml = renderToStaticMarkup(createElement(RecordCard, { record: officialRecord }));
assert.doesNotMatch(officialHtml, /conf 82%/);
assert.match(officialHtml, />checked</);
assert.doesNotMatch(officialHtml, />official</);
assert.match(officialHtml, /record-card-unified-text/);

console.log("RecordCard confidence visibility tests passed");

const provenanceBadgeRecord = makeRecord();
provenanceBadgeRecord.provenance = {
  substrate: {
    page: 2,
    quote: "The highly oriented pyrolytic graphite was purchased from Mikromasch.",
  },
};
const provenanceBadgeHtml = renderToStaticMarkup(createElement(RecordCard, { record: provenanceBadgeRecord }));
assert.doesNotMatch(provenanceBadgeHtml, /data-testid="prov-badge"/);
assert.doesNotMatch(provenanceBadgeHtml, /data-testid="prov-badge-preview"/);
assert.match(provenanceBadgeHtml, /data-testid="evidence-click-target"/);
assert.match(provenanceBadgeHtml, /aria-label="Open evidence for substrate"/);
assert.match(provenanceBadgeHtml, /title="graphite · evidence available"/);
assert.doesNotMatch(provenanceBadgeHtml, /title="source/);

console.log("RecordCard evidence click-target display tests passed");

const compactHtml = renderToStaticMarkup(createElement(RecordCard, { record: makeRecord() }));
assert.match(compactHtml, /items-start/);
assert.match(compactHtml, /xl:grid-cols-\[auto_minmax\(0,0\.84fr\)_minmax\(0,1\.05fr\)_minmax\(0,1\.28fr\)\]/);
assert.match(compactHtml, /data-testid="ionic-liquid-panel"/);
assert.match(compactHtml, /data-testid="ion-row"/);
assert.match(compactHtml, /data-testid="ion-pill-cation"/);
assert.match(compactHtml, /data-testid="ion-pill-anion"/);
assert.match(compactHtml, /data-testid="ion-stack-cation"[^>]*border-cyan-100/);
assert.match(compactHtml, /data-testid="ion-stack-anion"[^>]*border-emerald-100/);
assert.match(compactHtml, /data-testid="ion-pill-cation"[^>]*rounded-none/);
assert.match(compactHtml, /data-testid="ion-pill-anion"[^>]*rounded-none/);
assert.match(compactHtml, /data-testid="molecule-view-cation"/);
assert.match(compactHtml, /data-testid="molecule-view-anion"/);
assert.match(compactHtml, /data-testid="molecule-view-cation"[^>]*rounded-none/);
assert.match(compactHtml, /data-testid="molecule-view-anion"[^>]*rounded-none/);
assert.match(compactHtml, /data-testid="molecule-name-cation"[^>]*>1-butyl-3-methylimidazolium</);
assert.match(compactHtml, /data-testid="molecule-name-anion"[^>]*>hexafluorophosphate</);
assert.doesNotMatch(compactHtml, /label-eyebrow[^>]*>Cation<\/span>/);
assert.doesNotMatch(compactHtml, /label-eyebrow[^>]*>Anion<\/span>/);
assert.match(compactHtml, /xl:grid-cols-2/);
assert.doesNotMatch(compactHtml, /data-testid="ion-orbit-cation"/);
assert.doesNotMatch(compactHtml, /data-testid="ion-orbit-anion"/);
assert.match(compactHtml, /data-testid="molecule-spin-stage-cation"/);
assert.match(compactHtml, /data-testid="molecule-spin-stage-anion"/);
assert.match(compactHtml, /molecule-spin-cation/);
assert.match(compactHtml, /molecule-spin-anion/);
assert.match(compactHtml, /data-testid="molecule-view-anion"[^>]*style="--molecule-view-height:116px"/);
assert.match(compactHtml, /data-testid="tribopair-panel"/);
assert.doesNotMatch(compactHtml, /data-testid="tribopair-fact-row"/);
assert.match(compactHtml, /data-testid="tribopair-contact-strip"/);
assert.match(compactHtml, /data-testid="tribopair-contact-stack"/);
assert.doesNotMatch(compactHtml, /data-testid="tribopair-contact-state"/);
assert.match(compactHtml, /data-ui="cof-summary"/);
assert.match(compactHtml, /border-cyan-100 bg-gradient-to-br from-white to-cyan-50\/45/);
assert.doesNotMatch(compactHtml, /low friction|moderate|high friction/);
assert.doesNotMatch(compactHtml, /slope of friction force vs normal load fitting line/);
assert.doesNotMatch(compactHtml, /from-ink-900 to-ink-800/);
assert.doesNotMatch(compactHtml, /transition-\[width\]/);
assert.match(compactHtml, /Reported Conditions/);
assert.doesNotMatch(compactHtml, /sm:grid-cols-\[minmax\(0,1fr\)_auto_minmax\(0,1fr\)\]/);
assert.doesNotMatch(compactHtml, /sm:grid-cols-3/);
assert.doesNotMatch(compactHtml, /data-testid="contact-fingerprint"/);
assert.equal((compactHtml.match(/data-testid="tribopair-inline-spec"/g) ?? []).length, 2);
assert.doesNotMatch(compactHtml, /data-testid="tribopair-primary-pair"/);
assert.doesNotMatch(compactHtml, /data-testid="tribopair-spec-item"/);
assert.doesNotMatch(compactHtml, /data-testid="prov-badge"/);
assert.doesNotMatch(compactHtml, /<span class="grid h-5 w-5[^"]*">1<\/span>/);
assert.doesNotMatch(compactHtml, /<span class="grid h-5 w-5[^"]*">2<\/span>/);
assert.doesNotMatch(compactHtml, /<span class="grid h-5 w-5[^"]*">3<\/span>/);
assert.match(compactHtml, />AFM</);
assert.equal((compactHtml.match(/data-testid="afm-probe-row"/g) ?? []).length, 1);
assert.equal((compactHtml.match(/data-testid="afm-probe-subfield"/g) ?? []).length, 3);
assert.match(compactHtml, />Probe</);
assert.match(compactHtml, />Material</);
assert.match(compactHtml, />Shape</);
assert.match(compactHtml, />Radius</);
assert.match(compactHtml, />silicon nitride</);
assert.match(compactHtml, />Tip</);
assert.match(compactHtml, />2 nm</);
assert.match(compactHtml, />Substrate</);
assert.match(compactHtml, /data-testid="linked-rq-substrate"/);
assert.match(compactHtml, /Substrate Root Mean Square Roughness \(Rq\): ~0\.1 nm/);
assert.match(compactHtml, />Roughness \(Rq\)</);
assert.doesNotMatch(compactHtml, /data-testid="linked-rq-probe"/);
assert.doesNotMatch(compactHtml, />Rq roughness</);
assert.doesNotMatch(compactHtml, /data-testid="tribopair-panel"[^>]*items-stretch/);
assert.match(compactHtml, /0\.1 nm/);
assert.doesNotMatch(compactHtml, />Method</);
assert.equal((compactHtml.match(/>Load</g) ?? []).length, 1);
assert.equal((compactHtml.match(/>Velocity</g) ?? []).length, 1);
assert.match(compactHtml, /γs · Surface energy/);
assert.match(compactHtml, /σs · Surface charge/);
assert.match(compactHtml, /θs · Contact angle/);
assert.doesNotMatch(compactHtml, /data-testid="condition-fingerprint"/);
assert.doesNotMatch(compactHtml, /Load axis/);
assert.doesNotMatch(compactHtml, /Speed axis/);
assert.doesNotMatch(compactHtml, /Experiment fingerprint/);
assert.doesNotMatch(compactHtml, /data-testid="surface-descriptors"/);
assert.doesNotMatch(compactHtml, /γ_s/);
assert.doesNotMatch(compactHtml, /σ_s/);
assert.doesNotMatch(compactHtml, /θ_s/);
assert.doesNotMatch(compactHtml, /\(0001\)/);
assert.doesNotMatch(compactHtml, /data-testid="afm-params"/);
assert.doesNotMatch(compactHtml, /AFM params/);
assert.doesNotMatch(compactHtml, /ḟ/);
assert.doesNotMatch(compactHtml, /1 Hz/);
assert.match(compactHtml, /xl:border-l/);
assert.match(compactHtml, /lg:grid-cols-3/);
assert.doesNotMatch(compactHtml, /Probe -&gt; Substrate/);
assert.match(compactHtml, /data-testid="afm-probe-illustration"/);
assert.match(compactHtml, /h-16 w-10/);
assert.match(compactHtml, /M29 44H57L43 88Z/);

console.log("RecordCard compact layout visual tests passed");

const pairedRoughnessRecord = makeRecord();
pairedRoughnessRecord.extended.roughness = pairedRoughness;
pairedRoughnessRecord.provenance = {
  ...pairedRoughnessRecord.provenance,
  roughness: { page: 4, quote: "7 ± 1 nm (surface); 17 ± 3 nm (probe)" },
};
const pairedRoughnessHtml = renderToStaticMarkup(createElement(RecordCard, { record: pairedRoughnessRecord }));
assert.match(pairedRoughnessHtml, /data-testid="linked-rq-probe"[^>]*>[\s\S]*?17 ± 3 nm/);
assert.match(pairedRoughnessHtml, /data-testid="linked-rq-substrate"[^>]*>[\s\S]*?7 ± 1 nm/);
assert.equal((pairedRoughnessHtml.match(/>Roughness \(Rq\)</g) ?? []).length, 2);
assert.equal((pairedRoughnessHtml.match(/text-\[13px\]/g) ?? []).length, 2);
assert.doesNotMatch(pairedRoughnessHtml, />Rq roughness</);

console.log("RecordCard linked probe\/substrate roughness tests passed");

const fullTribopairHtml = renderToStaticMarkup(
  createElement(RecordCard, {
    record: {
      ...makeRecord(),
      core: { ...makeRecord().core, substrate: "highly oriented pyrolytic graphite" },
      extended: {
        ...makeRecord().extended,
        probe: "silicon nitride (SNL, Bruker)",
        probeType: "Tip · 2 nm",
        method: "AFM friction force measurements in contact mode",
      },
    },
  }),
);
assert.match(fullTribopairHtml, />Material</);
assert.match(fullTribopairHtml, />silicon nitride</);
assert.doesNotMatch(fullTribopairHtml, />silicon nitride \(SNL, Bruker\)</);
assert.doesNotMatch(fullTribopairHtml, /role="tooltip"/);
assert.match(fullTribopairHtml, />Shape</);
assert.match(fullTribopairHtml, />Tip</);
assert.match(fullTribopairHtml, />Radius</);
assert.match(fullTribopairHtml, />2 nm</);
assert.match(fullTribopairHtml, /highly oriented pyrolytic graphite/);
assert.doesNotMatch(fullTribopairHtml, /AFM friction force measurements in contact mode/);
assert.doesNotMatch(fullTribopairHtml, /data-testid="tribopair-contact-value"[^>]*truncate/);
assert.doesNotMatch(fullTribopairHtml, /data-testid="tribopair-inline-spec"[^>]*truncate/);

console.log("RecordCard full tribopair field display tests passed");

const sfaRecord = makeRecord();
sfaRecord.core.substrate = "mica";
sfaRecord.extended = {
  ...sfaRecord.extended,
  scale: "nano",
  method: "Surface Force Balance (SFB)",
  probe: "mica",
  probeType: "SFA surface",
  afm: undefined,
};
const sfaHtml = renderToStaticMarkup(createElement(RecordCard, { record: sfaRecord }));
assert.match(sfaHtml, /data-testid="sfa-illustration"/);
assert.match(sfaHtml, />SFA</);
assert.match(sfaHtml, />Surface 1</);
assert.match(sfaHtml, />Surface 2</);
assert.doesNotMatch(sfaHtml, /data-testid="afm-probe-illustration"/);

console.log("RecordCard SFA instrument display tests passed");

const macroTribometerRecord = makeRecord();
macroTribometerRecord.core.substrate = "stainless steel disc";
macroTribometerRecord.extended = {
  ...macroTribometerRecord.extended,
  scale: "macro",
  method: "rheometer with a 3-ball on plate contact",
  probe: "stainless steel (Grade 440c)",
  probeType: "3-ball on plate · 7.94 mm",
  afm: undefined,
};
const macroTribometerHtml = renderToStaticMarkup(createElement(RecordCard, { record: macroTribometerRecord }));
assert.match(macroTribometerHtml, /data-testid="macro-tribometer-illustration"/);
assert.match(macroTribometerHtml, /data-pattern="three-ball-plate"/);
assert.doesNotMatch(macroTribometerHtml, /data-testid="afm-probe-illustration"/);
assert.match(macroTribometerHtml, />TRIBO</);
assert.match(macroTribometerHtml, />Probe</);
assert.match(macroTribometerHtml, />Substrate</);

console.log("RecordCard macro tribometer display tests passed");

const standardizedIonRecord = makeRecord();
standardizedIonRecord.core.ionicLiquid = {
  cation: "[BMIM]",
  anion: "[PF6]",
};
const rawIonHtml = renderToStaticMarkup(createElement(RecordCard, { record: standardizedIonRecord, units: "raw" }));
assert.match(rawIonHtml, />\[BMIM\]</);
assert.match(rawIonHtml, />\[PF6\]</);
const standardizedIonHtml = renderToStaticMarkup(createElement(RecordCard, { record: standardizedIonRecord, units: "std" }));
assert.match(standardizedIonHtml, /Standardized Conditions/);
assert.match(standardizedIonHtml, />\[C<sub[^>]*>4<\/sub>MIM\]</);
assert.match(standardizedIonHtml, />\[PF<sub[^>]*>6<\/sub>\]</);
assert.doesNotMatch(standardizedIonHtml, />\[BMIM\]</);
assert.doesNotMatch(standardizedIonHtml, />\[PF6\]</);

const compactSubscriptRecord = makeRecord();
compactSubscriptRecord.core.ionicLiquid = {
  cation: "[N88812]",
  anion: "[A12BMB]",
};
const compactSubscriptHtml = renderToStaticMarkup(createElement(RecordCard, { record: compactSubscriptRecord, units: "std" }));
assert.match(compactSubscriptHtml, />\[N<sub[^>]*>8,8,8,12<\/sub>\]</);
assert.match(compactSubscriptHtml, />\[A<sub[^>]*>12<\/sub>BMB\]</);

const branchedAnionRecord = makeRecord();
branchedAnionRecord.core.ionicLiquid.anion = "[(iC8)2PO2]";
const branchedAnionHtml = renderToStaticMarkup(createElement(RecordCard, { record: branchedAnionRecord, units: "std" }));
assert.match(branchedAnionHtml, /\(<sup[^>]*>i<\/sup>C<sub[^>]*>8<\/sub>\)<sub[^>]*>2<\/sub>PO<sub[^>]*>2<\/sub>/);
assert.match(branchedAnionHtml, /data-smiles="[^"]*P\(=O\)\(\[O-\]\)/);

const dehpAnionRecord = makeRecord();
dehpAnionRecord.core.ionicLiquid.anion = "[DEHP]";
const dehpAnionHtml = renderToStaticMarkup(createElement(RecordCard, { record: dehpAnionRecord, units: "std" }));
assert.match(dehpAnionHtml, />\[DEHP\]</);
assert.match(dehpAnionHtml, /data-smiles="[^"]*P\(=O\)\(\[O-\]\)/);
assert.doesNotMatch(dehpAnionHtml, />label only</);

console.log("RecordCard standardized ion label tests passed");

const squareScanRecord = makeRecord();
squareScanRecord.extended.afm = { scanRate: "2 Hz", scanSize: "2 µm × 2 µm" };
const squareScanHtml = renderToStaticMarkup(createElement(RecordCard, { record: squareScanRecord }));
assert.doesNotMatch(squareScanHtml, /data-testid="afm-params"/);
assert.doesNotMatch(squareScanHtml, /title="AFM scan size: 2 µm × 2 µm"/);
assert.doesNotMatch(squareScanHtml, />2 µm × 2 µm<\/span>/);

const asciiSquareScanRecord = makeRecord();
asciiSquareScanRecord.extended.afm = { scanRate: "2 Hz", scanSize: "2 x 2 um" };
const asciiSquareScanHtml = renderToStaticMarkup(createElement(RecordCard, { record: asciiSquareScanRecord }));
assert.doesNotMatch(asciiSquareScanHtml, /data-testid="afm-params"/);
assert.doesNotMatch(asciiSquareScanHtml, />2 µm<\/span>/);

console.log("RecordCard AFM params hiding tests passed");

const probeProvRecord = makeRecord();
probeProvRecord.sourceId = "src-test";
probeProvRecord.provenance = {
  probe: { page: 2, quote: "The SNL probes (silicon nitride, radius of 2 nm) for friction measurements were from Bruker." },
};
const probeProvHtml = renderToStaticMarkup(createElement(RecordCard, { record: probeProvRecord }));
assert.match(probeProvHtml, /data-testid="evidence-click-target"/, "probe provenance makes the value card clickable");
assert.match(probeProvHtml, /aria-label="Open evidence for probe"/);
assert.doesNotMatch(probeProvHtml, />p\.2<\/button>/);
const noProvHtml = renderToStaticMarkup(createElement(RecordCard, { record: makeRecord() }));
assert.doesNotMatch(noProvHtml, /aria-label="Open evidence for probe"/, "no evidence target without probe provenance");

console.log("RecordCard probe evidence target tests passed");

const inferredStructureRecord = makeRecord();
inferredStructureRecord.core.ionicLiquid = {
  cation: "[EMIM]",
  anion: "[PF6]",
};
const inferredHtml = renderToStaticMarkup(createElement(RecordCard, { record: inferredStructureRecord }));
assert.match(inferredHtml, /data-smiles="CCn1cc\[n\+\]\(C\)c1"/);
assert.match(inferredHtml, /data-smiles="\[P-\]\(F\)\(F\)\(F\)\(F\)\(F\)F"/);

console.log("RecordCard inferred ion structure tests passed");

const ethylammoniumStructureRecord = makeRecord();
ethylammoniumStructureRecord.core.ionicLiquid = {
  cation: "[EtNH3]",
  anion: "[NO3]",
};
const ethylammoniumHtml = renderToStaticMarkup(createElement(RecordCard, { record: ethylammoniumStructureRecord }));
assert.match(ethylammoniumHtml, /data-smiles="CC\[NH3\+\]"/);
assert.match(ethylammoniumHtml, /data-smiles="\[O-\]\[N\+\]\(=O\)\[O-\]"/);

console.log("RecordCard ethylammonium nitrate structure tests passed");

const unmappedAnionRecord = makeRecord();
unmappedAnionRecord.core.ionicLiquid = {
  cation: "[BMIM]",
  anion: "[X-TEST]",
};
const unmappedAnionHtml = renderToStaticMarkup(createElement(RecordCard, { record: unmappedAnionRecord }));
assert.doesNotMatch(unmappedAnionHtml, />unknown</);
assert.match(unmappedAnionHtml, /data-testid="molecule-name-anion"[^>]*>\[X-TEST\]</);
assert.doesNotMatch(unmappedAnionHtml, />label only</);

console.log("RecordCard unmapped anion display tests passed");

for (const anion of ["[AOT]", "[A4BMB]", "[A8BMB]", "[A12BMB]"]) {
  const structuredAnionRecord = makeRecord();
  structuredAnionRecord.core.ionicLiquid = {
    cation: "[BMIM]",
    anion,
  };
  const structuredAnionHtml = renderToStaticMarkup(createElement(RecordCard, { record: structuredAnionRecord }));
  assert.match(structuredAnionHtml, /data-testid="molecule-view-anion"/);
  assert.doesNotMatch(structuredAnionHtml, /data-testid="molecule-view-anion"[^>]*data-smiles=""/);
  assert.doesNotMatch(structuredAnionHtml, />label only</);
}

console.log("RecordCard curated long-chain anion structure tests passed");

const compactRecord = makeRecord();
compactRecord.status = "official";
const browseCompactHtml = renderToStaticMarkup(createElement(RecordCard, { record: compactRecord, compact: true, units: "std" }));
assert.doesNotMatch(browseCompactHtml, />checked</);
assert.match(browseCompactHtml, /Standardized Conditions/);
for (const item of buildConditionItems(compactRecord, "std")) assert.ok(browseCompactHtml.includes(item.label), `condition remains visible: ${item.label}`);
assert.match(browseCompactHtml, /Coefficient of friction/i);
const ungroupedHtml = renderToStaticMarkup(createElement(RecordCard, { record: compactRecord, compact: true, units: "std" }));
assert.match(ungroupedHtml, /Standardized Conditions/);
