import type { LiveDomain } from "./liveFields";

export type LiveExampleBrief = { id: string; domain: LiveDomain; title: string; source: string; task: string; observationCount: number };
/** Descriptions may be bundled in the UI; answer values are server-only. */
export const LIVE_EXAMPLE_BRIEFS: Partial<Record<LiveDomain, LiveExampleBrief>> = {
  conductivity: {
    id: "giroud-2008-table1", domain: "conductivity", observationCount: 5,
    title: "Conductivity across ionic-liquid identities",
    source: "Giroud et al., ECS Meeting Abstracts MA2008-02, abstract 26 (2008). PDF p. 2, Table 1. Local library: Giroud_2008_Meet._Abstr._MA2008-02_26.pdf.",
    task: "Report the five ionic-conductivity observations in Table 1 (PDF p. 2), at 20 °C. Use property=conductivity and variedParameter=ionic liquid identity. Preserve the salt abbreviation as variableValue. Do not confuse viscosity with conductivity, invent an electrode for this bulk table, or infer a monotonic slope from unordered liquid identities. The general temperature statement is not a temperature-resolved numeric series.",
  },
  afm: {
    id: "mclean-2014-figure1-hopg", domain: "afm", observationCount: 16,
    title: "AFM annotated separations at different potentials",
    source: "McLean et al., Nanostructure of [Li(G4)] TFSI and [Li(G4)] NO3 solvate ionic liquids at HOPG and Au(111) electrode interfaces as a function of potential. DOI 10.1039/c4cp04522j. PDF pp. 3-4, Fig. 1A-E. Existing local paper: 15.pdf.",
    task: "For Figure 1A-E only, report all 16 printed arrow-position separations for [Li(G4)]TFSI on HOPG. Use property=Annotated step separation, variedParameter=electrode potential and the panel voltage as variableValue. Record the Pt pseudo-reference and silicon probe from PDF p. 3. These arrow positions are not adjacent-layer widths. Do not use 298 K from the DFT calculation as the AFM measurement temperature. Automatic trace extrema are proposals, not the requested annotations: remove out-of-scope proposals and add the source-supported observations during review.",
  },
};
