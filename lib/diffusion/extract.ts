import { first, matchAll, pageOf, snippet } from "../extractHelpers";
import type { DiffusionExtractedFields } from "./schema";

export const DIFFUSION_SYSTEM_PROMPT = `You are a meticulous physical-chemistry data extractor for IonicLink, a database of ionic-liquid SELF-DIFFUSION IN CONFINEMENT (nanopores, slits, channels, membranes, layered materials).

The atomic unit is one CONDITION-PROPERTY point: a self-diffusion coefficient (D) bound to its diffusing SPECIES and full set of conditions — never a bare material→number. Emit ONE record per species per distinct measurement: a paper reporting D⁺ (¹H) and D⁻ (¹⁹F), or sweeping temperature or pore size, → one record per reported point. NEVER merge cation and anion diffusion into one record.

SCOPE GATES — check these BEFORE emitting any record:
1. CONFINED ONLY — reject bulk. Only extract D measured inside a confined system. If a value is for bulk / free / neat / unconfined IL, do NOT extract it — no matter how prominent. Watch for the classic trap: simulation papers tabulate BULK properties to validate a force field (e.g. "Comparison of bulk densities of pure [IL] … for different scalings" with D⁺/D⁻ columns) — those tables are bulk reference data, NOT confined results. Check the table caption and surrounding text; if it says "bulk", "neat liquid", "validation", or compares to bulk experiment, skip the whole table. A bulk value may at most go into flexible[] as context (key "bulk reference D"), never into a record's diffusion.
2. NO D → NO RECORD. Every record MUST carry an explicit D value from the paper. If a condition point (a temperature, a pore size, a system) has no stated D, discard that point entirely — never emit a record just to hold conditions, and never fill diffusion with "n/a" or a guess.
3. TOTALS ONLY — reject layer-resolved values. Papers often decompose D into spatial layers (D_I, D_II, D_III; contact layer vs. center; interfacial vs. pore middle). When the paper gives both totals and layer values, extract ONLY the totals (D⁺_tot, D⁻_tot, overall pore). NEVER emit records for layer-resolved values — at most note "layer-resolved values also reported (Table N)" in flexible[]. Note: the "tot" in D⁺_tot means total over the pore for the CATION — it is still species "cation", not "overall".
4. NATIVE IONS ONLY. Only the IL's own cation and anion qualify. Discard D of gases (CO₂, O₂), water, or foreign/doped ions (Li⁺, Na⁺, Cl⁻, OH⁻) — e.g. "Cl⁻ permeation through a PIL membrane" is out of scope.

Symbol disambiguation: D⁺, D₊, D(+), D_cation, D_tot⁺ → species "cation". D⁻, D₋, D(−), D_anion, D_tot⁻ → species "anion". D_self, D_IL, D_avg, D_eff (explicitly for the IL as a whole) → species "overall".

Required (base layer) for every record: cation, anion, species, temperature, diffusion.
  - Use the paper's own shorthand for ions (e.g. [EMIM], [TFSI]). Add SMILES only if confident.
  - species = which NATIVE species the D belongs to: "cation" (typically via ¹H NMR), "anion" (typically via ¹⁹F), or "overall".
  - temperature WITH unit, e.g. "303 K" or "30 °C". Diffusion is strongly temperature-dependent — always capture it.
  - diffusion = the self-diffusion coefficient D WITH unit, exactly as reported (e.g. "5.2 × 10⁻¹¹ m² s⁻¹", "1.0 × 10⁻⁶ cm²/s"). Keep the reported notation, including scientific-notation exponents — never drop or guess an exponent.

Confinement (extended layer) — every confinement paper has these; capture them per record:
  - systemName = the author's OWN name for the confined system (e.g. "MCM-41 pores", "silica nanochannel", "PEM with bicontinuous morphology"). REQUIRED — it is the headline descriptor of the system.
  - poreSize = pore diameter / slit width / interlayer spacing WITH unit, exactly as reported (e.g. "2.5 nm", "38 Å").

Common (extended layer), include when present: method ("PFG-NMR" for pulsed-field-gradient NMR, "electrochemical", or "MD simulation"), nucleus (¹H, ¹⁹F), surface (electrode — ONLY for electrochemical D), viscosity, waterContent, concentration.
  - viscosity = dynamic viscosity WITH unit (cP, mPa·s) — often co-reported for Stokes–Einstein analysis; capture it whenever stated.

Unusual (flexible layer): anything notable without a formal field (confinement material/geometry, surface functional groups, force field & wall polarizability for MD, surface charge density, IL loading, pressure, activation energy, tortuosity, CNT chirality, gradient strength, diffusion time Δ) goes in flexible[] as {key, value, note}. Keep it rather than discard it.

Figures: only take a D value from a figure when the authors state it numerically (in the caption, text, or a labeled data point). Never reconstruct values from axis ticks or dense curves — if it cannot be read exactly, skip the point.

Provenance: for each value you can locate, add a provenance[] entry {field, page, figure, table, section, quote}. Use the [PAGE n] markers in the text for the page number. The quote must be copied CHARACTER-FOR-CHARACTER from the text — quotes are verified by exact search against the source PDF, so never paraphrase, reword, or elide with "..."; for a table value quote one contiguous run of the row as printed (never stitch header and value cells together); if no contiguous snippet states the value, omit the quote and cite the figure/table instead. Prioritize diffusion and temperature. Set basis honestly: "direct" only when the text states the value for THIS measurement; "inferred" (with a basisNote) when it comes from general/methods context.

Keep units exactly as reported. Set confidence (0–1) honestly. Do not invent measurements.`;

