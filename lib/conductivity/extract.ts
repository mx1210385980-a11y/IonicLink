import { first, matchAll, pageOf, snippet } from "../extractHelpers";
import type { ConductivityExtractedFields } from "./schema";

export const CONDUCTIVITY_SYSTEM_PROMPT = `You are a meticulous physical-chemistry data extractor for IonicLink's ionic-liquid electrical and interfacial-property workspace.

The atomic unit is one CONDITION-PROPERTY point. A valid record must contain at least ONE in-scope target property bound to its conditions. Target properties are: ionic conductivity, capacitance, explicitly applied electric-field strength, electrochemical stability window, and charge-transfer/polarization resistance. Electrode/applied potential is a CONDITION, not a standalone result. Emit one record per distinct reported point or table row.

Identify whenever reported: cation, anion, surface/electrode, temperature, concentration/composition, measurement method, and potential reference. Leave an unknown field empty; NEVER substitute a familiar ionic liquid.
  - Use the paper's own shorthand for ions (e.g. [BMIM], [BF4]). Add SMILES only if confident.
  - surface = the electrode/contact surface for this measurement, not an unrelated current collector or characterization substrate.
  - Keep values and units exactly as reported, including normalized units such as µF/cm², F/g, or Ω cm².

Strict inclusion rules:
  - conductivity: ionic/electrolyte conductivity only. Exclude electronic conductivity of an electrode, current collector, carbon, MXene, film, or support unless the ionic liquid/electrolyte itself is the measured material.
  - capacitance: include total, double-layer (Cdl), differential, areal, gravimetric, and volumetric capacitance, preserving its type and normalized unit in the evidence context.
  - electricField: only an explicit field strength with inverse-length unit (V/m, V/cm, V/nm, V/Å, etc.). A voltage, electrode potential, scan window, or current density is NOT an electric field.
  - electrodePotential: include only as a condition attached to another target property, together with its reference scale. Never emit a record containing only a potential.
  - electrochemicalWindow: include the reported stability/potential window; do not split it into unrelated endpoint records.
  - chargeTransferResistance: include only explicitly identified Rct, Rp, charge-transfer resistance, or polarization resistance.

Out of scope: battery capacity, energy/power density, current/current density, peak height, inhibition efficiency, detection limit, Tafel slope, diffusion coefficient, generic impedance, frequency, and plain cell voltage unless they are necessary conditions for one target property. Do not emit a record containing only out-of-scope values. If the paper reports no in-scope target property, return an empty records array.

Common (extended layer), include when present: method ("EIS" for impedance spectroscopy, or "conductivity cell"), viscosity, waterContent, concentration, density, cellConstant.
  - viscosity = dynamic viscosity WITH unit (cP, mPa·s, Pa·s).
  - waterContent = e.g. "120 ppm" or "0.5 wt%" — water strongly affects conductivity, so capture it whenever stated.

Unusual (flexible layer): anything notable without a formal field (pressure, atmosphere, purity, unusual cell setup) goes in flexible[] as {key, value, note}. Keep it rather than discard it.

Provenance: for each value you can locate, add a provenance[] entry {field, page, figure, table, section, quote}. Use the [PAGE n] markers in the text for the page number. The quote must be copied CHARACTER-FOR-CHARACTER from the text — quotes are verified by exact search against the source PDF, so never paraphrase, reword, or elide with "..."; for a table value quote one contiguous run of the row as printed (never stitch header and value cells together); if no contiguous snippet states the value, omit the quote and cite the figure/table instead. Prioritize the target property and its conditions. Set basis honestly: "direct" only when the text states the value for THIS measurement; "inferred" (with a basisNote) when it comes from general/methods context.

Keep units exactly as reported. Set confidence (0–1) honestly. Do not invent measurements.`;

/**
 * Deterministic offline extractor. Scans the text for ion shorthands,
 * conductivity tokens (mS/cm, S/m, …), and condition tokens so the Extract page
 * produces plausible conductivity candidates without an API key.
 */
export function conductivityMockExtract(text: string): ConductivityExtractedFields[] {
  const title =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 12) || "Untitled paper";

  const { cation, anion } = detectIonPair(text);
  const targets = collectElectrochemicalTargets(text);
  const viscosity = first(text, /(\d+(?:\.\d+)?\s?(?:cP|mPa·s|mPa\.s|mPas|Pa·s))/i);
  const surface = first(text, /(glassy carbon|stainless steel|platinum|gold|Pt\b|Au\b|GC\b|steel)/i);
  const method = /impedance|EIS/i.test(text)
    ? "EIS"
    : /conductivity cell|cell constant/i.test(text)
      ? "conductivity cell"
      : undefined;
  const water = first(text, /(\d+(?:\.\d+)?\s?ppm)/i);
  return targets.slice(0, 30).map((target) => {
    const nearby = text.slice(Math.max(0, target.index - 500), Math.min(text.length, target.index + 500));
    const temperature =
      first(nearby, /(\d{2,3}(?:\.\d+)?\s?K\b)/) ??
      first(nearby, /(\d{1,3}(?:\.\d+)?\s?°\s?C)\b/) ??
      first(text, /(\d{2,3}(?:\.\d+)?\s?K\b)/) ??
      first(text, /(\d{1,3}(?:\.\d+)?\s?°\s?C)\b/);
    const electrodePotential = first(nearby, /(?:applied\s+potential|electrode\s+potential|\bat)\s*(?:of|was|is|=|:)?\s*([-+]?\d+(?:\.\d+)?\s*V(?!\s*\/))/i);
    const potentialReference = first(nearby, /(?:vs\.?|versus)\s+([A-Za-z0-9+\-\/ ]{2,24})/i)?.replace(/^vs\.?\s*/i, "");
    const provenance: ConductivityExtractedFields["provenance"] = [];
    provenance.push({ field: target.field, page: pageOf(text, target.index), quote: snippet(text, target.index), basis: "direct" });
    return {
      paper: { title },
      cation,
      anion,
      surface: surface ?? "",
      temperature: temperature ?? undefined,
      conductivity: target.field === "conductivity" ? target.value : undefined,
      capacitance: target.field === "capacitance" ? target.value : undefined,
      electricField: target.field === "electricField" ? target.value : undefined,
      electrodePotential: electrodePotential ?? undefined,
      electrochemicalWindow: target.field === "electrochemicalWindow" ? target.value : undefined,
      chargeTransferResistance: target.field === "chargeTransferResistance" ? target.value : undefined,
      potentialReference,
      method,
      viscosity: viscosity ?? undefined,
      waterContent: water ?? undefined,
      flexible: [],
      provenance,
      confidence: 0.4,
    };
  });
}

