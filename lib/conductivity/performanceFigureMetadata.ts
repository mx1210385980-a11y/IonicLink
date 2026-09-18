import type {
  ConductivityCurveKeyPoint,
  ConductivityRecord,
} from "./schema";
import type { PerformanceTargetField } from "./performanceFigureBackfill";
import { pointInterpretation } from "./curveInsights";

const FIGURE_TOKEN = /^(?:fig(?:ure)?\.?)\s*(S?\d+)/i;

function mainFigureNumber(label: string): string | null {
  return label.match(/(?:fig(?:ure)?\.?\s*)?(S?\d+)/i)?.[1]?.toUpperCase() ?? null;
}

function captionFrom(lines: string[], start: number): string {
  const selected: string[] = [];
  for (let index = start; index < lines.length && selected.length < 28; index += 1) {
    const line = lines[index].trim();
    if (!line) {
      if (selected.length && selected.join(" ").length > 100) break;
      continue;
    }
    if (index > start && (
      /^(?:fig(?:ure)?\.?|table)\s*S?\d+/i.test(line)
      || /^\d+(?:\.\d+)+\.?\s+\S/.test(line)
      || /^.{1,80}\bet\s+al\.?$/i.test(line)
      || /\bet\s+al\.\s*\/\s*(?:journal|electrochim|sensors)/i.test(line)
      || /^(?:references|acknowledg|conclusions?)\b/i.test(line)
      || /Downloaded from|Wiley-VCH|Terms and Conditions|Creative Commons|Batteries & Supercaps 20|©\s*20/i.test(line)
      || /^\d{1,3}$/.test(line)
    )) break;
    selected.push(line);
    if (selected.join(" ").length >= 1400) break;
  }
  return selected
    .join(" ")
    .replace(/\0/g, "")
    .replace(/([A-Za-z])-\s+([a-z])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1600);
}

/** Recover a complete caption block from stored PDF text, not from pixels. */
export function extractFullFigureCaption(pageText: string, figureLabel: string): string | undefined {
  const target = mainFigureNumber(figureLabel);
  if (!target) return undefined;
  const panel = figureLabel.match(/\d+\s*([A-T])\b/i)?.[1]?.toLowerCase();
  const lines = pageText.split(/\r?\n/);
  const candidates = lines
    .map((line, index) => ({ line: line.trim(), index }))
    .filter(({ line }) => line.match(FIGURE_TOKEN)?.[1]?.toUpperCase() === target)
    .map(({ line, index }) => {
      const caption = captionFrom(lines, index);
      let score = Math.min(8, caption.length / 120);
      if (/^(?:fig(?:ure)?\.?)\s*S?\d+\s*[.:]/i.test(line)) score += 12;
      if (panel && new RegExp(`(?:\\(${panel}\\)|\\b${panel}\\))`, "i").test(caption)) score += 2;
      if (/\bshows?\b/i.test(line) && !/^(?:fig(?:ure)?\.?)\s*S?\d+\s*[.:]/i.test(line)) score -= 3;
      if (!/^(?:fig(?:ure)?\.?)\s*S?\d+\s*[.:]/i.test(line)) score -= 3;
      return { caption, score };
    })
    .filter(({ caption }) => caption.length > 12)
    .sort((a, b) => b.score - a.score || b.caption.length - a.caption.length);
  return candidates[0]?.caption;
}

const LABELS: Record<PerformanceTargetField, string> = {
  conductivity: "Ionic conductivity",
  electrochemicalWindow: "Electrochemical window",
  chargeTransferResistance: "Charge-transfer resistance (Rct)",
  capacitance: "Capacitance (C/Cdl)",
  viscosity: "Dynamic viscosity",
  electricField: "Electric-field strength",
};

function reportedValue(record: ConductivityRecord, field: PerformanceTargetField): string | undefined {
  if (field === "conductivity") return record.core.conductivity?.raw;
  if (field === "electrochemicalWindow") return record.core.electrochemicalWindow?.raw;
  if (field === "chargeTransferResistance") return record.core.chargeTransferResistance?.raw;
  if (field === "capacitance") return record.core.capacitance?.raw;
  if (field === "viscosity") return record.extended.viscosity?.raw;
  return record.core.electricField?.raw;
}

