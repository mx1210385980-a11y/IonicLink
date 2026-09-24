import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { POST } from "../app/api/afm/digitize/route";
import { createTestAppSession } from "../lib/auth.test-helpers";

type Target = {
  pdfPath: string;
  doi: string;
  paperFile: string;
  prefix: string;
  ionicLiquid: string;
  cation: string;
  anion: string;
  profile: Record<string, unknown>;
  panels: Array<{ candidateId: string; panel: string; substrate: string; potentialV: number | null }>;
};

const targets: Target[] = [
  {
    pdfPath: "C:/Users/Administrator/Documents/Codex/2026-08-13/new-chat/tmp/pdfs/afm-blind-s41598-017-04576-x/insight-edl-ionic-liquid-graphene.pdf",
    doi: "10.1038/s41598-017-04576-x",
    paperFile: "insight-edl-ionic-liquid-graphene.pdf",
    prefix: "AFM-AUTO-NATURE-2017-F1",
    ionicLiquid: "[EMIM][TFSI]",
    cation: "1-ethyl-3-methylimidazolium",
    anion: "bis(trifluoromethanesulfonyl)imide",
    profile: {
      paperFile: "insight-edl-ionic-liquid-graphene.pdf",
      substrate: "panel-specific source surface",
      probeMaterial: "silicon tip",
      surfaceState: "immersed in vacuum-dry [EMIM][TFSI] in an open AFM cell",
      technique: "AFM normal force-separation spectroscopy",
      instrument: "JPK Nanowizard Ultra",
      scanRateHz: null,
      scanSizeNm: 500,
      springConstantNPerM: 0.3507,
      separationUnit: "nm",
      forceUnit: "nN",
      curveBranch: "approach",
      methodLocator: "Materials and Methods; AFM studies and force maps",
      axisLocator: "Figure 1",
      atmosphere: "ambient laboratory conditions; open AFM cell",
      waterContent: "≤0.45 wt% after 12 h for silica-supported experiments",
    },
    panels: [
      { candidateId: "page-2-grid-1x3-1-1", panel: "A", substrate: "single-layer graphene on SiO2", potentialV: null },
      { candidateId: "page-2-grid-1x3-1-2", panel: "B", substrate: "bilayer graphene on SiO2", potentialV: null },
      { candidateId: "page-2-grid-1x3-1-3", panel: "C", substrate: "SiO2", potentialV: null },
    ],
  },
  {
    pdfPath: "C:/Users/Administrator/Documents/Codex/2026-08-13/new-chat/tmp/pdfs/afm-blind-ijms222312653/dema-tfo-afs.pdf",
    doi: "10.3390/ijms222312653",
    paperFile: "dema-tfo-afs.pdf",
    prefix: "AFM-AUTO-IJMS-2021-F6",
    ionicLiquid: "[Dema][TfO]",
    cation: "diethylmethylammonium",
    anion: "triflate",
    profile: {
      paperFile: "dema-tfo-afs.pdf",
      substrate: "Pt(100)",
      probeMaterial: "gold-coated silicon tip",
      surfaceState: "epi-polished Pt(100) single crystal in neat [Dema][TfO]",
      technique: "atomic force spectroscopy",
      instrument: "Cypher AFM (Asylum Research)",
      scanRateHz: null,
      scanSizeNm: "not reported",
      springConstantNPerM: 5,
      separationUnit: "nm",
      forceUnit: "nN",
      curveBranch: "approach",
      methodLocator: "Methods; Atomic force spectroscopy",
      axisLocator: "Figure 6",
      waterContent: "0.2–0.25 wt% initial water content",
    },
    panels: [
      { candidateId: "page-7-grid-2x3-1-1", panel: "A", substrate: "Pt(100)", potentialV: -1.5 },
      { candidateId: "page-7-grid-2x3-1-2", panel: "B", substrate: "Pt(100)", potentialV: 0.5 },
      { candidateId: "page-7-grid-2x3-1-3", panel: "C", substrate: "Pt(100)", potentialV: 2 },
    ],
  },
];

async function digitize(target: Target, cookie: string) {
  const bytes = await readFile(target.pdfPath);
  const form = new FormData();
  form.set("file", new File([bytes], target.paperFile, { type: "application/pdf" }));
  const response = await POST(new NextRequest("http://localhost/api/afm/digitize", {
    method: "POST",
    headers: { cookie, origin: "http://localhost" },
    body: form,
  }));
  const payload = await response.json() as any;
  if (!response.ok) throw new Error(`${target.paperFile}: ${payload.error ?? `HTTP ${response.status}`}`);
  return payload;
}