/**
 * Deterministic offline extractor. Scans the text for ion shorthands, diffusion
 * coefficients (×10⁻¹¹ m² s⁻¹ / e-notation / cm²/s forms), and condition tokens
 * so the Extract page produces plausible diffusion candidates without a key.
 */
export function diffusionMockExtract(text: string): DiffusionExtractedFields[] {
  const title =
    text.split("\n").map((l) => l.trim()).find((l) => l.length > 12) || "Untitled paper";

  const ionPairs = matchAll(text, /\[([A-Za-z0-9,]{1,10})\]/g)
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
  const cation = ionPairs[0] ? `[${ionPairs[0]}]` : "[EMIM]";
  const anion = ionPairs[1] ? `[${ionPairs[1]}]` : "[TFSI]";

  const ds = [...explicitDiffusionValues(text), ...tableScaledDiffusionValues(text)]
    .filter((v, i, a) => a.indexOf(v) === i);

  const temperature =
    first(text, /(\d{2,3}(?:\.\d+)?\s?K\b)/) ?? first(text, /(\d{1,3}(?:\.\d+)?\s?°?\s?C)\b/);
  const viscosity = first(text, /(\d+(?:\.\d+)?\s?(?:cP|mPa·s|mPa\.s|mPas|Pa·s))/i);
  const water = first(text, /(\d+(?:\.\d+)?\s?ppm)/i);
  const systemName =
    first(
      text,
      /(?:confined|confinement)\s+(?:in|inside|within|to|by)\s+(?:the\s+)?([A-Za-z0-9][A-Za-z0-9\][(/),.+-]*(?:\s+[A-Za-z0-9\][(/),.+-]+){0,5}\s+(?:nanochannels?|nanopores?|nanotubes?|membranes?|pores?|slits?|channels?))/i
    ) ??
    first(
      text,
      /([A-Za-z0-9][A-Za-z0-9\][(/),.+-]*(?:\s+[A-Za-z0-9\][(/),.+-]+){0,3}\s+(?:nanochannels?|nanopores?|nanotubes?|membranes?|pores?|slits?|channels?))/i
    );
  const poreSize = first(text, /(\d+(?:\.\d+)?\s?(?:nm|Å))(?=[^a-z]|$)/i);
  const method = /PFG|pulsed[- ]field|NMR/i.test(text)
    ? "PFG-NMR"
    : /chronoamperometr|voltammetr|electrochemical|microelectrode/i.test(text)
      ? "electrochemical"
      : /molecular dynamics|MD simulation/i.test(text)
        ? "MD simulation"
        : undefined;

  // Which species are discussed? D⁺/¹H → cation, D⁻/¹⁹F → anion. The mock
  // assigns detected species to the found D values in order.
  const speciesFlags: string[] = [];
  if (/D\s*\+|D⁺|cation|¹H|1H NMR/i.test(text)) speciesFlags.push("cation");
  if (/D\s*-|D⁻|anion|¹⁹F|19F/i.test(text)) speciesFlags.push("anion");
  if (speciesFlags.length === 0) speciesFlags.push("cation");

  // No-D-no-record rule: a point without an explicit D never becomes a record.
  if (!ds.length) return [];
  const values = ds.slice(0, 6);
  return values.map((diffusion, i) => {
    const species = speciesFlags[i % speciesFlags.length];
    const nucleus = species === "anion" ? (/¹⁹F|19F/i.test(text) ? "¹⁹F" : undefined) : /¹H|1H/i.test(text) ? "¹H" : undefined;
    const provenance: DiffusionExtractedFields["provenance"] = [];
    if (diffusion) {
      const idx = text.indexOf(diffusion);
      if (idx >= 0)
        provenance.push({ field: "diffusion", page: pageOf(text, idx), quote: snippet(text, idx), basis: "direct" });
    }
    return {
      paper: { title },
      cation,
      anion,
      species,
      temperature: temperature ?? undefined,
      diffusion,
      systemName: systemName ?? undefined,
      poreSize: poreSize ?? undefined,
      method,
      nucleus,
      viscosity: viscosity ?? undefined,
      waterContent: water ?? undefined,
      flexible: [],
      provenance,
      confidence: 0.4,
    };
  });
}

