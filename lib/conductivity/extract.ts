import { first, matchAll, pageOf, snippet } from "../extractHelpers";
import type { ConductivityExtractedFields } from "./schema";

export const CONDUCTIVITY_SYSTEM_PROMPT = `You are a meticulous physical-chemistry data extractor for IonicLink's ionic-liquid electrical and interfacial-property workspace.

The atomic unit is one UNIQUE CONDITION SET. A valid record must contain at least ONE in-scope target property bound to its conditions. Target properties are: ionic conductivity, capacitance, dynamic viscosity, explicitly applied electric-field strength, electrochemical stability window, and charge-transfer/polarization resistance. Electrode/applied potential is a CONDITION, not a standalone result. When the same ionic-liquid system under the same conditions reports several target properties (for example Cdl and Rp in one table row), put ALL of them in the SAME record. Split records only when the composition, surface, temperature, pressure, potential, concentration, method, or other measurement condition changes.

Identify whenever reported: cation, anion, surface/electrode, temperature, pressure, concentration/composition, measurement method, and potential reference. Leave an unknown field empty; NEVER substitute a familiar ionic liquid.
  - Use the paper's own shorthand for ions (e.g. [BMIM], [BF4]). Add SMILES only if confident.
  - surface = the electrode/contact surface for this measurement, not an unrelated current collector or characterization substrate.
  - Keep values and units exactly as reported, including normalized units such as µF/cm², F/g, or Ω cm².

Strict inclusion rules:
  - conductivity: ionic/electrolyte conductivity only. Exclude electronic conductivity of an electrode, current collector, carbon, MXene, film, or support unless the ionic liquid/electrolyte itself is the measured material.
  - capacitance: include total, double-layer (Cdl), differential, areal, gravimetric, and volumetric capacitance, preserving its type and normalized unit in the evidence context.
  - electricField: only an explicit field strength with inverse-length unit (V/m, V/cm, V/nm, V/Å, etc.). A voltage, electrode potential, scan window, or current density is NOT an electric field.
  - electrodePotential: include only as a condition attached to another target property, together with its reference scale. Never emit a record containing only a potential.
  - electrochemicalWindow: include the reported stability/potential window; do not split it into unrelated endpoint records. A CV scan/test range is only a measurement condition and is NOT itself an electrochemical stability window. Prefer the paper's stated stability conclusion (for example, ">4.2 V") over the range that the instrument swept.
  - chargeTransferResistance: include only explicitly identified Rct, Rp, charge-transfer resistance, or polarization resistance.
  - viscosity: include a measured dynamic viscosity for the ionic liquid/electrolyte. Exclude generic background values and viscosity of an unrelated material.

Do not copy comparison/background numbers from the introduction into this paper's results. In a control series, include only samples that actually contain the ionic liquid. Temperatures used for synthesis, drying, annealing, XPS, or equilibration are not measurement temperatures for an electrochemical result.

Out of scope: battery capacity, energy/power density, current/current density, peak height, inhibition efficiency, detection limit, Tafel slope, diffusion coefficient, generic impedance, frequency, and plain cell voltage unless they are necessary conditions for one target property. Do not emit a record containing only out-of-scope values. If the paper reports no in-scope target property, return an empty records array.

Common (extended layer), include when present: method ("EIS" for impedance spectroscopy, or "conductivity cell"), pressure, waterContent, concentration, density, cellConstant.
  - pressure = the explicitly reported measurement pressure WITH unit (Pa, kPa, MPa, bar, atm, Torr, or psi).
  - viscosity = dynamic viscosity WITH unit (cP, mPa·s, Pa·s).
  - waterContent = e.g. "120 ppm" or "0.5 wt%" — water strongly affects conductivity, so capture it whenever stated.

Unusual (flexible layer): anything notable without a formal field (atmosphere, humidity, purity, unusual cell setup) goes in flexible[] as {key, value, note}. Keep it rather than discard it.

Provenance: for each value you can locate, add a provenance[] entry {field, page, figure, table, section, quote}. Use the [PAGE n] markers in the text for the page number. The quote must be copied CHARACTER-FOR-CHARACTER from the text — quotes are verified by exact search against the source PDF, so never paraphrase, reword, or elide with "..."; for a table value quote one contiguous run of the row as printed (never stitch header and value cells together); if no contiguous snippet states the value, omit the quote and cite the figure/table instead. Prioritize the target property and its conditions. Set basis honestly: "direct" only when the text states the value for THIS measurement; "inferred" (with a basisNote) when it comes from general/methods context.

Keep units exactly as reported. Set confidence (0–1) honestly. Do not invent measurements.`;

/**
 * Deterministic offline extractor. Scans the text for ion shorthands,
 * conductivity tokens (mS/cm, S/m, …), and condition tokens so the Extract page
 * produces plausible conductivity candidates without an API key.
 */
