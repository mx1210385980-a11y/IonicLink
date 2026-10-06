import { normalizeSurfaceKey } from "./surfaceDescriptors";

export type SurfaceReferenceField = "surfaceEnergy" | "surfaceChargeDensity" | "contactAngle";
export type SurfaceReferenceKind = "experimental" | "computed";
export type SurfaceReferenceMatchLevel = "material-only" | "material-state" | "treatment-analog";

export interface SurfaceReferenceSource {
  title: string;
  shortLabel: string;
  journal: string;
  year: number;
  doi: string;
  url: string;
}

export interface SurfaceReferenceConditions {
  surfaceState: string;
  method: string;
  temperature?: string;
  probeLiquid?: string;
  solution?: string;
}

export interface SurfaceReference {
  field: SurfaceReferenceField;
  displayValue: string;
  value: number;
  uncertainty?: number;
  unit: "mJ/m²" | "C/m²" | "°";
  kind: SurfaceReferenceKind;
  matchLevel: SurfaceReferenceMatchLevel;
  conditions: SurfaceReferenceConditions;
  applicability: string;
  source: SurfaceReferenceSource;
}

export type SurfaceReferenceProfile = Partial<Record<SurfaceReferenceField, SurfaceReference>>;

export interface SurfaceReferenceQuery {
  substrate: string | null | undefined;
  medium?: string | null;
}

type CatalogEntry = SurfaceReference & {
  material: RegExp;
  experimentMedium?: RegExp;
};

const CATALOG: readonly CatalogEntry[] = [
  {
    field: "surfaceEnergy",
    material: /silica|sio2|quartz|glass/,
    displayValue: "310 ± 20 mJ/m²",
    value: 310,
    uncertainty: 20,
    unit: "mJ/m²",
    kind: "computed",
    matchLevel: "material-state",
    conditions: {
      surfaceState: "dry amorphous SiO₂ surface",
      method: "reactive force-field slab simulation",
      temperature: "room temperature",
    },
    applicability: "Material-state reference for dry amorphous silica; surface hydroxylation and adsorbates can shift the value.",
    source: {
      title: "Thermodynamic properties and atomistic structure of the dry amorphous silica surface from a reactive force field model",
      shortLabel: "Phys. Rev. B 2010",
      journal: "Physical Review B",
      year: 2010,
      doi: "10.1103/PhysRevB.81.155432",
      url: "https://journals.aps.org/prb/abstract/10.1103/PhysRevB.81.155432",
    },
  },
  {
    field: "contactAngle",
    material: /silica|sio2|quartz|glass/,
    displayValue: "0°",
    value: 0,
    unit: "°",
    kind: "experimental",
    matchLevel: "material-state",
    conditions: {
      surfaceState: "maximally hydroxylated silica",
      method: "water contact-angle measurement",
      temperature: "22 °C",
      probeLiquid: "water",
      solution: "15 mM NaCl; reported across pH 3.5, 5.0, and 9.0",
    },
    applicability: "Hydroxylated-silica reference; compare surface preparation before treating it as representative of a wafer sample.",
    source: {
      title: "Surface chemical heterogeneity modulates silica surface hydration",
      shortLabel: "PNAS 2018",
      journal: "Proceedings of the National Academy of Sciences",
      year: 2018,
      doi: "10.1073/pnas.1722263115",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5866604/",
    },
  },
  {
    field: "surfaceEnergy",
    material: /ptfe|teflon/,
    displayValue: "12.6 ± 0.4 mJ/m²",
    value: 12.6,
    uncertainty: 0.4,
    unit: "mJ/m²",
    kind: "experimental",
    matchLevel: "material-only",
    conditions: {
      surfaceState: "untreated 0.2 mm PTFE film",
      method: "OWRK from water and diiodomethane contact angles; five replicates",
      temperature: "ambient",
    },
    applicability: "Material-level PTFE reference; thermal pressing, cleaning, and morphology differ from a prepared tribology surface.",
    source: {
      title: "Ion-implanted polytetrafluoroethylene enhances Saccharomyces cerevisiae biofilm formation for improved immobilization",
      shortLabel: "J. R. Soc. Interface 2012",
      journal: "Journal of the Royal Society Interface",
      year: 2012,
      doi: "10.1098/rsif.2012.0347",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3479919/",
    },
  },
  {
    field: "contactAngle",
    material: /ptfe|teflon/,
    displayValue: "115.8 ± 2.2°",
    value: 115.8,
    uncertainty: 2.2,
    unit: "°",
    kind: "experimental",
    matchLevel: "material-only",
    conditions: {
      surfaceState: "untreated 0.2 mm PTFE film",
      method: "sessile-drop water contact angle; five replicates",
      temperature: "ambient",
      probeLiquid: "water",
    },
    applicability: "Material-level PTFE reference; thermal pressing, cleaning, and morphology differ from a prepared tribology surface.",
    source: {
      title: "Ion-implanted polytetrafluoroethylene enhances Saccharomyces cerevisiae biofilm formation for improved immobilization",
      shortLabel: "J. R. Soc. Interface 2012",
      journal: "Journal of the Royal Society Interface",
      year: 2012,
      doi: "10.1098/rsif.2012.0347",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3479919/",
    },
  },
];

/** Return the best condition-compatible external reference for each surface field. */
export function getSurfaceReferenceProfile(query: SurfaceReferenceQuery): SurfaceReferenceProfile {
  const material = normalizeSurfaceKey(query.substrate);
  if (!material) return {};
  const medium = query.medium?.trim().toLowerCase() ?? "";
  const profile: SurfaceReferenceProfile = {};

  for (const entry of CATALOG) {
    if (profile[entry.field] || !entry.material.test(material)) continue;
    if (entry.experimentMedium && !entry.experimentMedium.test(medium)) continue;
    const { material: _material, experimentMedium: _experimentMedium, ...reference } = entry;
    profile[entry.field] = reference;
  }

  return profile;
}
