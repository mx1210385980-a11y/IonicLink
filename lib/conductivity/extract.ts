import { first, matchAll, pageOf, snippet } from "../extractHelpers";
import type { ConductivityExtractedFields } from "./schema";

export const CONDUCTIVITY_SYSTEM_PROMPT = `You are a meticulous physical-chemistry data extractor for IonicLink, a database of ionic-liquid CONDUCTIVITY measurements.

The atomic unit is one CONDITION-PROPERTY point: an ionic conductivity (σ) bound to its full set of conditions — never a bare material→number. Emit ONE record per distinct measurement; if the paper sweeps temperature (or composition), emit one record per reported point.

Required (base layer) for every record: cation, anion, surface, temperature, conductivity.
  - Use the paper's own shorthand for ions (e.g. [BMIM], [BF4]). Add SMILES only if confident.
  - surface = the electrode / contact surface used in the measurement (e.g. Pt, glassy carbon, stainless steel, Au).
  - temperature WITH unit, e.g. "298.15 K" or "25 °C". Conductivity is strongly temperature-dependent — always capture it.
  - conductivity = the ionic conductivity σ WITH unit (mS/cm, S/m, µS/cm). Keep the reported unit exactly.

Common (extended layer), include when present: method ("EIS" for impedance spectroscopy, or "conductivity cell"), viscosity, waterContent, concentration, density, cellConstant.
  - viscosity = dynamic viscosity WITH unit (cP, mPa·s, Pa·s).
  - waterContent = e.g. "120 ppm" or "0.5 wt%" — water strongly affects conductivity, so capture it whenever stated.

Unusual (flexible layer): anything notable without a formal field (pressure, atmosphere, purity, unusual cell setup) goes in flexible[] as {key, value, note}. Keep it rather than discard it.

Provenance: for each value you can locate, add a provenance[] entry {field, page, figure, table, section, quote}. Use the [PAGE n] markers in the text for the page number. The quote must be copied CHARACTER-FOR-CHARACTER from the text — quotes are verified by exact search against the source PDF, so never paraphrase, reword, or elide with "..."; for a table value quote one contiguous run of the row as printed (never stitch header and value cells together); if no contiguous snippet states the value, omit the quote and cite the figure/table instead. Prioritize conductivity and temperature. Set basis honestly: "direct" only when the text states the value for THIS measurement; "inferred" (with a basisNote) when it comes from general/methods context.

Keep units exactly as reported. Set confidence (0–1) honestly. Do not invent measurements.`;

/**
 * Deterministic offline extractor. Scans the text for ion shorthands,
 * conductivity tokens (mS/cm, S/m, …), and condition tokens so the Extract page
 * produces plausible conductivity candidates without an API key.
 */
export function conductivityMockExtract(text: string): ConductivityExtractedFields[] {
  const title =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 12) || "Untitled paper";

  const ionPairs = matchAll(text, /\[([A-Za-z0-9]{1,8})\]/g)
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  const cation = ionPairs[0] ? `[${ionPairs[0]}]` : "[BMIM]";
  const anion = ionPairs[1] ? `[${ionPairs[1]}]` : "[BF4]";

  const sigmas = matchAll(text, /(\d+(?:\.\d+)?\s?(?:mS\/cm|µS\/cm|uS\/cm|S\/cm|S\/m|mS\/m))/gi)
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((v, i, a) => a.indexOf(v) === i);

  const temperature =
    first(text, /(\d{2,3}(?:\.\d+)?\s?K\b)/) ?? first(text, /(\d{1,3}(?:\.\d+)?\s?°?\s?C)\b/);
  const viscosity = first(text, /(\d+(?:\.\d+)?\s?(?:cP|mPa·s|mPa\.s|mPas|Pa·s))/i);
  const surface = first(text, /(glassy carbon|stainless steel|platinum|gold|Pt\b|Au\b|GC\b|steel)/i);
  const method = /impedance|EIS/i.test(text)
    ? "EIS"
    : /conductivity cell|cell constant/i.test(text)
      ? "conductivity cell"
      : undefined;
  const water = first(text, /(\d+(?:\.\d+)?\s?ppm)/i);

  const values = sigmas.length ? sigmas.slice(0, 5) : [undefined];
  return values.map((conductivity) => {
    const provenance: ConductivityExtractedFields["provenance"] = [];
    if (conductivity) {
      const idx = text.indexOf(conductivity);
      if (idx >= 0)
        provenance.push({ field: "conductivity", page: pageOf(text, idx), quote: snippet(text, idx) });
    }
    return {
      paper: { title },
      cation,
      anion,
      surface: surface ?? "",
      temperature: temperature ?? undefined,
      conductivity: conductivity ?? undefined,
      method,
      viscosity: viscosity ?? undefined,
      waterContent: water ?? undefined,
      flexible: [],
      provenance,
      confidence: 0.4,
    };
  });
}
