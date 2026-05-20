JSON_ENFORCEMENT_PROMPT = """IMPORTANT OUTPUT FORMAT RULES:
1. Output ONLY valid JSON.
2. Do NOT use markdown, code fences, or explanations outside JSON.
3. The output must start with { and end with }.
4. If no explicit confined diffusion data is found, return:
   {"reasoning":"No relevant diffusion data found.","new_feature_alerts":[],"data":[]}
"""


ANTI_HALLUCINATION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
You are a rigorous scientific data extraction assistant.
Extract only values explicitly supported by the supplied text or images.
If a field is missing, use null. Do not estimate numeric values visually.
"""


PROMPT_VERSION = "diffusion.mvp.v1"


DIFFUSION_EXTRACTION_PROMPT = JSON_ENFORCEMENT_PROMPT + """
You extract ionic-liquid diffusion data for confined systems only.

The input may include page blocks in the form [Page N].
Use that page number as source_page whenever the evidence comes from that block.

Return one JSON object with this exact shape:
{
  "reasoning": "short summary",
  "new_feature_alerts": ["optional whitelist note"],
  "data": [
    {
      "system_name": "Graphene oxide membrane",
      "confinement_material_class": "Carbon",
      "confinement_geometry_class": "Slit",
      "surface_functional_groups": "-OH, epoxy",
      "confinement_dimensionality": "2D",
      "ionic_liquid": "[BMIM][PF6]",
      "D_total": 1.25,
      "D_cation": 1.30,
      "D_anion": 1.15,
      "D_unit": "10^-12 m2/s",
      "temperature_value": 300.0,
      "confinement_scale_value": 2.0,
      "confinement_scale_unit": "nm",
      "source": "Table 2",
      "source_page": 5,
      "evidence": "Table 2 reports the self-diffusion coefficients of [BMIM][PF6] in a 2 nm slit pore at 300 K.",
      "novel_features": {
        "viscosity_value": 45.2,
        "viscosity_unit": "mPa.s"
      }
    }
  ]
}

Hard rules:
- Only extract diffusion records for confined or nanoconfined systems.
- Skip bulk, neat, unconfined, or free-liquid records entirely.
- Only emit a record when at least one explicit diffusion coefficient exists:
  D_total or D_cation or D_anion.
- MVP evidence rule: every emitted record must include an evidence quote that contains the exact numeric diffusion coefficient and its unit. If the quote cannot include the exact number and unit, do not emit the record.
- Prefer fewer high-confidence records over broad coverage. It is better to return no rows than to infer a diffusion coefficient.
- Never emit records with unit-only mentions and no numeric value.
- Never convert conductivity, permeability, flux, selectivity, capacitance, or other non-diffusion metrics into diffusion records.
- If a diffusion value would require visual estimation from a curve, leave it null and do not emit the record unless another explicit diffusion value exists.
- Do not infer cation, anion, diffusing ion, water uptake, side chain, or confinement details unless the same local text/table evidence explicitly supports them. Use null for uncertain context fields.

Completeness rules:
- If one table contains multiple rows, temperatures, pore sizes, ionic liquids, or confinement conditions, emit one record per explicit condition.
- Do not collapse multiple conditions into one record.
- Use figure captions, table captions, footnotes, and nearby page text together when they explicitly support the same record.
- Prefer explicit table and page evidence over generic document-level summaries.

Confinement interpretation rules:
- Treat polymerized ionic liquid membranes, polymer electrolyte membranes, ionomer membranes, anion-exchange membranes, and hydrated polymer ionic networks as confined systems when diffusion occurs inside polymer-hosted ionic domains, nanochannels, hydrated clusters, or membrane microenvironments.
- Such polymer-hosted transport should usually map to:
  confinement_material_class = "Polymer"
  confinement_geometry_class = "Interconnected Network"
  confinement_dimensionality = "3D"
- Do NOT reject a polymer membrane record merely because the simulation uses periodic boundary conditions or states that the simulation box is amorphous or three-dimensional.
- Reject only genuinely bulk or free-liquid systems where the diffusion is not occurring inside a host matrix, membrane, pore, channel, or confined domain.

Classification rules:
- confinement_material_class must be one of:
  "Carbon", "Silica/Metal Oxide", "MOF/COF", "Polymer", "Other", "Bulk"
- confinement_geometry_class must be one of:
  "Slit", "Cylinder", "Sphere", "Interconnected Network", "Other", "Bulk"
- confinement_dimensionality must be one of:
  "1D", "2D", "3D", "Bulk", null
- surface_functional_groups must contain chemical groups only, not substrate names.

Normalization rules:
- Normalize diffusion coefficients to a numeric value plus a textual D_unit.
- Normalize temperature_value to kelvin when explicit.
- Normalize confinement_scale_value to nanometers when explicit.
- Keep source as the explicit figure/table/text label when available.
- source_page and evidence are mandatory for each emitted row; evidence must quote the coefficient number and unit.

Novel feature whitelist:
- Allowed in novel_features only when explicit numeric values are present:
  water_content, water_uptake, viscosity, fluid_density, concentration,
  bet_surface_area, surface_charge_density, interaction_energy, tortuosity.
- Store novel features as flattened key pairs with _value and _unit suffixes.

Input follows below.
"""
