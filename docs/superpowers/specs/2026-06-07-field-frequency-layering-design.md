# Field Frequency Layering Design

## Goal

Prevent literature-specific variables from being lost during ionic-liquid lubrication extraction, especially variables such as applied current and iron-oxide additive ratio that are meaningful but do not fit the current fixed field list.

The system should define a three-layer field structure from real extracted data distribution:

- Core: fields present in nearly every relevant literature and required for review/promotion.
- Extension: fields present in many literatures and shown by default, but not mandatory.
- Flexible: rare but meaningful fields that must be preserved, displayed, and eligible for later promotion.

The three-layer structure must be driven by a field-frequency audit, not by intuition.

## Current Context

The current database schema stores fixed columns plus several JSON fields on both review candidates and official records:

- `field_evidence_json`
- `lubricant_components_json`
- `cof_extracted_json`
- `load_conditions_json`
- `speed_conditions_json`
- `tribological_system_json`

The current evidence builders enumerate known fields such as material, ionic liquid, COF, load, speed, temperature, potential, and water content. This makes common fields stable, but it means new variables such as current, current density, iron-oxide additive loading, additive ratio, particle size, and additive phase can be read by the model yet fail to become first-class review data.

A read-only audit of the current local database on 2026-06-07 found:

- Review candidates: 190 rows across 18 literatures.
- Official records: 387 rows across 36 literatures.
- Fields such as material, ionic liquid, substrate material, and tribological system are close to universal.
- Fields such as speed, load, temperature, probe/substrate geometry, and COF vary by corpus and are good extension-layer candidates.
- Current and additive-ratio fields are not yet reliably present in the stored field inventory, so they must be preserved before their frequency can be measured.

## Recommended Approach

Implement an audit-first, lossless field system.

1. Preserve all model-discovered variables into a flexible field pool.
2. Run a field-frequency audit over extracted records grouped by literature.
3. Produce a proposed field priority table using paper-level presence as the primary signal.
4. Use the table to assign fields to core, extension, or flexible layers.
5. Surface the layers in review/database UI without overcrowding the main table.

This avoids hard-coding the three layers before the data distribution is known.

## Data Model

Add a normalized flexible field payload that can live inside existing JSON storage first, without requiring an immediate table migration.

Recommended payload shape:

```json
{
  "schema_version": "field-layering-v1",
  "fields": {
    "current": {
      "label": "Current",
      "value": "0.5",
      "unit": "A",
      "category": "condition",
      "source_column": "Current",
      "evidence": {
        "quote": "The test was conducted under a current of 0.5 A.",
        "page": 4,
        "bbox": null
      }
    },
    "iron_oxide_additive_ratio": {
      "label": "Iron oxide additive ratio",
      "value": "1",
      "unit": "wt%",
      "category": "lubricant_component",
      "compound": "Fe2O3",
      "role": "additive",
      "evidence": {
        "quote": "Fe2O3 nanoparticles were added at 1 wt%.",
        "page": 5,
        "bbox": null
      }
    }
  }
}
```

Storage rules:

- Keep current fixed fields unchanged for compatibility.
- Store flexible variables in `field_evidence_json` under a reserved key such as `_flexible_fields`.
- When the variable is a lubricant component, also normalize it into `lubricant_components_json` when possible.
- When the variable is an operating condition, also expose it as a condition evidence field when possible.
- Never drop a model-discovered variable solely because it is not in the fixed field list.

## Frequency Audit

Add a backend field inventory service that scans review candidates, official records, or both.

Primary denominator:

- Literature-level presence: number of literatures where the field appears at least once divided by total literatures in scope.

Secondary signals:

- Row coverage: number of rows where the field appears divided by total rows in scope.
- Evidence rate: number of field values with usable evidence divided by number of field values.
- Distinct value count.
- Example values.
- Example literature IDs/titles.
- Field category: ionic liquid, lubricant component, tribopair, condition, metric, source, or other.

Layer proposal thresholds:

- Core: paper presence >= 95%.
- Extension: paper presence >= 50% and < 95%.
- Flexible: paper presence < 50%, but field has meaningful values or scientific relevance.

The thresholds are defaults. The audit output should include enough detail for manual review before permanently changing the registry.

## Field Registry

Maintain a small registry generated or updated from audit results:

```json
{
  "schema_version": "field-layering-v1",
  "fields": {
    "material": { "layer": "core", "category": "tribopair", "required": true },
    "ionic_liquid": { "layer": "core", "category": "lubricant", "required": true },
    "cof": { "layer": "core", "category": "metric", "required": true },
    "speed": { "layer": "extension", "category": "condition", "required": false },
    "current": { "layer": "flexible", "category": "condition", "required": false },
    "iron_oxide_additive_ratio": {
      "layer": "flexible",
      "category": "lubricant_component",
      "required": false
    }
  }
}
```

The registry should be treated as a reviewable recommendation, not as an automatic destructive migration. A field can be promoted from flexible to extension or core after enough real literature supports it.

## Extraction Flow

During extraction:

1. Parse fixed fields as before.
2. Parse extra variables from tables, captions, and nearby text.
3. Normalize known synonyms:
   - `current`, `applied_current`, `electric_current`
   - `current_density`
   - `iron_oxide`, `Fe2O3`, `ferric oxide`
   - `additive_ratio`, `additive_loading`, `mass_fraction`, `wt%`
4. Save each extra variable into `_flexible_fields`.
5. Attach source evidence and source page where possible.
6. For lubricant additives, also update `lubricant_components_json`.
7. For conditions, include the field in condition evidence so review/database can show it.

## UI Behavior

The database/review table should stay compact.

- Core fields remain in the main visible record structure.
- Extension fields appear as condition/component chips when present.
- Flexible fields appear in a small expandable "Variables" area or evidence popover.
- A field-frequency table should show field name, layer proposal, paper presence, row coverage, evidence rate, and examples.
- Flexible fields should be visible enough to prevent loss, but not dominate common records.

For the new current/iron-oxide paper, the intended display is:

- Current appears as an operating condition chip.
- Iron-oxide additive appears as a lubricant component/additive chip.
- Additive ratio appears next to the additive component, not as a generic note.
- Evidence popover shows quote/page for both.

## Testing

Backend tests:

- Flexible variables are preserved even when not registered as fixed fields.
- Current/current density synonyms normalize into stable keys.
- Iron-oxide additive ratio normalizes into flexible fields and lubricant components.
- Frequency audit computes paper-level presence, row coverage, evidence rate, and layer proposal.
- Duplicate rows within one literature do not inflate paper-level presence.

Frontend tests:

- Condition evidence includes current when present.
- Lubricant component display includes additive compound and ratio.
- Flexible fields render without breaking compact table layout.
- Frequency table sorts and labels core/extension/flexible fields correctly.

## Rollout

1. Implement lossless flexible-field preservation.
2. Add audit service and CLI/API output.
3. Add targeted support for current and iron-oxide additive ratio.
4. Add compact UI display for flexible variables.
5. Run extraction on the new literature and subsequent papers.
6. Review the audit table before promoting fields between layers.

## Non-Goals

- Do not remove existing fixed columns.
- Do not force every rare field into the main table.
- Do not permanently classify fields from a single paper.
- Do not make the review process block on flexible fields unless they are promoted to core.
