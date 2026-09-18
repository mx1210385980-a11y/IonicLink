export type AfmMetadataStatus = "extracted" | "not-reported";

export interface AfmMetadataField<T> {
  value: T | null;
  unit: string | null;
  status: AfmMetadataStatus;
  confidence: number;
  evidence: string;
}

export interface AfmExperimentalMetadata {
  ionicLiquids: AfmMetadataField<string>[];
  substrates: AfmMetadataField<string>[];
  probe: {
    material: AfmMetadataField<string>;
    tipRadius: AfmMetadataField<number>;
    cantileverSpringConstant: AfmMetadataField<number>;
  };
  acquisition: {
    approachSpeed: AfmMetadataField<number>;
    technique: AfmMetadataField<string>;
  };
  externalFactors: {
    temperature: AfmMetadataField<number>;
    atmosphere: AfmMetadataField<string>;
    waterContent: AfmMetadataField<string>;
  };
}

/**
 * Extract only statements that are explicit in the article text. Missing
 * values stay missing; a generic room-temperature or ambient assumption would
 * silently contaminate later MD and joint-prediction datasets.
 */
export function extractAfmExperimentalMetadata(documentText: string): AfmExperimentalMetadata {
  const text = normalize(documentText);
  const ionicLiquids = extractIonicLiquids(text).map((value) => reported(value, null, 0.97, evidenceSentence(text, value)));
  const substrates = extractSubstrates(text).map((value) => reported(value, null, 0.92, evidenceSentence(text, substrateEvidenceNeedle(value))));

  const tipMaterialMatch = text.match(/\b(Au-coated\s+Si|gold-coated\s+silicon|silicon|silica|gold(?:-coated)?|diamond(?:-coated)?|silicon\s+nitride)\s+(?:AFM\s+)?tips?\b/i)
    ?? text.match(/(?:measured|measurements?)[^.;]{0,120}?with\s+(?:a\s+)?(silicon|silica|gold(?:-coated)?|diamond(?:-coated)?|silicon\s+nitride)\s+(?:AFM\s+)?tip/i);
  const tipRadiusMatch = text.match(/(?:tip\s+with\s+)?radius\s*(?:=|of|was)?\s*(\d+(?:\.\d+)?)\s*(nm|µm|um)\b/i);
  const springMatch = text.match(/(?:spring\s+constant(?:\s+of\s+(?:the\s+)?cantilever)?|cantilever\s+spring\s+constant|(?:typical\s+)?force\s+constant)\s*(?:=|of|was(?:\s+in\s+the\s+range\s+of)?|in\s+the\s+range\s+of)?\s*(\d+(?:\.\d+)?)\s*(N\/m|nN\/nm)\b/i);
  const speedMatch = text.match(/(?:constant\s+)?(?:approach|scan)\s+(?:speed|velocity)\s*(?:of|=|was)?\s*(\d+(?:\.\d+)?)\s*(nm\/s|µm\/s|um\/s)\b/i);
  const temperatureMatch = text.match(/(?:AFM|force[-\s]?(?:distance|separation)|measurements?)[^.;]{0,100}?(?:at|temperature(?:\s+of)?|maintained\s+at)\s*(\d+(?:\.\d+)?)\s*(K|°C|C)\b/i)
    ?? text.match(/(?:at|temperature(?:\s+of)?|maintained\s+at)\s*(\d+(?:\.\d+)?)\s*(K|°C|C)\b[^.;]{0,100}?(?:AFM|force[-\s]?(?:distance|separation)|measurements?)/i);
  const waterMatch = text.match(/initial\s+water\s+content[^.;]{0,45}?(\d+(?:\.\d+)?\s*(?:to|-|–)\s*\d+(?:\.\d+)?\s*(?:ppm|wt\s*%|mol\s*%))/i)
    ?? text.match(/(?:water\s+content|H2O)\s*(?:of|=|was|below|<|in\s+the\s+range\s+of)?\s*([^.;,]{1,28}(?:ppm|wt\s*%|mol\s*%))/i);
  const techniqueMatch = text.match(/atomic\s+force\s+spectroscopy\s+was\s+(?:performed|conducted)/i)
    ?? text.match(/(?:probing|measured|measurements?)[^.;]{0,100}?atomic\s+force\s+microscop(?:y|ic)/i);
  const atmosphereMatch = text.match(/(?:AFM|force[-\s]?(?:distance|separation))\s+measurements?\s+(?:were\s+)?(?:performed|conducted|carried\s+out|collected)\s+(?:under|in)\s+(dry\s+nitrogen|nitrogen|argon|vacuum(?!-dry)|ambient\s+air|air)\b/i)
    ?? text.match(/(?:all|the)\s+(?:AFM|force)?\s*measurements?\s+(?:were\s+)?(?:performed|conducted|carried\s+out|collected)\s+(?:under|in)\s+(dry\s+nitrogen|nitrogen|argon|vacuum(?!-dry)|ambient\s+air|air)\b/i);

  return {
    ionicLiquids,
    substrates,
    probe: {
      material: tipMaterialMatch
        ? reported(normalizeMaterial(tipMaterialMatch[1]), null, 0.96, evidenceSentence(text, tipMaterialMatch[0]))
        : missing("Probe material was not stated unambiguously in the extracted article text."),
      tipRadius: numericField(tipRadiusMatch, "Tip radius was not reported."),
      cantileverSpringConstant: numericField(springMatch, "Cantilever spring constant was not reported."),
    },
    acquisition: {
      approachSpeed: numericField(speedMatch, "Approach speed was not reported."),
      technique: /atomic\s+force\s+(?:microscop|spectroscop)|\bAFM\b|\bAFS\b/i.test(text)
        ? reported(/atomic\s+force\s+spectroscopy\s+was\s+(?:performed|conducted)/i.test(text) ? "atomic force spectroscopy" : "atomic force microscopy", null, 0.99, evidenceSentence(text, techniqueMatch?.[0] ?? "atomic force microscopy"))
        : missing("AFM technique wording was not found."),
    },
    externalFactors: {
      temperature: numericField(temperatureMatch, "Measurement temperature was not reported explicitly."),
      atmosphere: atmosphereMatch
        ? reported(atmosphereMatch[1], null, 0.86, evidenceSentence(text, atmosphereMatch[0]))
        : missing("Measurement atmosphere was not reported explicitly."),
      waterContent: waterMatch
        ? reported(waterMatch[1].trim(), null, 0.9, evidenceSentence(text, waterMatch[0]))
        : missing("Water content was not reported explicitly."),
    },
  };
}