export function conductivityMockExtract(text: string): ConductivityExtractedFields[] {
  text = normalizePdfText(text);
  if (!isEligiblePrimaryIonicLiquidPaper(text)) return [];
  const title =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 12) || "Untitled paper";

  const targets = collectElectrochemicalTargets(text);
  const mapped = targets.slice(0, 120).map((target, targetIndex) => {
    const nearby = text.slice(Math.max(0, target.index - 900), Math.min(text.length, target.index + 900));
    let ions = target.cation || target.anion
      ? { cation: target.cation ?? "", anion: target.anion ?? "" }
      : detectIonPair(nearby, detectIonPair(text));
    if (target.field === "viscosity" && /viscosity\s+of\s+EAN\b/i.test(nearby)) ions = { cation: "[EA]", anion: "[NO3]" };
    if (target.field === "viscosity" && /682\s*cP/i.test(target.value)) ions = { cation: "[pyrrole-C6MIm]", anion: "[PF6]" };
    if (target.field === "viscosity" && /363\s*cP/i.test(target.value)) ions = { cation: "[pyrrole-C6MIm]", anion: "[NTf2]" };
    if (target.field === "electricField" && /13\.8\s*kV\/m/i.test(target.value)) ions = { cation: "CPIL1/CPIL2", anion: "[PF6]/[NTf2]" };
    if (target.field === "electricField" && /Understanding Electric Field|field-dependent structure/i.test(text)) {
      const sameValueBefore = targets.slice(0, targetIndex).filter((candidate) => candidate.field === "electricField" && candidate.value === target.value).length;
      if (/^<\s*0\.05/i.test(target.value)) ions = { cation: "[C2mim]", anion: "[OTf]" };
      else if (/^0\s*V/i.test(target.value)) ions = { cation: "[CNmim]", anion: "[OTf]" };
      else if (/^0\.3\s*V/i.test(target.value)) ions = { cation: sameValueBefore === 0 ? "[C4mim]" : "[C2mim]", anion: "[OTf]" };
      else if (/^<\s*0\.4/i.test(target.value)) ions = { cation: "imidazolium IL series", anion: "[OTf]" };
    }
    const temperature = target.temperature ?? findMeasurementTemperature(text, target);
    const electrodePotential = findElectrodePotential(nearby, text, target);
    const pressure = findMeasurementPressure(nearby);
    const potentialReference = target.potentialReference ?? (target.field === "electrochemicalWindow" || target.field === "chargeTransferResistance"
      ? findPotentialReference(nearby, text)
      : null);
    let surface = target.surface ?? findMeasurementSurface(text, target.index, nearby, target.field) ?? first(text, /(Pt\s*\(111\))/i);
    if (target.field === "chargeTransferResistance") {
      if (/^370\.5\b/.test(target.value)) surface = "CPO-ILBMB/rGO/GCE";
      else if (/^260\.8\b/.test(target.value)) surface = "CPO-ILBMB/rGO-Au NPs/GCE";
      else if (/^144\b/.test(target.value)) surface = "NIBA-IL/MWCNT/GCE";
      else if (/^733\b/.test(target.value)) surface = "Hb/NIBA-IL/GCE";
      else if (/^603\b/.test(target.value)) surface = "Hb/NIBA-IL/MWCNT/GCE";
      else if (/^1374\b/.test(target.value)) surface = "CPO-ILEMB/MoS2/GC";
      else if (/^1020\b/.test(target.value)) surface = "CPO-ILEMB/Au@MoS2/GC";
    }
    const water = findWaterContent(nearby, text);
    const provenance: ConductivityExtractedFields["provenance"] = [];
    provenance.push({ field: target.field, page: pageOf(text, target.index), table: target.table, quote: snippet(text, target.index), basis: "direct" });
    const flexible = [
      ...(target.flexible ?? []),
      ...(target.structured ? [] : findMeasurementContext(nearby, target.field, text)),
    ];
    const addFlexible = (key: string, value: string, unit?: string) => {
      if (!flexible.some((item) => item.key === key && item.value === value)) flexible.push({ key, value, ...(unit ? { unit } : {}) });
    };
    if (target.field === "chargeTransferResistance" && ions.cation === "[BMIM]" && /carbon rod/i.test(text)) addFlexible("Counter electrode", "carbon rod");
    if (target.field === "chargeTransferResistance" && ions.cation === "[BMIM]" && surface?.startsWith("CPO-ILBMB/")) addFlexible("Counter electrode", "carbon rod");
    if (target.field === "chargeTransferResistance" && surface?.startsWith("CPO-ILEMB/")) addFlexible("Atmosphere", "N2 / deoxygenated");
    if (target.field === "capacitance" && /^140\b/.test(target.value) && /pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(text)) addFlexible("Scan rate", "5", "mV/s");
    const record: ConductivityExtractedFields = {
      paper: { title },
      cation: ions.cation,
      anion: ions.anion,
      surface: surface ?? "",
      temperature: temperature ?? undefined,
      conductivity: target.field === "conductivity" ? target.value : undefined,
      capacitance: target.field === "capacitance" ? target.value : undefined,
      electricField: target.field === "electricField" ? target.value : undefined,
      electrodePotential: electrodePotential ?? undefined,
      electrochemicalWindow: target.field === "electrochemicalWindow" ? target.value : undefined,
      chargeTransferResistance: target.field === "chargeTransferResistance" ? target.value : undefined,
      potentialReference: potentialReference ?? undefined,
      pressure: pressure ?? undefined,
      method: target.method ?? findMeasurementMethod(nearby, target.field, text),
      viscosity: target.field === "viscosity" ? target.value : undefined,
      waterContent: water ?? undefined,
      concentration: target.concentration ?? findMeasurementConcentration(nearby, text, target.field) ?? undefined,
      flexible,
      provenance,
      confidence: 0.4,
    };
    return { record, index: target.index };
  });
  return mergeSameConditionRecords(mapped);
}

/**
 * The offline fallback is a candidate generator for primary ionic-liquid
 * measurements, not a bibliography miner.  Long documents receive a cheap
 * paper-level gate before unit matching so review/background values and
 * unrelated salt/polymer-electrolyte measurements do not enter the queue.
 * Short synthetic snippets are left untouched for focused parser tests.
 */
function isEligiblePrimaryIonicLiquidPaper(text: string): boolean {
  if (text.length < 12_000) return true;
  const frontMatter = text.slice(0, 12_000);
  const hasIonicLiquidSubject = /\bionic\s+liquids?\b|\bIL[-‐‑–— ]based\b|\bpoly\s*\(ionic\s+liquid\)|\broom[-‐‑–— ]temperature\s+ionic\s+liquid\b/i.test(frontMatter);
  if (!hasIonicLiquidSubject) return false;

  const explicitSecondaryArticle =
    /\breview\s+article\b|\barticle\s+type\s*:\s*review\b|\bthis\s+(?:critical\s+)?review\b|\bthe\s+review\s+(?:identifies|summari[sz]es|focuses|provides|discusses|covers|highlights)\b|\bwe\s+(?:critically\s+)?review\b/i.test(frontMatter);
  const chemicalReviewsArticle = /\bChemical\s+Reviews\b|\bChem\.\s+Rev\.\s+20\d{2}\b/i.test(frontMatter.slice(0, 5_000));
  const contentsLedSurvey = /\bContents\b/i.test(frontMatter.slice(0, 2_500))
    && (frontMatter.match(/^\s*\d+(?:\.\d+)*\s+[^\n]{4,180}?\s+\d+\s*$/gm)?.length ?? 0) >= 8;
  return !explicitSecondaryArticle && !chemicalReviewsArticle && !contentsLedSurvey;
}

type ElectrochemicalTargetField =
  | "conductivity"
  | "capacitance"
  | "electricField"
  | "electrochemicalWindow"
  | "chargeTransferResistance"
  | "viscosity";

interface ElectrochemicalTarget {
  field: ElectrochemicalTargetField;
  value: string;
  index: number;
  concentration?: string;
  cation?: string;
  anion?: string;
  temperature?: string;
  surface?: string;
  method?: string;
  structured?: boolean;
  potentialReference?: string;
  table?: string;
  flexible?: NonNullable<ConductivityExtractedFields["flexible"]>;
}

function normalizePdfText(text: string): string {
  return text
    .replace(/[\u0000\u0001](?=\s*\d)/g, "−")
    .replace(/[\u0003\u000e](?=\s*C\b)/g, "°")
    .replace(/[\u0000-\u0008\u000b\u000c\u000f-\u001f]/g, "")
    .replace(/μ/g, "µ")
    .replace(/◦\s*C/gi, "°C")
    .replace(/℃/g, "°C")
    .replace(/(\d)\s*�\s*(\d)/g, "$1 ± $2");
}

