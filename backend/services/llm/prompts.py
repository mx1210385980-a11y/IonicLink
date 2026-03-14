# Strict JSON enforcement prefix (prepended to all prompts)
JSON_ENFORCEMENT_PROMPT = """IMPORTANT OUTPUT FORMAT RULES:
1. Output ONLY valid JSON - no markdown, no code blocks, no explanations.
2. Do NOT use ```json ``` or ``` markers.
3. The output must start with { or [ and end with } or ].
4. If you cannot extract data, return an empty array [] or {\"data\": []}.
5. Never include any conversational text.
"""

ANTI_HALLUCINATION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
You are a scientific data extraction assistant.
If a value is not explicitly observable in the provided text/image, set it to null.
Do not invent numbers. Keep provenance fields explicit.
"""


# Backward-compatible default extraction prompt
TRIBOLOGY_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
You are extracting quantitative interfacial tribology data from ionic-liquid literature.

Return JSON with top-level key `data`:
{
  "data": [
    {
      "material_name": "Mica",
      "probe_material": "Silica",
      "probe_geometry": "Sphere",
      "probe_radius": "5 µm",
      "probe_roughness": null,
      "substrate_material": "Mica",
      "substrate_coating": null,
      "substrate_roughness": "< 2 nm",
      "ionic_liquid": "[EMIM][TFSI]",
      "cof": "0.02",
      "friction_force": "1.2 nN",
      "normal_load": "15-75 nN",
      "load": "15-75 nN",
      "speed": "1 um/s",
      "temperature": "298.15 K",
      "potential": "OCP",
      "water_content": "44%",
      "surface_roughness": "RMS 0.3 nm",
      "film_thickness": "12 nm",
      "residual_film_thickness_d": "3.0 nm",
      "layer_spacing_delta": "0.7 nm",
      "mol_ratio": "1:70",
      "cation": "EMIM",
      "anion": "TFSI",
      "source": "Fig. 3a",
      "source_page": 5,
      "source_figure": "Fig. 3a",
      "evidence": "The curve labeled BB5-1-M gives μ = 0.022..."
    }
  ]
}

Rules:
- Keep one record per unique experimental condition/sample trace.
- If multiple conditions appear in one paragraph or figure, split into multiple records.
- Keep AFM / force-distance / layering records even when COF is absent.
- When contact geometry is stated, extract tribopair fields explicitly:
  `probe_material`, `probe_geometry`, `probe_radius`, `probe_roughness`,
  `substrate_material`, `substrate_coating`, `substrate_roughness`.
- Do not collapse the tribopair into `material_name` only. Keep `material_name` as the legacy substrate label if needed.
- Valid quantitative fields include cof, friction_force, load/normal_load, film_thickness,
  residual_film_thickness_d, layer_spacing_delta, surface_roughness, wear_rate.
- If a friction coefficient is reported as the slope of friction vs load over a sweep,
  store the investigated load interval in `load`/`normal_load` (for example `15-75 nN`).
- `film_thickness`, `residual_film_thickness_d`, and `layer_spacing_delta` must be numeric thickness values with units only.
- Never place sample abbreviations, ionic-liquid names, or condition labels into thickness fields.
- Keep sample abbreviations in `evidence`, `notes`, or abbreviation mappings instead.
- `source`, `source_page`, `source_figure`, `evidence` are mandatory provenance fields.
- `evidence` must include distinguishing condition/sample identifiers, not generic statements.
- If a value is unclear, set it to null.
"""


TEXT_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
Task: Extract quantitative records from BODY TEXT only.

Output format:
{
  "data": [ ... same record schema as default prompt ... ]
}

Each extracted record MUST include:
- source
- source_page
- source_figure
- evidence

Text-specific rules:
- Use sentence-complete evidence quotes; do not output broken words.
- If text states room/ambient temperature, normalize to "298.15 K" and keep evidence sentence.
- For symbols μ/µ/u, keep scientific meaning (friction coefficient symbol may appear as μ).
- Never infer figure/table labels unless explicitly mentioned.
- If a condition value is inferred from wording (e.g., room temperature), still include it,
  but ensure evidence supports that inference.