function extractIonicLiquids(text: string) {
  const primary = text.match(/(?:in\s+this\s+work|abbreviated\s+as|force[-\s]?(?:distance|separation)\s+curves?\s+in)[^.;]{0,240}?\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]\s*\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]/i)
    ?? text.match(/1-ethyl-3-methylimidazolium\s+bis\(trifluoromethylsulfonyl\)imide[^.;]{0,100}?\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]\s*\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]/i);
  if (primary) return [`[${primary[1]}][${primary[2]}]`];
  const values = new Set<string>();
  for (const match of text.matchAll(/(?:measured|collected|force[-\s]?(?:distance|separation)|AFM)[^.;]{0,180}?\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]\s*\[([A-Za-z][A-Za-z0-9,._-]{1,14})\]/gi)) {
    values.add(`[${match[1]}][${match[2]}]`);
  }
  if (/1-ethyl-3-methylimidazolium\s+bis\(trifluoromethylsulfonyl\)imide/i.test(text)) values.add("[EMIM][TFSI]");
  if (/1-ethyl-3-methylimidazolium\s+bis\(trifluoromethanesulfonyl\)imide/i.test(text)) values.add("[EMIM][TFSI]");
  return [...values].slice(0, 12);
}

function extractSubstrates(text: string) {
  const values = new Set<string>();
  const rules: Array<[RegExp, string]> = [
    [/single-layer\s+(?:graphene|graphite)/i, "single-layer graphene"],
    [/bilayer\s+graphene|\b2LG\b/i, "bilayer graphene"],
    [/few-layer\s+graphene|\bFLG\b/i, "few-layer graphene"],
    [/multi-layer\s+graphene|\bMLG\b/i, "multi-layer graphene"],
    [/\bgold(?:\s+support|\s+substrate)?\b/i, "gold"],
    [/silicon\s+dioxide|silica\s+substrate|\bSiO2\b/i, "SiO2"],
    [/\bPt\s*\(100\)|platinum\s*\(100\)|epi-polished\s+Pt/i, "Pt(100)"],
    [/\bHOPG\b/i, "HOPG"],
    [/\bmica\b/i, "mica"],
  ];
  const experimentalSegments = text
    .split(/[.;]/)
    .filter((segment) => /(?:\bwe\s+(?:measured|used|selected)|collected\s+on|chosen\s+as\s+substrates?|served\s+as\s+(?:the\s+)?(?:working\s+)?electrode|all\s+measured\s+with|samples?\s+(?:were\s+)?(?:supported|prepared|deposited)\s+on|graphene\s+supported\s+on)/i.test(segment))
    .filter((segment) => !/(?:\breported\b|consistent\s+with|simulat|previous\s+work|such\s+as|reference|has\s+been\s+measured|were\s+reported)/i.test(segment))
    .join(". ");
  for (const [pattern, value] of rules) if (pattern.test(experimentalSegments)) values.add(value);
  return [...values];
}

function numericField(match: RegExpMatchArray | null, missingMessage: string): AfmMetadataField<number> {
  if (!match) return missing(missingMessage);
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return missing(missingMessage);
  return reported(value, normalizeUnit(match[2]), 0.94, match[0]);
}

function reported<T>(value: T, unit: string | null, confidence: number, evidence: string): AfmMetadataField<T> {
  return { value, unit, status: "extracted", confidence, evidence };
}

function missing<T>(evidence: string): AfmMetadataField<T> {
  return { value: null, unit: null, status: "not-reported", confidence: 0, evidence };
}

function evidenceSentence(text: string, needle: string) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`[^.;]{0,140}${escaped}[^.;]{0,180}[.;]?`, "i"));
  return match?.[0].trim() ?? needle;
}

function substrateEvidenceNeedle(value: string) {
  if (value === "SiO2") return "silica substrate";
  return value;
}

function normalize(value: string) {
  return value.replace(/[−–—]/g, "-").replace(/\s+/g, " ").trim();
}

function normalizeMaterial(value: string) {
  return value.replace(/\s+/g, " ")
    .replace(/^silica$/i, "silicon")
    .replace(/^Au-coated\s+Si$/i, "gold-coated silicon");
}

function normalizeUnit(value: string) {
  return value.replace(/^um/i, "µm");
}