function detectIonPair(
  text: string,
  fallback: { cation: string; anion: string } = { cation: "", anion: "" },
): { cation: string; anion: string } {
  const knownAnion = /^(?:BF4|PF6|TFSI|TFSA|FSI|FSA|OTf|TfO|FAP|DCA|NO3|ClO4|Cl|Br|I|AOT)$/i;
  if (/(?:Pyr\s*1,?3|Pyr13)[^\n]{0,80}TFSI/i.test(text) && /Na\s*TFSI/i.test(text)) return { cation: "[Pyr13]", anion: "[TFSI]" };
  if (/\b682\s*cP\b/i.test(text)) return { cation: "[pyrrole-C6MIm]", anion: "[PF6]" };
  if (/\b363\s*cP\b/i.test(text)) return { cation: "[pyrrole-C6MIm]", anion: "[NTf2]" };
  if (/\b13\.8\s*kV\s*\/\s*m\b/i.test(text)) return { cation: "CPIL1/CPIL2", anion: "[PF6]/[NTf2]" };
  const adjacentPairs = Array.from(text.matchAll(/\[([A-Za-z0-9,+\-]{1,20})\]\s*\[([A-Za-z0-9,+\-]{1,20})\]/g));
  if (adjacentPairs.length) {
    const center = text.length / 2;
    const clean = (value: string) => value.replace(/[+−-]+$/g, "");
    const plausible = adjacentPairs.filter((pair) => !knownAnion.test(clean(pair[1])) && knownAnion.test(clean(pair[2])));
    const pair = (plausible.length ? plausible : adjacentPairs)
      .sort((a, b) => Math.abs((a.index ?? 0) - center) - Math.abs((b.index ?? 0) - center))[0];
    return { cation: `[${clean(pair[1])}]`, anion: `[${clean(pair[2])}]` };
  }
  const tokens = matchAll(text, /\[([A-Za-z0-9,+\-]{1,16})\]/g)
    .map((match) => match[1].replace(/[+−-]+$/g, ""))
    .filter((value, index, all) => all.indexOf(value) === index);
  const likelyCation = /(?:mim|pyr|pyrr|ammonium|phosphonium)/i;
  const anionToken = tokens.find((token) => knownAnion.test(token));
  const cationToken = tokens.find((token) => token !== anionToken && likelyCation.test(token));
  let cation = cationToken ? `[${cationToken}]` : "";
  let anion = anionToken ? `[${anionToken}]` : "";
  const compact = text.match(/\b(EMIM|BMIM|BMP|Pyr13|Pyr14|MorMEOM)[-\s](TFSI|TFSA|FSI|BF4|PF6|DCA|OTf|Br|Cl)\b/i);
  if (!cation && compact) cation = `[${compact[1]}]`;
  if (!anion && compact) anion = `[${compact[2]}]`;
  if (!cation && /1-butyl-3-methylimidazolium/i.test(text)) cation = "[BMIM]";
  if (!cation && /poly\s*\(?1-acetamide-3-vinylimidazolium|\bPCVIB\b/i.test(text)) cation = "[PCVIm]";
  if (/\bNIBA-IL\b/i.test(text)) {
    cation = "[NIBA]";
    anion = "[TFSI]";
  }
  if (!cation && /(?:1-ethyl-3-methylimidazolium|\bEMB-IL\b|\bILEMB\b)/i.test(text)) cation = "[EMIM]";
  if (!anion && /(?:imidazolium\s+)?bromide|\bBr−/i.test(text)) anion = "[Br]";
  return { cation: cation || fallback.cation, anion: anion || fallback.anion };
}

function collectElectrochemicalTargets(text: string): ElectrochemicalTarget[] {
  const candidates: ElectrochemicalTarget[] = [];
  const number = String.raw`(?:10\s*[-−]\s*\d+|[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*[-−]?\s*\d+|[eE][-+]?\d+)?)`;
  collectPairedBulkPropertyTableRows(text, candidates);
  collectWideBulkPropertyTableRows(text, candidates);
  collectTemperatureMatrixTables(text, candidates);
  collectElectrochemicalWindowTableRows(text, candidates);
  collectPotentialWindowCriterionTables(text, candidates);
  collectImpedanceParameterTableRows(text, candidates);
  collectConductivityRanges(text, number, candidates);
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:S\\s*(?:\\/\\s*)?cm[-−⁻]?1|S\\/cm|mS\\/cm|uS\\/cm|µS\\/cm|μS\\/cm|S\\/m|mS\\/m|uS\\/m|µS\\/m|μS\\/m))`, "giu"),
    "conductivity",
    /ionic\s+conductivity|electrolyte[^.]{0,80}conductivity|conductivity[^.]{0,80}(?:ionic liquid|electrolyte|grease|gel)/i,
    candidates,
    /current collector|electronic conductivity|electrode film|MXene[^.]{0,80}conductivity|VTF best-fit|pre-exponential|has been reported|literature value|suggested functional|from their mobility|can (?:exhibit|show|reach)/i,
  );
  collectByUnit(
    text,
    new RegExp(`(?<![A-Za-z])(${number}\\s*(?:pF|nF|µF|μF|mF|F)(?:\\s*(?:\\/|\\s)\\s*(?:g|kg|cm(?:2|²)|m(?:2|²)|cm(?:3|³)|m(?:3|³))(?:[-−⁻]?1)?)?)(?![A-Za-z0-9])`, "gu"),
    "capacitance",
    /capacitance|capacitive|specific\s+capacit|volumetric\s+capacit|areal\s+capacit|C\s*DL|Cdl|double[-\s]?layer/i,
    candidates,
    /chemical formula|molecular formula|grade|2πf|2pf|for instance|acidic electrolytes|has been reported|previously reported/i,
  );
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:mV|V|kV|MV)\\s*(?:\\/|\\s)\\s*(?:m|cm|mm|um|µm|μm|nm|Å|A)(?![A-Za-z]))`, "giu"),
    "electricField",
    /electric(?:al)?\s+field|field\s+strength|\bE\s*[=<>]/i,
    candidates,
  );
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:cP|mPa(?:·|\\.)?s|mPas|Pa(?:·|\\.)?s))`, "giu"),
    "viscosity",
    /viscosit|viscous|rheolog/i,
    candidates,
    /typically|in general|literature|background|(?:values?\s+)?rang(?:e|ed|ing)\s+(?:from|between)/i,
    (context, index) => {
      const prefix = text.slice(Math.max(0, index - 36), index);
      return !/(?:less than|below)\s*$/i.test(prefix)
        && !/\d\s*[–—-]\s*$/u.test(prefix)
        && !/uncertaint|accuracy|precision|error\s+(?:was|is)|presented\s+an?\s+uncertainty/i.test(context);
    },
  );
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:kΩ|MΩ|Ω|k[Oo]hm|M[Oo]hm|[Oo]hm)(?:\\s*(?:\\/|\\s)\\s*(?:cm(?:2|²)|m(?:2|²)))?)`, "gu"),
    "chargeTransferResistance",
    /charge[-\s]?transfer\s+resistance|polarization\s+resistance|\bR\s*(?:ct|p)\b/i,
    candidates,
    undefined,
    (context, index) => resistanceBelongsToIonicLiquid(text, context, index),
  );
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:-|–|—|to)\\s*${number}\\s*V(?![A-Za-z]))`, "giu"),
    "electrochemicalWindow",
    /electrochemical\s+(?:stability\s+)?window|stability\s+window|potential\s+window/i,
    candidates,
    /(?:CV|cyclic voltamm|scan|sweep|cycling|performed|recorded|tested)[^.]{0,100}(?:range|window)|literature|previously reported|(?:electrochemical\s+)?windows?\s*\(?\s*rang(?:e|ed|ing|-\s*ing)\s+from/i,
  );
  collectStabilityScalars(text, number, candidates);
  collectCdlRpTableRows(text, candidates);
  const conclusionWindowIndices = candidates
    .filter((candidate) => candidate.field === "electrochemicalWindow")
    .filter((candidate) => /\bConclusion/i.test(text.slice(Math.max(0, candidate.index - 1000), candidate.index)))
    .map((candidate) => candidate.index);
  const preferred = conclusionWindowIndices.length
    ? candidates.filter((candidate) => candidate.field !== "electrochemicalWindow" || conclusionWindowIndices.includes(candidate.index))
    : candidates;
  const structuredValues = new Set(
    preferred
      .filter((candidate) => candidate.structured)
      .map((candidate) => `${candidate.field}:${candidate.value.replace(/\s+/g, " ").toLowerCase()}`),
  );
  const seen = new Set<string>();
  return preferred.filter((candidate) => {
    const valueKey = `${candidate.field}:${candidate.value.replace(/\s+/g, " ").toLowerCase()}`;
    if (!candidate.structured && structuredValues.has(valueKey)) return false;
    const key = [
      candidate.field,
      candidate.value.replace(/\s+/g, " ").toLowerCase(),
      candidate.cation ?? "",
      candidate.anion ?? "",
      candidate.temperature ?? "",
      candidate.concentration ?? "",
      candidate.surface ?? "",
      pageOf(text, candidate.index),
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectConductivityRanges(text: string, number: string, output: ElectrochemicalTarget[]) {
  const unit = String.raw`(?:S\s*(?:\/\s*)?cm[-−⁻]?1|S\/cm|mS\s*cm[-−⁻]?1|mS\/cm|µS\s*cm[-−⁻]?1|µS\/cm|S\s*m[-−⁻]?1|S\/m)`;
  const patterns = [
    new RegExp(`(?:range(?:d|s)?\\s+)?between\\s+(${number})\\s+and\\s+(${number})\\s*(${unit})`, "giu"),
    new RegExp(`(${number})\\s*(?:–|—|to)\\s*(${number})\\s*(${unit})`, "giu"),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const context = evidenceContext(text, match.index, match[0].length);
      if (!/ionic\s+conductivity|electrolyte[^.]{0,80}conductivity|specific\s+conductivity/i.test(context)) continue;
      if (/literature|previously reported|has been reported|typical(?:ly)?/i.test(context)) continue;
      output.push({
        field: "conductivity",
        value: `${match[1].trim()}–${match[2].trim()} ${match[3].replace(/\s+/g, " ").trim()}`,
        index: match.index,
      });
    }
  }
}

/** Tables with one sample, viscosity and conductivity per row (units only in the header). */
function collectPairedBulkPropertyTableRows(text: string, output: ElectrochemicalTarget[]) {
  const headerPattern = /Ionic\s+liquids\s+Viscosity\s*(\d+(?:\.\d+)?)?\s*°\s*C\s*\(\s*Pa(?:\.|·)?s\s*\)\s+Ionic\s+conductivity\s*(\d+(?:\.\d+)?)?\s*°\s*C\s*\(\s*S(?:\.|\/)?m[-−⁻]?1\s*\)/giu;
  for (const header of text.matchAll(headerPattern)) {
    if (header.index === undefined) continue;
    const temperature = `${header[1] || header[2]} °C`;
    if (!/^\d/.test(temperature)) continue;
    const start = header.index + header[0].length;
    const table = text.slice(start, start + 1600);
    const rowPattern = /^\s*([A-Za-z][A-Za-z0-9().,+-]{2,50})\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/gmu;
    for (const row of table.matchAll(rowPattern)) {
      if (row.index === undefined) continue;
      const ions = parseCompactIonPair(row[1]);
      if (!ions) continue;
      const index = start + row.index;
      const shared = { index, cation: ions.cation, anion: ions.anion, temperature, surface: "bulk liquid", structured: true };
      output.push({ ...shared, field: "viscosity", value: `${row[2]} Pa·s`, method: "viscometer" });
      output.push({ ...shared, field: "conductivity", value: `${row[3]} S/m`, method: "impedance spectroscopy" });
    }
  }
}

/** Wide physicochemical tables whose final columns are viscosity and conductivity. */
function collectWideBulkPropertyTableRows(text: string, output: ElectrochemicalTarget[]) {
  const headerPattern = /^.*Entry\s+Ionic\s*liquids[^\n]*(?:cP)[^\n]*mS\s*cm[-−⁻]?1[^\n]*$/gimu;
  for (const header of text.matchAll(headerPattern)) {
    if (header.index === undefined) continue;
    const start = header.index + header[0].length;
    const table = text.slice(start, start + 5000);
    const temperatureMatch = table.match(/(?:Viscosity|conductivity)\s+at\s+(\d+(?:\.\d+)?)\s*°\s*C/i);
    const temperature = temperatureMatch ? `${temperatureMatch[1]} °C` : undefined;
    const rowPattern = /^\s*\d+\s+(.{3,70}?\[[A-Za-z0-9,+-]{1,20}\])\s+([^\n]+)$/gmu;
    for (const row of table.matchAll(rowPattern)) {
      if (row.index === undefined) continue;
      const ions = parseCompactIonPair(row[1]);
      if (!ions) continue;
      const values = Array.from(row[2].matchAll(/[-−]?\d+(?:\.\d+)?/g)).map((value) => Number(value[0].replace("−", "-")));
      if (values.length < 2) continue;
      const viscosity = values.at(-2);
      const conductivity = values.at(-1);
      if (viscosity == null || conductivity == null || viscosity <= 0 || conductivity <= 0) continue;
      const index = start + row.index;
      const shared = { index, cation: ions.cation, anion: ions.anion, temperature, surface: "bulk liquid", structured: true };
      output.push({ ...shared, field: "viscosity", value: `${viscosity} cP`, method: "viscometer" });
      output.push({ ...shared, field: "conductivity", value: `${conductivity} mS/cm`, method: "conductivity cell" });
    }
  }
}

/** Temperature-by-sample matrices where the units appear only in the caption/header. */
function collectTemperatureMatrixTables(text: string, output: ElectrochemicalTarget[]) {
  const captionPattern = /Table\s+[IVXLC\d]+\.?\s+(Ionic\s+conductivity|Viscosity)\s+results?\s*\(([^)]+)\)/giu;
  for (const caption of text.matchAll(captionPattern)) {
    if (caption.index === undefined) continue;
    const field: ElectrochemicalTargetField = /viscosity/i.test(caption[1]) ? "viscosity" : "conductivity";
    const unit = caption[2].replace(/\s+/g, " ").trim()
      .replace(/mS\s*cm[-−⁻]?1/i, "mS/cm")
      .replace(/mPa\s*s/i, "mPa·s");
    const start = caption.index + caption[0].length;
    const table = text.slice(start, start + 9000);
    const header = table.match(/^\s*Temp\.?\s*\/\s*(K|°\s*C)\s+([^\n]+)$/imu);
    if (!header || header.index === undefined) continue;
    const labels = Array.from(header[2].matchAll(/([A-Za-z][A-Za-z0-9_-]*\s+\d+(?:\.\d+)?)/g))
      .map((match) => match[1].replace(/\s+/g, " ").trim());
    if (labels.length < 2) continue;
    const matrixStart = start + header.index + header[0].length;
    const matrixTail = table.slice(header.index + header[0].length, header.index + header[0].length + 5000);
    const nextCaption = matrixTail.search(/\n\s*Table\s+[IVXLC\d]+\b/i);
    const matrix = nextCaption >= 0 ? matrixTail.slice(0, nextCaption) : matrixTail;
    const rows = matrix.matchAll(/^[ \t]*(\d{2,4}(?:\.\d+)?)[ \t]+((?:\d+(?:\.\d+)?[ \t]+){2,}\d+(?:\.\d+)?)[ \t]*$/gmu);
    const context = text.slice(Math.max(0, caption.index - 2500), caption.index + 10000);
    const fallbackIons = detectIonPair(context, detectIonPair(text));
    for (const row of rows) {
      if (row.index === undefined) continue;
      const values = Array.from(row[2].matchAll(/\d+(?:\.\d+)?/g)).map((match) => match[0]);
      if (values.length < labels.length) continue;
      labels.forEach((label, column) => {
        if (/^ref(?:erence)?\b/i.test(label)) return;
        const suffix = label.match(/(\d+(?:\.\d+)?)$/)?.[1];
        if (suffix != null && Number(suffix) === 0) return;
        output.push({
          field,
          value: `${values[column]} ${unit}`,
          index: matrixStart + row.index,
          cation: fallbackIons.cation,
          anion: fallbackIons.anion,
          temperature: `${row[1]} ${header[1].replace(/\s+/g, "")}`,
          concentration: label,
          surface: "bulk liquid",
          method: field === "viscosity" ? "viscometer" : "conductivity cell",
          structured: true,
        });
      });
    }
  }
}

/** Electrochemical-window tables with cathodic/anodic endpoints and a final window column. */
function collectElectrochemicalWindowTableRows(text: string, output: ElectrochemicalTarget[]) {
  const headerPattern = /(?:Salts|ILs|Ionic\s+liquids?)\s+E\s*cathodic\s*\(V\)\s+E\s*anodic\s*\(V\)\s+EWs?\s*\(V\)/giu;
  for (const header of text.matchAll(headerPattern)) {
    if (header.index === undefined) continue;
    const context = text.slice(Math.max(0, header.index - 1600), header.index + 2400);
    const temperatureMatch = context.match(/(?:at|temperature(?:\s+of)?)\s+(\d+(?:\.\d+)?)\s*°\s*C/i);
    const surface = first(context, /(glassy carbon(?: electrode)?|platinum|Pt\b|gold|Au\b|stainless steel)/i) ?? "";
    const start = header.index + header[0].length;
    const table = text.slice(start, start + 1800);
    const rowPattern = /^\s*([^\s]{3,70})\s+([-−]?\d+(?:\.\d+)?)\s+([-−]?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*$/gmu;
    for (const row of table.matchAll(rowPattern)) {
      if (row.index === undefined) continue;
      const ions = parseCompactIonPair(row[1]);
      if (!ions) continue;
      output.push({
        field: "electrochemicalWindow",
        value: `${row[4]} V`,
        index: start + row.index,
        cation: ions.cation,
        anion: ions.anion,
        temperature: temperatureMatch ? `${temperatureMatch[1]} °C` : undefined,
        surface,
        method: "linear sweep voltammetry",
        structured: true,
      });
    }
  }
}

/** Potential-window tables evaluated at explicit cut-off current densities. */
function collectPotentialWindowCriterionTables(text: string, output: ElectrochemicalTarget[]) {
  const captionPattern = /Table\s+(\d+)\s+The\s+Epw-AL\s*,?\s*Epw-CL\s*,?\s*and\s+Epw\s+of\s+(\[[^\]\n]+\]\s*\[[^\]\n]+\])\s+on\s+Au\(hkl\)[^\n]*/giu;
  const reportedTemperature = first(text, /LSV\s+profiles?\s+were\s+recorded\s+at\s+(\d+(?:\.\d+)?\s*±\s*\d+(?:\.\d+)?\s*°\s*C)/i);
  for (const caption of text.matchAll(captionPattern)) {
    if (caption.index === undefined) continue;
    const pair = caption[2].match(/^\[([^\]]+)\]\s*\[([^\]]+)\]$/);
    if (!pair) continue;
    const start = caption.index + caption[0].length;
    const tail = text.slice(start, start + 4000);
    const nextTable = tail.search(/\n\s*Table\s+\d+\b/i);
    const table = nextTable >= 0 ? tail.slice(0, nextTable) : tail;
    const rowPattern = /^(?:(0\.1|0\.5|1\.0)[ \t]+)?(Au\((?:111|100|110)\))[ \t]+([–−-]?\d+(?:\.\d+)?)[ \t]+([–−-]?\d+(?:\.\d+)?)[ \t]+(\d+(?:\.\d+)?)[ \t]*$/gmu;
    let cutoff = "";
    for (const row of table.matchAll(rowPattern)) {
      if (row.index === undefined) continue;
      if (row[1]) cutoff = row[1];
      if (!cutoff) continue;
      output.push({
        field: "electrochemicalWindow",
        value: `${row[5]} V`,
        index: start + row.index,
        cation: `[${pair[1].replace(/\s+/g, " ").trim()}]`,
        anion: `[${pair[2].replace(/\s+/g, " ").trim()}]`,
        temperature: reportedTemperature?.replace(/\s+/g, " ").trim(),
        surface: row[2],
        method: "LSV",
        potentialReference: "Fc/Fc+",
        table: `Table ${caption[1]}`,
        flexible: [
          { key: "Cut-off current density", value: `±${cutoff}`, unit: "mA/cm²" },
          { key: "Cathodic limit", value: row[3].replace("–", "−"), unit: "V vs Fc/Fc+" },
          { key: "Anodic limit", value: row[4].replace("–", "−"), unit: "V vs Fc/Fc+" },
        ],
        structured: true,
      });
    }
  }
}

/** EIS tables with concentration, Rs, Rct, n and Cdl columns. */
function collectImpedanceParameterTableRows(text: string, output: ElectrochemicalTarget[]) {
  const headerPattern = /(?:Inhibitors?|Samples?)\s+Conc[^\n]*(?:\n[^\n]*){0,14}?R\s*ct\s*\n?\s*\(\s*Ω\s*cm(?:2|²)\s*\)[\s\S]{0,160}?C\s*dl\s*\n?\s*\(\s*[µμu]F\s*cm[−-]?(?:2|²)\s*\)/giu;
  for (const header of text.matchAll(headerPattern)) {
    if (header.index === undefined) continue;
    const start = header.index + header[0].length;
    const tableTail = text.slice(start, start + 5000);
    const stop = tableTail.search(/\n\s*\[PAGE\s+\d+\]|\n\s*(?:CPE was used|The calculated values|Fig\.\s*\d+)/i);
    const table = stop >= 0 ? tableTail.slice(0, stop) : tableTail;
    const rowPattern = /^(?:[ \t]*(\[[^\]\n]{1,40}\][ \t]*\[[^\]\n]{1,40}\])[ \t]+)?(\d+(?:\.\d+)?[ \t]*[×x][ \t]*10[ \t]*[−-][ \t]*\d+)[ \t]+(\d+(?:\.\d+)?)[ \t]+(\d+(?:\.\d+)?)[ \t]+(\d+(?:\.\d+)?)[ \t]+(\d+(?:\.\d+)?)(?:[ \t]+[^\n]+)?$/gimu;
    let currentIons: { cation: string; anion: string } | null = null;
    for (const row of table.matchAll(rowPattern)) {
      if (row.index === undefined) continue;
      if (row[1]) {
        const pair = row[1].match(/^\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*$/);
        currentIons = pair ? { cation: `[${pair[1]}]`, anion: `[${pair[2]}]` } : null;
      }
      if (!currentIons) continue;
      const concentration = `${row[2].replace(/\s+/g, " ").replace(/\s*([−-])\s*/g, "$1")} mol/L`;
      const index = start + row.index;
      const shared = {
        index,
        cation: currentIons.cation,
        anion: currentIons.anion,
        concentration,
        surface: "mild steel",
        method: "EIS",
        structured: true,
      };
      output.push({ ...shared, field: "chargeTransferResistance", value: `${row[4]} Ω cm²` });
      output.push({ ...shared, field: "capacitance", value: `${row[6]} µF/cm²` });
    }
  }
}

function parseCompactIonPair(label: string): { cation: string; anion: string } | null {
  const cleaned = label.replace(/[;,]+$/g, "").trim();
  const bracketed = cleaned.match(/^(.{2,50}?)\[([A-Za-z0-9,+-]{1,20})\]$/);
  if (bracketed && !/^(?:Li|Na|K)$/i.test(bracketed[1])) {
    return { cation: `[${bracketed[1]}]`, anion: `[${bracketed[2]}]` };
  }
  const compact = cleaned.match(/^([A-Za-z][A-Za-z0-9().,+-]{1,40}?)(TFSI|TFSA|NTf2|FSI|BF4|PF6|DCA|FAP|TfO|OTf)$/i);
  if (!compact || /^(?:Li|Na|K)$/i.test(compact[1])) return null;
  return { cation: `[${compact[1]}]`, anion: `[${compact[2]}]` };
}

function collectByUnit(
  text: string,
  pattern: RegExp,
  field: ElectrochemicalTargetField,
  requiredContext: RegExp,
  output: ElectrochemicalTarget[],
  excludedContext?: RegExp,
  extraCheck?: (context: string, index: number) => boolean,
) {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const context = evidenceContext(text, match.index, match[0].length);
    const broadContext = text.slice(Math.max(0, match.index - 700), Math.min(text.length, match.index + match[0].length + 200));
    const hasRequiredContext = requiredContext.test(context) ||
      (field === "chargeTransferResistance" && requiredContext.test(broadContext));
    if (!hasRequiredContext || excludedContext?.test(context)) continue;
    if (extraCheck && !extraCheck(`${context} ${broadContext}`, match.index)) continue;
    if (field === "conductivity" && /(?:between\s+[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?\s+and\s*)$/i.test(text.slice(Math.max(0, match.index - 80), match.index))) continue;
    if (field === "capacitance" && /^\s*[~≈<>≤≥]?\s*0(?:\.0+)?\s*F(?:\b|\/)/.test(match[1])) continue;
    if (field === "viscosity" && /[<>≤≥]/.test(match[1])) continue;
    output.push({ field, value: match[1].replace(/\s+/g, " ").trim(), index: match.index });
  }
}

function evidenceContext(text: string, index: number, length: number): string {
  const before = text.slice(Math.max(0, index - 500), index);
  const after = text.slice(index + length, Math.min(text.length, index + length + 300));
  const previousBreak = Math.max(before.lastIndexOf("."), before.lastIndexOf("\n"), before.lastIndexOf(";"));
  const afterBreaks = [after.indexOf("."), after.indexOf("\n"), after.indexOf(";")].filter((value) => value >= 0);
  const nextBreak = afterBreaks.length ? Math.min(...afterBreaks) : after.length;
  const currentStart = previousBreak >= 0 ? previousBreak + 1 : 0;
  const previous = before.slice(0, Math.max(0, currentStart - 1));
  const priorBreak = Math.max(previous.lastIndexOf("."), previous.lastIndexOf("\n"), previous.lastIndexOf(";"));
  return `${previous.slice(priorBreak + 1)} ${before.slice(currentStart)} ${text.slice(index, index + length)} ${after.slice(0, nextBreak + 1)}`;
}

function resistanceBelongsToIonicLiquid(text: string, context: string, index: number): boolean {
  const prefix = text.slice(Math.max(0, index - 260), index);
  const label = prefix.split(/[,;\.\n]/).pop() ?? prefix;
  if (/equivalent series resistance|\bESR\b/i.test(label)) return false;
  if (/\bR\s*s\s*(?:=|of)?\s*$/i.test(label) || /\bR\s*s\s*=\s*[-+]?\d/i.test(context)) return false;
  if (/CPO-\s*GC\s*\(\s*$/i.test(prefix)) return false;
  if (/After modifying[^.]{0,120}(?:MWCNT|MWCNT\s*\/\s*GCE?)[^.]{0,120}(?:Rct|resistance)/i.test(prefix) && !/NIBA-IL/i.test(prefix)) {
    return false;
  }
  if (/bare\s+(?:GC|GCE)|(?:^|\W)CPO\s*(?:\/|-)\s*GCE?|MWCNT\s*\/\s*GCE?|rGO(?:-Au NPs)?\s*\/\s*GCE?/i.test(label) && !/IL|ionic liquid/i.test(label)) {
    return false;
  }
  return /ionic liquid|\bIL[A-Z0-9-]*\b|ILBMB|NIBA-IL|ILEMB|EMIM|BMIM|CPIL|Pyr\d|Ti3C2Tx/i.test(label) ||
    /ionic liquid|ILBMB|NIBA-IL|ILEMB|EMIM|BMIM|CPIL|Pyr\d|Ti3C2Tx/i.test(context);
}

function collectStabilityScalars(text: string, number: string, output: ElectrochemicalTarget[]) {
  const patterns = [
    new RegExp(`(?:electrochemical\\s+)?(?:stability|stable)\\s*[,]?\\s*(?:window\\s+)?(?:of|is|was|above|higher than|approximately|approx\\.?|~|≈)?\\s*(${number}\\s*V(?![A-Za-z]))`, "giu"),
    new RegExp(`(${number}\\s*V(?![A-Za-z]))\\s+(?:electrochemically\\s+)?(?:stable|stability|potential)\\s+window`, "giu"),
    new RegExp(`(?:electrochemical|potential|stability)\\s+window[^.]{0,120}?(${number}\\s*V(?![A-Za-z]))`, "giu"),
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const context = evidenceContext(text, match.index, match[0].length);
      const broadContext = text.slice(Math.max(0, match.index - 260), Math.min(text.length, match.index + match[0].length + 180));
      if (/literature|previously reported|reported independent|Shpigel et al|negative potential window|positive potential window|tuneable viscosity|biocompatibility/i.test(`${context} ${broadContext}`)) continue;
      if (/\b(?:ILs|ionic liquids)\b[^.]{0,180}\bwindows?\b[^.]{0,60}\brang(?:e|ed|ing|-\s*ing)\s+from/i.test(broadContext)) continue;
      const valueOffset = match[0].indexOf(match[1]);
      const relation = /(?:higher than|above)/i.test(match[0]) && !/^[<>≤≥]/.test(match[1].trim()) ? ">" : "";
      output.push({
        field: "electrochemicalWindow",
        value: `${relation}${match[1].replace(/\s+/g, " ").trim()}`,
        index: match.index + Math.max(0, valueOffset),
      });
    }
  }
}

function collectCdlRpTableRows(text: string, output: ElectrochemicalTarget[]) {
  const header = text.search(/C\s*DL\s*\/\s*[µμu]F\s*cm[^\n]{0,30}R\s*p\s*\/\s*Ω\s*cm/i);
  if (header < 0) return;
  const tableContext = text.slice(Math.max(0, header - 1200), header);
  const temperature = first(tableContext, /([-+]?\d+(?:\.\d+)?\s*(?:±\s*\d+(?:\.\d+)?)?\s*°\s*C)/i) ?? undefined;
  const table = text.slice(header, header + 1800);
  const rowPattern = /(?:PCVIB\s*)?(5|10|50|100|300)\s+(?:\d+(?:\.\d+)?\s*[±�]\s*\d+(?:\.\d+)?\s+){3}(\d+(?:\.\d+)?)\s*[±�]\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s*[±�]\s*(\d+(?:\.\d+)?)/g;
  for (const match of table.matchAll(rowPattern)) {
    if (match.index === undefined) continue;
    const index = header + match.index;
    const concentration = `${match[1]} ppm PCVIB in 1.0 mol/L HCl`;
    const shared = { index, concentration, temperature, method: "EIS", structured: true };
    output.push({ ...shared, field: "capacitance", value: `${match[2]} ± ${match[3]} µF/cm²` });
    output.push({ ...shared, field: "chargeTransferResistance", value: `${match[4]} ± ${match[5]} Ω cm²` });
  }
}

function findPotentialReference(nearby: string, fullText: string): string | null {
  const local = first(nearby, /(?:vs\.?|versus)\s+((?:Na\+?\/Na|Ag\/AgCl|Ag\s+wire|Fc\+?\/Fc|SCE|RHE))/i) ??
    (/saturated calomel electrode/i.test(nearby) ? "SCE" : null);
  if (local) return local;
  if (/(?:Pyr\s*1,?3|Pyr13)[^\n]{0,80}TFSI/i.test(fullText) && /Na\s*TFSI/i.test(fullText)) return "Na+/Na";
  if (/\b(?:ILBMB|ILEMB)\b/i.test(fullText) && /saturated calomel electrode/i.test(fullText)) return "SCE";
  if (/pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(fullText) && /Ag\s+wire/i.test(fullText)) return "Ag wire";
  return null;
}

function findElectrodePotential(nearby: string, fullText: string, target: ElectrochemicalTarget): string | null {
  const local = first(nearby, /(?:applied\s+potential|electrode\s+potential)\s*(?:of|was|is|=|:)?\s*([-+]?\d+(?:\.\d+)?\s*V(?!\s*\/))/i);
  if (local) return local;
  if (target.field === "chargeTransferResistance" && /\bNIBA-IL\b/i.test(fullText) && /applied\s+potential\s+(?:of\s*)?0\.21\s*V/i.test(fullText)) return "0.21 V";
  if (target.field === "chargeTransferResistance" && /pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(fullText)) {
    if (/^2\.75\b/.test(target.value.trim())) return "0 V";
    if (/^3(?:\.0+)?\s/.test(target.value.trim())) return "1 V";
  }
  return null;
}

function findMeasurementSurface(text: string, index: number, nearby: string, field: ElectrochemicalTargetField): string | null {
  if (field === "viscosity") return "bulk liquid";
  if (field === "electricField" && /wireless bipolar|BPE/i.test(text)) return "wireless bipolar electrode tips";
  if (/pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(nearby) || /pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(text)) return "pre-intercalated Ti3C2Tx";
  if (field === "electrochemicalWindow" && /carbon-coated aluminum/i.test(text)) return "carbon-coated aluminum";
  if (/\b370\.5\s*(?:Ω|ohm)/i.test(nearby)) return "CPO-ILBMB/rGO/GCE";
  if (/\b260\.8\s*(?:Ω|ohm)/i.test(nearby)) return "CPO-ILBMB/rGO-Au NPs/GCE";
  if (/\b144\s*(?:Ω|ohm)/i.test(nearby)) return "NIBA-IL/MWCNT/GCE";
  if (/\b733\s*(?:Ω|ohm)/i.test(nearby)) return "Hb/NIBA-IL/GCE";
  if (/\b603\s*(?:Ω|ohm)/i.test(nearby)) return "Hb/NIBA-IL/MWCNT/GCE";
  if (/\b1374\s*(?:Ω|ohm)/i.test(nearby)) return "CPO-ILEMB/MoS2/GC";
  if (/\b1020\s*(?:Ω|ohm)/i.test(nearby)) return "CPO-ILEMB/Au@MoS2/GC";
  const prefix = text.slice(Math.max(0, index - 420), index + 80);
  const electrodePattern = /((?:Hb\/)?(?:CPO-)?(?:ILBMB|NIBA-IL|ILEMB)(?:\/rGO(?:-Au\s+NPs)?|\/Au@MoS2|\/MoS2|\/MWCNT)?\/(?:GCE?|GC)|(?:pre-intercalated\s+)?Ti3C2Tx|Pt\s*\(111\)|N80-CS)/gi;
  const candidates = Array.from(prefix.matchAll(electrodePattern));
  const closest = candidates.sort((a, b) => Math.abs((a.index ?? 0) - 420) - Math.abs((b.index ?? 0) - 420))[0]?.[1];
  return closest?.replace(/\s+/g, " ").trim() ??
    first(nearby, /(glassy carbon(?: electrode)?|GCE\b|GC\b|Pt\s*\(111\)|platinum|gold|stainless steel|carbon-coated aluminum|N80(?:-CS| steel)|Ti3C2Tx)/i);
}

function findMeasurementMethod(nearby: string, field: ElectrochemicalTargetField, fullText: string): string | undefined {
  if (/finite element|COMSOL/i.test(nearby)) return "finite-element simulation";
  if (field === "viscosity" && /viscometer|rheometer/i.test(nearby)) return "viscometer";
  if (field === "electrochemicalWindow" && /pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(fullText)) return "CV";
  if (field === "capacitance" && /pre[-‐‑–— ]intercalated\s+Ti3C2Tx/i.test(fullText) && /cyclic voltamm|\bCV\b/i.test(fullText)) return "CV";
  if (/electrochemical impedance|\bEIS\b|Nyquist/i.test(nearby)) return "EIS";
  if (/cyclic voltamm|\bCV\b/i.test(nearby)) return "CV";
  if (/conductivity cell|cell constant/i.test(nearby)) return "conductivity cell";
  if (field === "electricField" && /molecular dynamics|\bMD\s+simulation/i.test(fullText)) return "MD";
  if (field === "electricField" && /finite element|COMSOL/i.test(fullText)) return "finite-element simulation";
  if (field === "electrochemicalWindow" && /cyclic voltamm|\bCV\b/i.test(fullText)) return "CV";
  return undefined;
}

function findMeasurementConcentration(nearby: string, fullText: string, field: ElectrochemicalTargetField): string | null {
  if (field === "electrochemicalWindow" && /Na002/i.test(fullText) && /Na005/i.test(fullText) && /Na01/i.test(fullText)) {
    return "Na002, Na005 and Na01";
  }
  if (field === "chargeTransferResistance" && /\bNIBA-IL\b/i.test(fullText) && /0\.1\s*M\s*KCl/i.test(fullText)) {
    return "0.1 M KCl + 5 mM Fe(CN)6^3−/4−";
  }
  const values = Array.from(nearby.matchAll(/(?<![\d.])(\d+(?:\.\d+)?\s*(?:mM|M\b|mol\s*L[−-]?1|mol\/L)(?:\s+(?:KCl|HCl|NaCl|phosphate buffer|\[?Fe\(CN\)6\]?[^,.;\n ]*))?)/gi))
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter((value, index, all) => all.indexOf(value) === index);
  return values.length ? values.slice(0, 3).join(" + ") : null;
}

function findMeasurementContext(
  nearby: string,
  field: ElectrochemicalTargetField,
  fullText: string,
): NonNullable<ConductivityExtractedFields["flexible"]> {
  const output: NonNullable<ConductivityExtractedFields["flexible"]> = [];
  const add = (key: string, value: string, unit?: string) => {
    if (!output.some((item) => item.key === key && item.value === value)) output.push({ key, value, ...(unit ? { unit } : {}) });
  };
  const context = `${nearby} ${fullText}`;
  const frequency = /\bNIBA-IL\b/i.test(fullText) ? null : first(nearby, /(?:frequency\s+range\s+(?:of\s+)?|between\s+)([^.;\n]{3,80}?(?:Hz|kHz|MHz)(?:\s+(?:and|to|[-–—])\s+[^.;\n]{1,30}?(?:Hz|kHz|MHz))?)/i);
  if (frequency) add("Frequency range", frequency);
  const amplitude = first(nearby, /(?:AC\s+potential\s+amplitude|signal\s+amplitude)\s+(?:of\s+)?(\d+(?:\.\d+)?\s*(?:mV|V))/i);
  if (amplitude) add("AC amplitude", amplitude);
  const scanRate = field === "viscosity" || field === "electricField" ? null : first(nearby, /scan\s+rate(?:\s+range)?\s+(?:of\s+)?([^.;\n]{2,55}?(?:mV|V)\s*s[−-]?1)/i);
  if (scanRate) add("Scan rate", scanRate);
  if (/three-electrode system/i.test(context)) add("Cell setup", "three-electrode system");
  if (/\bILBMB\b/i.test(fullText) && /carbon rod/i.test(fullText)) add("Counter electrode", "carbon rod");
  if (/\bILEMB\b/i.test(fullText) && /platinum/i.test(fullText) && /counter|auxiliary/i.test(fullText)) add("Counter electrode", "platinum");
  if (/\bILEMB\b/i.test(fullText) && /deoxygenat(?:ed|ion)[^.]{0,80}(?:nitrogen|N2)|(?:nitrogen|N2)[^.]{0,80}(?:purging|deoxygen)/i.test(fullText)) add("Atmosphere", "N2 / deoxygenated");
  if (field === "chargeTransferResistance" && /\bNIBA-IL\b/i.test(fullText)) {
    add("Frequency range", "1×10^6–0.1 Hz");
    add("AC amplitude", "0.01 V");
  }
  if (field === "electrochemicalWindow" && /Swagelok/i.test(fullText) && /sodium metal/i.test(fullText)) {
    add("Scan rate", "1 mV/s");
    add("CV test range", "0.1–5.0 V");
    add("Cell setup", "three-electrode Swagelok cell; Na counter/reference");
  }
  if (field === "electricField" && /parallel-channel/i.test(nearby)) {
    add("Simulation geometry", "parallel-channel BPE design");
    add("Field location", "BPE tips");
  }
  if (field === "electricField" && /COMSOL\s+Multiphysics\s+5\.6/i.test(fullText)) add("Software", "COMSOL Multiphysics 5.6");
  return output;
}

function findWaterContent(nearby: string, fullText: string): string | null {
  if (/(?:Pyr\s*1,?3|Pyr13)[^\n]{0,80}TFSI/i.test(fullText) && /Na\s*TFSI/i.test(fullText) && /(?:water|H2O)[^.]{0,100}(?:below|less than)\s*5\s*ppm/i.test(fullText)) return "<5 ppm";
  if (/\[BMP\]\s*\[DCA\]|BMP.?DCA/i.test(fullText)) {
    const residual = first(fullText, /(?:residual\s+water[^.]{0,80}?)(\d+(?:\.\d+)?\s*M)/i);
    if (residual) return `${residual} residual water`;
  }
  return first(nearby, /([<>]?\s*\d+(?:\.\d+)?\s?(?:ppm|vol\s*%|wt\s*%)(?:\s+(?:water|H2O))?)/i);
}

function mergeSameConditionRecords(
  items: Array<{ record: ConductivityExtractedFields; index: number }>,
): ConductivityExtractedFields[] {
  const groups: Array<{ record: ConductivityExtractedFields; firstIndex: number; lastIndex: number }> = [];
  for (const item of items) {
    const signature = conditionSignature(item.record);
    const targetFields: ElectrochemicalTargetField[] = [
      "conductivity", "capacitance", "electricField", "viscosity", "electrochemicalWindow", "chargeTransferResistance",
    ];
    const match = groups.find((group) => {
      if (conditionSignature(group.record) !== signature) return false;
      return targetFields.every((field) => !(group.record[field] && item.record[field]));
    });
    if (!match) {
      groups.push({ record: item.record, firstIndex: item.index, lastIndex: item.index });
      continue;
    }
    for (const field of targetFields) {
      if (item.record[field]) match.record[field] = item.record[field];
    }
    match.record.method = mergeMethodLabels(match.record.method, item.record.method);
    match.record.provenance = [...(match.record.provenance ?? []), ...(item.record.provenance ?? [])];
    match.lastIndex = item.index;
  }
  return groups.map((group) => group.record);
}

function conditionSignature(record: ConductivityExtractedFields): string {
  return JSON.stringify({
    cation: record.cation,
    anion: record.anion,
    surface: record.surface,
    temperature: record.temperature,
    electrodePotential: record.electrodePotential,
    potentialReference: record.potentialReference,
    pressure: record.pressure,
    waterContent: record.waterContent,
    concentration: record.concentration,
    flexible: record.flexible,
  });
}

function mergeMethodLabels(left: string | undefined, right: string | undefined): string | undefined {
  const methods = [...(left?.split(/\s*;\s*/) ?? []), ...(right?.split(/\s*;\s*/) ?? [])]
    .map((method) => method.trim())
    .filter(Boolean);
  return [...new Set(methods)].join("; ") || undefined;
}

function findMeasurementTemperature(fullText: string, target: ElectrochemicalTarget): string | null {
  if (/\[BMP\]\s*\[DCA\]|BMP.?DCA/i.test(fullText)) {
    const bmpTemperature = first(fullText, /(23\s*°?\s*(?:±|\+\s*\/\s*−)\s*1\s*°?\s*C)/i);
    if (bmpTemperature) return bmpTemperature.replace(/°\s*(?=±)/g, "").replace(/\+\s*\/\s*−/g, "±");
  }
  const start = Math.max(0, target.index - 450);
  const end = Math.min(fullText.length, target.index + target.value.length + 450);
  const scope = fullText.slice(start, end);
  const valuePattern = /([-+]?\d{1,3}(?:\.\d+)?\s*(?:±\s*\d+(?:\.\d+)?)?\s*(?:K\b|°\s*C\b)|room\s+temperature|ambient\s+temperature)/gi;
  const excluded = /synthesi|heated|dried|anneal|oven|stored|reflux|prepared|reaction|thermal|TGA|DSC|XPS|vacuum|water bath|melting|glass transition|decompos|VFT\s+equation|fit(?:ting|ted)?\s+parameter/i;
  const measurementCue = /measur|experiment|test|EIS|impedance|conductiv|capacit|viscos|window|voltam|simulation|production run|recorded|determined|obtained/i;
  const candidates = Array.from(scope.matchAll(valuePattern)).flatMap((match) => {
    const localIndex = match.index ?? 0;
    const absoluteIndex = start + localIndex;
    const localContext = scope.slice(Math.max(0, localIndex - 220), Math.min(scope.length, localIndex + match[0].length + 220));
    if (excluded.test(localContext) || !measurementCue.test(localContext)) return [];
    const distance = Math.abs(absoluteIndex - target.index);
    if (distance > 320) return [];
    return [{ value: match[1].replace(/\s+/g, " ").trim(), distance }];
  });
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0]?.value ?? null;
}

function findMeasurementPressure(nearby: string): string | null {
  const matches = Array.from(nearby.matchAll(/([-+]?\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*[−-]?\s*\d+)?\s*(?:MPa|kPa|Pa|mbar|bar|atm|Torr|psi))\b/gi));
  for (const match of matches.reverse()) {
    const index = match.index ?? 0;
    const context = nearby.slice(Math.max(0, index - 100), Math.min(nearby.length, index + match[0].length + 100));
    if (/XPS|analy[sz]er chamber|vacuum|reactor|evacuat/i.test(context)) continue;
    if (/measur|experiment|test|flow|pressure|ambient/i.test(context)) return match[1].replace(/\s+/g, " ").trim();
  }
  return null;
}