- When the text explicitly says a probe/slider/sphere/colloid and substrate/surface,
  fill the tribopair fields instead of only `material_name`.
- When a caption or paragraph states a load sweep/range, preserve it as a range string in `load`/`normal_load`.
"""


FIGURE_TABLE_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
Task: Extract quantitative records from figures/tables/captions.

Output format:
{
  "data": [ ... same record schema as default prompt ... ]
}

Each extracted record MUST include:
- source
- source_page
- source_figure
- evidence

Figure/table-specific rules:
- Traverse multi-panel figures panel by panel (e.g., Fig. 3a/3b/3c/3d).
- Map axes explicitly. For thickness-vs-friction charts:
  X axis -> film_thickness, Y axis -> cof.
- Exhaust clear points on each curve; for unreadable points set null.
- Keep source labels exact: e.g., "Fig. 3b", "Table 1".
- Thickness fields must stay quantitative; do not place sample abbreviations or ionic-liquid names into them.
- Keep sample abbreviations exactly as shown in evidence text or notes.
- Evidence should quote caption text or nearby explicit statements linking condition and value.
- Extract tribopair descriptors from captions and panel text, including probe material/geometry/radius and substrate material/coating/roughness.
- If the figure/caption reports a load sweep such as "normal load ranging from 15 to 75 nN",
  store `load` and `normal_load` as `15-75 nN` for the derived record.
"""


FIGURE_LEGEND_COF_PROMPT = JSON_ENFORCEMENT_PROMPT + """
Task: Extract friction-coefficient entries from figure legends/annotations in plots.

Output format:
{
  "data": [ ... same record schema as default prompt ... ]
}

Hard rules:
- Focus on legend-style entries such as "in air μ=0.013", "0 V μ=0.019", "+1.5 V μ=0.001".
- Each legend entry must become one record.
- Put the friction coefficient numeric text into `cof`.
- Map legend condition label to fields when possible:
  - voltage/potential-like label -> `potential`
  - humidity/water-like label -> `water_content`
  - gas/environment label (e.g., in air) -> keep in `notes` or `water_content`
- Keep `source`, `source_page`, `source_figure`, and `evidence` mandatory.
- `evidence` must include the exact legend phrase containing μ/cof value.
- If a value is uncertain, skip it (do not invent).
"""


ABBREV_MAPPING_PROMPT = JSON_ENFORCEMENT_PROMPT + """
Task: Build a sample-abbreviation dictionary from text (especially nomenclature/table sections).

Output format:
{
  "sample_map": [
    {
      "sample_id": "BB5-1-M",
      "ionic_liquid": "[BMIM][BF4]",
      "material_name": "Mica",
      "condition": "12 nm film"
    }
  ]
}

Rules:
- Only include mappings explicitly supported by text/table.
- If mapping is partial, keep unknown fields as null.
- Do not fabricate chemistry from naming patterns.
"""


FOCUSED_EVIDENCE_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
Task: Extract candidate records from high-information evidence pages only.

Output format:
{
  "data": [ ... same record schema as default prompt ... ]
}

Rules:
- Prefer records with explicit numbers and clear provenance.
- Include source/source_page/source_figure/evidence for each record.
- Keep all plausible candidates; downstream stages will validate and merge.
"""

# Backward-compatible alias
FOCUSED_FIG_TABLE_EXTRACTION_PROMPT = FOCUSED_EVIDENCE_EXTRACTION_PROMPT


METADATA_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
You are a scientific librarian. Extract only paper metadata from title/header/citation areas.

Output JSON:
{
  "title": "...",
  "authors": "Author A, Author B",
  "doi": "10.xxxx/..." or "",
  "journal": "...",
  "issn": "..." or null,
  "year": 2022 or null,
  "volume": "..." or null,
  "issue": "..." or null,
  "pages": "123-145" or null
}
"""


CHAT_SYSTEM_PROMPT = """
You are IonicLink AI Assistant for ionic-liquid tribology literature analysis.
Be concise, technical, and practical.
"""
