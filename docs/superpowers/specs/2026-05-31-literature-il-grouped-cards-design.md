# Literature IL Grouped Cards Design

## Goal

For one literature item, show all tribology rows for the same ionic liquid in one comparison card, with each distinct tribological system and condition set rendered as compact rows. This makes extraction review feel like reading a paper-level comparison table instead of scanning disconnected records.

## User Problem

Fresh extractions, especially review papers or dense 2022 papers, can produce many candidate and final rows for the same ionic liquid. The current preview and review surfaces list rows individually. That hides the paper's logic: one ionic liquid may be tested across different probe/substrate pairs, loads, potentials, base oils, additives, or source figures. Users cannot quickly see which systems were captured, which were only weak candidates, and where data is missing.

## Requirements

- Group records within the selected literature by normalized ionic liquid display name.
- Include both final records and review candidates in the same grouping model.
- Inside each ionic-liquid card, show comparison rows for distinct systems and conditions.
- Keep evidence-oriented metadata visible: source page, figure/source label, review status, missing fields, confidence tier, and weak-candidate origin.
- Preserve existing row-level editing and verification paths; the card view is an additional view, not a destructive replacement.
- First implementation lands in the extraction result preview because that is where the pain appears immediately after upload.
- Review surfaces should be able to reuse the same grouping helper without backend schema changes.

## Proposed UI

The selected file preview gets a small view switch: `Rows` and `By ionic liquid`. The grouped view renders one card per ionic liquid. Each card header shows the ionic liquid, cation/anion chips when available, and counts for systems, records, and rows needing review.

Within the card, each row is a compact comparison lane:

- System: `probe vs substrate (coating)` using the existing tribopair formatter.
- Conditions: load, speed, temperature, potential, water, concentration, film/layer values.
- Metrics: COF, wear rate, friction force if present.
- Evidence: page/source figure and status chips.

Rows stay dense because this is a research review workflow, not a landing page.

## Data Model

Frontend helper `groupTribologyRecordsByIonicLiquid(records)` returns:

- `key`: stable normalized group key.
- `label`: display label for the ionic liquid.
- `records`: original rows for editing and actions.
- `systems`: comparison row groups keyed by tribopair plus relevant condition fields.
- counts: `recordCount`, `systemCount`, `needsReviewCount`, `weakCandidateCount`.

The helper accepts `TribologyData[]` so it can be shared by upload preview and Review.

## Testing

- Unit tests prove records with the same ionic liquid but different systems are grouped into one card.
- Unit tests prove weak candidates and final records are counted together while preserving review status.
- Static component tests prove `BatchDataPreview.vue` exposes the grouped view and uses the shared helper.
- Build verification uses the existing frontend build.