async function main() {
  const { cookie } = await createTestAppSession();
  const records: any[] = [];
  const imageDirectory = path.resolve("data/afm/imported-source-figures");
  await mkdir(imageDirectory, { recursive: true });

  for (const target of targets) {
    const payload = await digitize(target, cookie);
    for (const panel of target.panels) {
      const candidate = payload.candidates.find((item: any) => item.id === panel.candidateId);
      if (!candidate) throw new Error(`${target.paperFile}: candidate ${panel.candidateId} was not returned.`);
      const calibration = candidate.axisCalibration;
      if (calibration?.status !== "auto-calibrated" || !calibration.axes) {
        throw new Error(`${target.paperFile}: ${panel.candidateId} lacks verified physical axes.`);
      }
      if (candidate.analysis.quality !== "high" || candidate.analysis.confidence < 0.9) {
        throw new Error(`${target.paperFile}: ${panel.candidateId} did not meet the high-confidence import gate.`);
      }

      const id = `${target.prefix}-${panel.panel}`;
      const axes = calibration.axes;
      const points = candidate.analysis.normalizedPoints.map((point: { x: number; y: number }) => [
        Number((axes.xMin + point.x * (axes.xMax - axes.xMin)).toFixed(8)),
        Number((axes.yMin + point.y * (axes.yMax - axes.yMin)).toFixed(8)),
      ]);
      const imageFile = `${id.toLowerCase()}.png`;
      await writeFile(path.join(imageDirectory, imageFile), Buffer.from(String(candidate.imageDataUrl).split(",")[1], "base64"));
      const displayPotential = panel.potentialV === null ? "no applied potential reported" : `${panel.potentialV > 0 ? "+" : ""}${panel.potentialV} V`;
      const displayLabel = `${target.ionicLiquid} · ${panel.substrate} · ${displayPotential}`;
      const temperatureK = target.doi.startsWith("10.1038/") ? 300.15 : null;
      const potentialReference = panel.potentialV === null
        ? "not applicable"
        : "Pt electrode versus grounded microscope holder; no reference electrode";

      records.push({
        curve: {
          id,
          collection: "qualified-new",
          status: "source-verified",
          label: displayLabel,
          ionicLiquid: target.ionicLiquid,
          cation: target.cation,
          anion: target.anion,
          potentialV: panel.potentialV,
          temperatureK,
          xUnit: axes.xUnit,
          yUnit: axes.yUnit,
          pointCount: points.length,
          points,
          segmentStarts: candidate.analysis.segmentStarts,
          source: {
            date: "26-09-16",
            folder: `automatic PDF import/${target.doi}`,
            imageFile,
            imagePath: `internal://afm-imported/${imageFile}`,
            workbookFile: "afm-auto-imported-series.json",
            workbookPath: "internal://data/afm/afm-auto-imported-series.json",
            sheet: `Figure ${candidate.figureLabel ?? "unknown"}${panel.panel}`,
            range: panel.candidateId,
            pdfFile: target.paperFile,
            pdfPath: target.pdfPath,
            doi: target.doi,
            figure: { label: `Figure ${candidate.figureLabel}${panel.panel}`, pdfPage: candidate.page, mappingStatus: "verified" },
            imageCrop: candidate.sourceFigure.crop,
          },
          notes: `Automatically digitized from a source PDF after source-image overlay review. Recognition confidence ${candidate.analysis.confidence}; physical-axis confidence ${calibration.confidence}.`,
        },
        profile: target.profile,
        system: {
          curveIds: [id],
          ionicLiquid: target.ionicLiquid,
          cation: target.cation,
          anion: target.anion,
          substrate: panel.substrate,
          pdfFile: target.paperFile,
          pdfPath: target.pdfPath,
          doi: target.doi,
          figureLocator: `Figure ${candidate.figureLabel}${panel.panel}; PDF page ${candidate.page}`,
          note: "Automatically extracted curve, physical axes, ionic liquid, substrate and panel condition were checked against the source figure and article text.",
        },
        override: {
          ionicLiquid: target.ionicLiquid,
          cation: target.cation,
          anion: target.anion,
          temperatureK,
          figure: `Figure ${candidate.figureLabel}${panel.panel}`,
          ...(panel.potentialV === null ? {} : { potentialV: panel.potentialV }),
          potentialReference,
          displayLabel,
          digitizationQuality: "complete",
          digitizationNote: `Publication-oriented centreline extracted automatically from a ${candidate.analysis.traceMode} source panel; ${points.length} physical data points; recognition confidence ${candidate.analysis.confidence}.`,
        },
        figureLink: {
          curveId: id,
          imageFile,
          imagePath: `internal://afm-imported/${imageFile}`,
          pdfFile: target.paperFile,
          pdfPath: target.pdfPath,
          doi: target.doi,
          pdfPage: candidate.page,
          figureLabel: `Figure ${candidate.figureLabel}${panel.panel}`,
          displayLabel,
          potentialV: panel.potentialV,
          potentialReference,
          xUnit: axes.xUnit,
          yUnit: axes.yUnit,
          imageCrop: candidate.sourceFigure.crop,
          status: "verified",
        },
      });
    }
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    records,
  };
  await writeFile(path.resolve("data/afm/afm-auto-imported-series.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ imported: records.length, ids: records.map((record) => record.curve.id) }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
