import assert from "node:assert/strict";
import { ingest } from "./ingest";
import { buildReportedCurveKeyPoints, extractFullFigureCaption } from "./performanceFigureMetadata";

const caption = extractFullFigureCaption([
  "Figure 4a and 4b present the impedance and voltammetry results discussed below.",
  "Fig. 4. (a) EIS spectra of bare GCE,",
  "CPO/GCE and IL-modified electrodes in KCl solution,",
  "(b) CV curves measured at 100 mV s-1.",
  "X. Zhu et al.",
].join("\n"), "Fig. 4a");
assert.equal(
  caption,
  "Fig. 4. (a) EIS spectra of bare GCE, CPO/GCE and IL-modified electrodes in KCl solution, (b) CV curves measured at 100 mV s-1.",
);

const record = {
  ...ingest({
    paper: { title: "EIS paper" },
    cation: "[BMIM]",
    anion: "[Br]",
    surface: "modified GCE",
    temperature: "298 K",
    concentration: "5 ppm",
    chargeTransferResistance: "95.64 Ω cm2",
    capacitance: "149.3 µF/cm2",
  }),
  id: "#001",
  status: "official" as const,
  createdAt: "",
};
const points = buildReportedCurveKeyPoints(record, "chargeTransferResistance");
assert.deepEqual(points.map((point) => point.field), ["chargeTransferResistance", "capacitance"]);
assert.match(points[0].condition ?? "", /298 K/);
assert.match(points[0].condition ?? "", /modified GCE/);

console.log("Conductivity performance-figure metadata tests passed");