type ElectrochemicalTargetField =
  | "conductivity"
  | "capacitance"
  | "electricField"
  | "electrochemicalWindow"
  | "chargeTransferResistance";

interface ElectrochemicalTarget {
  field: ElectrochemicalTargetField;
  value: string;
  index: number;
}

function detectIonPair(text: string): { cation: string; anion: string } {
  const tokens = matchAll(text, /\[([A-Za-z0-9,+\-]{1,16})\]/g)
    .map((match) => match[1])
    .filter((value, index, all) => all.indexOf(value) === index);
  const knownAnion = /^(?:BF4|PF6|TFSI|TFSA|FSI|OTf|TfO|FAP|DCA|NO3|Cl|Br|I|AOT)$/i;
  const likelyCation = /(?:mim|pyr|pyrr|ammonium|phosphonium)/i;
  const anionToken = tokens.find((token) => knownAnion.test(token));
  const cationToken = tokens.find((token) => token !== anionToken && likelyCation.test(token));
  return {
    cation: cationToken ? `[${cationToken}]` : "",
    anion: anionToken ? `[${anionToken}]` : "",
  };
}

function collectElectrochemicalTargets(text: string): ElectrochemicalTarget[] {
  const candidates: ElectrochemicalTarget[] = [];
  const number = String.raw`(?:10\s*[-−]\s*\d+|[-+~≈<>≤≥]?\s*\d+(?:\.\d+)?(?:\s*[x×]\s*10\s*[-−]?\s*\d+|[eE][-+]?\d+)?)`;
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:S\\s*(?:\\/\\s*)?cm[-−⁻]?1|S\\/cm|mS\\/cm|uS\\/cm|µS\\/cm|μS\\/cm|S\\/m|mS\\/m|uS\\/m|µS\\/m|μS\\/m))`, "giu"),
    "conductivity",
    /ionic\s+conductivity|electrolyte[^.]{0,80}conductivity|conductivity[^.]{0,80}(?:ionic liquid|electrolyte|grease|gel)/i,
    candidates,
    /current collector|electronic conductivity|electrode film|MXene[^.]{0,80}conductivity|VTF best-fit|pre-exponential/i,
  );
  collectByUnit(
    text,
    new RegExp(`(?<![A-Za-z])(${number}\\s*(?:pF|nF|µF|μF|mF|F)(?:\\s*(?:\\/|\\s)\\s*(?:g|kg|cm(?:2|²)|m(?:2|²)|cm(?:3|³)|m(?:3|³))(?:[-−⁻]?1)?)?)(?![A-Za-z0-9])`, "gu"),
    "capacitance",
    /capacitance|capacitive|specific\s+capacit|volumetric\s+capacit|areal\s+capacit|C\s*DL|Cdl|double[-\s]?layer/i,
    candidates,
    /chemical formula|molecular formula|grade|2πf|2pf/i,
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
    new RegExp(`(${number}\\s*(?:kΩ|MΩ|Ω|kohm|Mohm|ohm)(?:\\s*(?:\\/|\\s)\\s*(?:cm(?:2|²)|m(?:2|²)))?)`, "giu"),
    "chargeTransferResistance",
    /charge[-\s]?transfer\s+resistance|polarization\s+resistance|\bR\s*(?:ct|p)\b/i,
    candidates,
  );
  collectByUnit(
    text,
    new RegExp(`(${number}\\s*(?:-|–|—|to)\\s*${number}\\s*V)`, "giu"),
    "electrochemicalWindow",
    /electrochemical\s+(?:stability\s+)?window|stability\s+window|potential\s+window|voltage\s+range/i,
    candidates,
  );
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.field}:${candidate.value.replace(/\s+/g, " ").toLowerCase()}:${pageOf(text, candidate.index)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectByUnit(
  text: string,
  pattern: RegExp,
  field: ElectrochemicalTargetField,
  requiredContext: RegExp,
  output: ElectrochemicalTarget[],
  excludedContext?: RegExp,
) {
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const context = text.slice(Math.max(0, match.index - 320), Math.min(text.length, match.index + match[0].length + 320));
    if (!requiredContext.test(context) || excludedContext?.test(context)) continue;
    if (field === "capacitance" && /^\s*[~≈<>≤≥]?\s*0(?:\.0+)?\s*F(?:\b|\/)/.test(match[1])) continue;
    output.push({ field, value: match[1].replace(/\s+/g, " ").trim(), index: match.index });
  }
}
