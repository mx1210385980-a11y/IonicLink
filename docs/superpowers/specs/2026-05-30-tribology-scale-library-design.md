# Tribology Scale Library Design

Date: 2026-05-30

## Goal

IonicLink should treat macroscale tribology and nanoscale tribology as separate scientific views without duplicating the same literature or fragmenting shared records. The platform should keep one canonical tribology data store, but expose two first-class library lanes:

- **Nano / AFM** for nanotribology, surface force balance, AFM/FFM, colloidal probes, sharp tips, surface pairs, layering, film thickness, and potential-controlled interfacial structure.
- **Macro / Tribometer** for ball-on-disk, pin-on-disk, four-ball, block-on-ring, reciprocating tribometers, wear scars, wear rates, load in N, speed in rpm or engineering sliding speed, and lubricant formulation performance.

This keeps cross-scale papers coherent while preventing the UI and extraction schema from forcing one scale's vocabulary onto the other.

## Core Decision

Use **one physical database, two logical library views**.

The current `tribology_data` model already carries `experiment_scale`, `experiment_method`, `measurement_type`, and `tribological_system_json`. Those fields should become the routing layer:

- `experiment_scale = nanoscale` routes to the Nano / AFM lane.
- `experiment_scale = macroscale` routes to the Macro / Tribometer lane.
- `experiment_scale = microscale` or `unknown` remains visible in an All / Needs classification lane until corrected.
- `training_view` continues to separate `afm_surface_response`, `macro_performance`, and `cross_scale` model usage.

Do not split into separate physical tables yet. Cross-scale papers, shared DOI metadata, shared extraction cache, deduplication, review workflow, and publish logic should remain canonical.

## Contact Display

The current Tribopair Capsule is correct for nanoscale records but should evolve into an adaptive contact component.

### Nano / AFM Mode

Display language:

- Primary relation: **Probe -> Substrate**
- Examples: `Si3N4 tip -> Mica`, `Silica colloid -> Graphite`, `Mica surface -> Mica surface`
- Supporting details: tip radius, colloid radius, probe roughness, substrate coating, substrate roughness, film thickness.

Visual grammar:

- Tip triangle, colloid circle, surface-pair slab, substrate base.
- Compact vertical contact diagram.
- Keep probe contact details inside Tribopair, not in condition chips.

### Macro / Tribometer Mode

Display language:

- `ball_on_disk`: **Ball <-> Disk**
- `pin_on_disk`: **Pin <-> Disk**
- `four_ball`: **Ball set** or **Upper ball <-> Lower balls**
- `ball_on_3_pins`: **Ball <-> 3 pins**
- `block_on_ring`: **Block <-> Ring**
- Fallback: **Counterface <-> Specimen**

Examples:

- `Steel ball <-> Steel disk`
- `Al2O3 ball <-> Ti6Al4V disk`
- `Steel pin <-> DLC-coated disk`

Visual grammar:

- Horizontal engineering contact diagram rather than vertical probe/substrate.
- Use small icons/shapes for ball, pin, disk, ring, and block.
- Avoid the words `Probe` and `Substrate` for clear macroscale records unless the source explicitly uses them.
- Keep macro-specific details close to the contact pair: ball diameter, disk material/coating, contact load, wear scar, roughness.

## Data Normalization

Extraction and normalization should preserve the existing fields but map scale-specific vocabulary into a shared contact contract.

Recommended derived view model:

```ts
type ContactDisplayModel = {
  mode: 'nano' | 'macro' | 'unknown'
  pattern: 'probe_substrate' | 'ball_disk' | 'pin_disk' | 'four_ball' | 'ball_pins' | 'block_ring' | 'counterface_specimen'
  primaryLabel: string
  secondaryLabel: string
  detailBadges: string[]
  title: string
}
```

Mapping rules:

- Nano records use `probe_material`, `probe_geometry`, `probe_radius`, `substrate_material`, `substrate_coating`, `film_thickness`.
- Macro records may still reuse `probe_material` as the counterbody and `substrate_material` as the specimen/disk, but the UI labels them according to method.
- `tribological_system_json.contact_geometry` and `experiment_method` have priority over raw text.
- If scale is unknown but method contains `ball-on`, `pin-on`, `four-ball`, `tribometer`, or load units in N, classify as macro candidate.
- If method contains `AFM`, `FFM`, `SFB`, `colloid probe`, `tip radius`, or load units in nN/uN, classify as nano candidate.

## Frontend Behavior

Library and database surfaces should offer three quick views:

- **Nano / AFM**
- **Macro / Tribometer**
- **All**

The active view should filter by `experiment_scale` but keep DOI, lubricant, tribopair, and COF filters working as they do now.

The database table should use the adaptive contact component in both `RecordTable` and `VirtualRecordRow`, so macro and nano records do not diverge.

Condition chips should remain reserved for environmental and operating conditions. Contact identity belongs in the contact component, not in `SURF`.

## Backend Behavior

The extractor prompt already asks for `tribological_system` and supports `ball_on_disk`, `pin_on_disk`, `four_ball`, and `afm_colloidal_probe`. The platform should strengthen this into a routing contract:

- Always fill `experiment_scale` when evidence is sufficient.
- Always fill `experiment_method` or `tribological_system_json.method` when a standard tribology setup is visible.
- Backfill existing records with scale/method heuristics where missing.
- Keep publish, deduplication, and database queries cross-scale aware.

No new table is required in this iteration.

## Error Handling

If a record has conflicting signals, keep it in the All lane and mark it as needing scale review.

Examples:

- `experiment_scale = nanoscale` but method is `ball_on_disk`.
- `experiment_scale = macroscale` but evidence says AFM tip radius.
- High-load macro units appear in a source section but the record source is an AFM figure.

The UI should show a small review hint rather than silently forcing the record into one lane.

## Testing

Add focused tests for:

- `ball_on_disk` renders as Ball <-> Disk, not Probe -> Substrate.
- `pin_on_disk`, `four_ball`, and `ball_on_3_pins` render with macro labels.
- AFM tip, colloidal probe, and surface pair keep the current Nano / AFM capsule behavior.
- Unknown scale falls back gracefully and does not lose contact materials.
- Condition groups do not reintroduce contact identity as `SURF`.

## Implementation Order

1. Add a contact display helper that builds `ContactDisplayModel`.
2. Upgrade `TribopairCapsule` into an adaptive component while preserving the current nano layout.
3. Add macro visual variants and labels.
4. Add view filters for Nano / AFM and Macro / Tribometer in the database/library surface.
5. Add backfill or review utilities for missing scale/method values.
6. Deploy and verify both local and remote frontend/backend.

