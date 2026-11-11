import { liveFields, type LiveDomain, type LiveRow } from "./liveFields";
import { LIVE_EXAMPLE_BRIEFS, type LiveExampleBrief } from "./liveExampleBriefs";

export type LiveTeachingExample = LiveExampleBrief & { rows: LiveRow[] };
const nr = (domain: LiveDomain) => Object.fromEntries(liveFields(domain).map(({ key }) => [key, "NR"]));

/** Instructor-only answer packs, visually checked against the existing source PDFs.
 * These are lesson keys, not newly imported or automatically verified research records.
 */
export function liveTeachingExample(domain: LiveDomain): LiveTeachingExample | null {
  if (domain === "conductivity") return {
    ...LIVE_EXAMPLE_BRIEFS.conductivity!,
    rows: [
      ["BMPyr", "TFSI", "BMPyrTFSI", "2.29 S/m"], ["BMI", "TFSI", "BMITFSI", "3.39 S/m"],
      ["BMI", "BF4", "BMIBF4", "2.62 S/m"], ["EMI", "TFSI", "EMITFSI", "7.39 S/m"], ["DMBI", "BF4", "DMBIBF4", "0.58 S/m"],
    ].map(([cation, anion, salt, value]) => ({ ...nr(domain), cation, anion, property: "conductivity", value, temperature: "20 °C", method: "impedance spectroscopy", variedParameter: "ionic liquid identity", variableValue: salt, evidence: "p. 2; Table 1" })),
  };
  if (domain === "afm") return {
    ...LIVE_EXAMPLE_BRIEFS.afm!,
    rows: ([
      ["A", "+1 V", [0.96, 1.84, 2.68]], ["B", "+0.5 V", [0.86, 1.73, 2.41]],
      ["C", "0 V", [0.47, 0.84]], ["D", "-0.5 V", [0.28, 1.11, 1.95, 2.72]], ["E", "-1 V", [0.25, 1.07, 1.97, 2.80]],
    ] as Array<[string, string, number[]]>).flatMap(([panel, potential, values]) => values.map((value) => ({ ...nr(domain), cation: "Li(G4)", anion: "TFSI", surface: "HOPG", property: "Annotated step separation", value: `${value.toFixed(2)} nm`, separation: `${value.toFixed(2)} nm`, potential, reference: "Pt pseudo-reference", probe: "silicon", variedParameter: "electrode potential", variableValue: potential, evidence: `p. 4; Fig. 1${panel}; printed annotation` }))),
  };
  return null;
}