const D_UNIT_RE = "(?:m²\\s?s[⁻−-]?¹?|m2\\s?s[⁻−-]?1|m²\\/s|m2\\/s|cm²\\/s|cm2\\/s|cm2\\s?s[⁻−-]?1|µm²\\/s|µm2\\/s|um2\\/s|nm2\\/s)";

function explicitDiffusionValues(text: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`(\\d+(?:\\.\\d+)?(?:\\s?[×x]\\s?10[⁻−-]?\\d+|[eE]-?\\d+)?\\s?${D_UNIT_RE})`, "g");
  for (const m of matchAll(text, re)) {
    const hit = m[1].replace(/\s+/g, " ").trim();
    const idx = m.index ?? 0;
    const prefix = text.slice(Math.max(0, idx - 3), idx);
    if (/10\s*[⁻−-]?$/.test(prefix)) continue;
    out.push(hit);
  }
  return out;
}

function tableScaledDiffusionValues(text: string): string[] {
  const out: string[] = [];
  const scaleRe = new RegExp(`(?:self[-\\s]?diffusion coefficients?|diffusion coefficients?|\\bD\\b)[^\\n]{0,140}(?:10\\s*(?:[⁻−-]|\\^\\s*-?)\\s*(\\d+))\\s*(${D_UNIT_RE})`, "gi");
  for (const scale of matchAll(text, scaleRe)) {
    const exponent = scale[1];
    const unit = scale[2].replace(/\s+/g, " ").trim();
    const idx = scale.index ?? 0;
    const window = text.slice(idx, idx + 900);
    const rowRe = /(?:D\s*[+⁺]|D\s*[-−⁻]|D[_\s-]*cation|D[_\s-]*anion|\bcation\b|\banion\b)[^\d\n]{0,50}(\d+(?:\.\d+)?)/gi;
    for (const row of matchAll(window, rowRe)) {
      out.push(`${row[1]} × 10−${exponent} ${unit}`);
    }
  }
  return out;
}