function recordCondition(record: ConductivityRecord): string | undefined {
  const conditions = [
    record.core.temperature?.raw,
    record.extended.concentration,
    record.core.electrodePotential?.raw,
    record.extended.potentialReference,
    record.extended.waterContent,
    record.core.surface !== "bulk liquid" ? record.core.surface : undefined,
  ].filter((value): value is string => Boolean(value?.trim()));
  return conditions.length ? conditions.join(" · ") : undefined;
}

/**
 * Convert approved record values into explicit curve-linked model inputs.
 * EIS figures may jointly support Rct and capacitance; unrelated bulk
 * properties are intentionally not attached to the same image.
 */
export function buildReportedCurveKeyPoints(
  record: ConductivityRecord,
  primaryField: PerformanceTargetField,
): ConductivityCurveKeyPoint[] {
  const fields: PerformanceTargetField[] = [primaryField];
  if (primaryField === "chargeTransferResistance" && record.core.capacitance) fields.push("capacitance");
  if (primaryField === "capacitance" && record.core.chargeTransferResistance) fields.push("chargeTransferResistance");
  const condition = recordCondition(record);
  return [...new Set(fields)].flatMap((field) => {
    const value = reportedValue(record, field);
    if (!value) return [];
    return [{
      label: LABELS[field],
      field,
      value,
      condition,
      kind: "reported-value" as const,
      source: "paper-text" as const,
      confidence: 1,
      note: "Approved value reported by the paper; not estimated from plotted pixels.",
      interpretation: pointInterpretation({label: LABELS[field], value, field}),
      sourcePage: record.provenance?.[field]?.page,
      evidence: record.provenance?.[field]?.quote,
    }];
  });
}

/** Limited, explicit caption facts. These are conditions/observations, not invented trace coordinates. */
export function extractCaptionCurveInsights(caption: string, curveType: string, page?: number): ConductivityCurveKeyPoint[] {
  const text=caption.replace(/\s+/g," ");
  if(!/voltam|\bCV\b|\bLSV\b/i.test(curveType))return [];
  const result: ConductivityCurveKeyPoint[]=[];
  const add=(label:string,field:string,value:string,interpretation:string,evidence:string,kind:ConductivityCurveKeyPoint["kind"]="reported-value")=>result.push({label,field,value,interpretation,evidence,sourcePage:page,source:"paper-text",kind});
  const rate=text.match(/scan(?:ning)?\s+rate\s*(?:of|:|=)?\s*(\d+(?:\.\d+)?\s*(?:mV|V)\s*(?:\/\s*s|s\s*[−-]\s*1))/i);
  if(rate)add("Scan rate","scanRate",rate[1],"Scan rate affects the current response and must be retained when comparing CV peak currents or onset potentials.",rate[0]);
  const range=text.match(/potential\s+range\s*(?:of|:)?\s*([−-]?\d+(?:\.\d+)?\s*[–−-]\s*[−-]?\d+(?:\.\d+)?\s*V)\s*(vs\.?\s*[^,;]{1,35})?/i);
  if(range)add("Potential scan range","cvScanRange",range[1],"This is the applied experimental scan range, not the electrochemical stability window.",range[0],"range");
  const cycles=text.match(/(\d+)(?:st|nd|rd|th)\s+and\s+(\d+)(?:st|nd|rd|th)\s+cycles/i);
  if(cycles)add("Cycle comparison","cycleComparison",`${cycles[1]} / ${cycles[2]}`,"Compare the current response at the listed cycle numbers; readings from different cycles must not be mixed.",cycles[0]);
  const rise=text.match(/[^.]*high currents?\s+above\s+(\d+(?:\.\d+)?\s*V)\s+in the first cycle[^.]*\./i);
  if(rise)add("First-cycle current rise","initialCycleCurrentRise",`> ${rise[1]}`,/stable interphases/i.test(rise[0])?"The first-cycle current subsequently decreases; the paper attributes this to formation of a stable interphase, not to a stability-window threshold.":"The paper's first-cycle high-current region is not equivalent to a stability-window threshold.",rise[0]);
  return result;
}
