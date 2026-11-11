# School deployment style alignment — 2026-10-31

## Scope and reference

The reference is the existing campus IonicLink deployment and its **Data overview** design: a graphite navigation rail, neutral page background, white bordered cards, readable sans-serif typography and teal actions.

The goal is to integrate our local conductivity, AFM and Live teaching additions into that design, not to replace team updates or deploy directly to the school server. NIST remains independent.

`git fetch origin` confirmed local HEAD and `origin/main` both at `ef66f17`, with no commits ahead/behind. There was no newer upstream change to merge; existing local feature changes were preserved.

## Changes

- Added a scoped school appearance to `WorkspacePageFrame`, following the overview's 1264px content width, responsive gutters and 30/36px titles. Existing generic extraction pages keep their original 1240px layout.
- Matched primary controls to the overview's `#00888a` teal, neutral `#dce0e4` borders, rounded white cards and visible keyboard focus. The stylesheet applies only under `data-workspace-theme="school"`.
- Restyled the AFM presentation, upload area, source-comparison header, browser header and summary cards. Removed decorative dark gradients and glow without removing evidence warnings or research context.
- Kept conductivity's shared database navigation/toolbars and the stacked ionic-liquid/electrode column with right-hand performance content. Restyled only its own card and curve-insight chrome; retained panel pagination and structured readings.
- Matched teaching titles, classroom creation, buttons and cards while retaining domain selection, draft recovery, scoring, teacher review and CSV exports. The prediction simulation warning remains visible.

No recognition algorithms, plot coordinates, axis calibration, units, trace colours, export functions, raw data, provenance or research database records are changed by this style increment. No automatic verification/confidence changes are made.

## Recovery and deployment boundary

The pre-change local patch, new source files and Git bundle were backed up outside the repository.

No credentials or authenticated session cookies are included. Publishing this feature branch does not deploy the campus server. Review the overlapping classroom changes on upstream `main` before merging.

## Validation

- Focused workspace/component tests passed. `npm run check:fast` passed lint and TypeScript checks.
- The complete regression run finished successfully across 163 test files. The conditional real-database ion-structure coverage check was skipped when its fixture was unavailable in the isolated test environment.
- The optimized production build using `.next-preview` succeeded and generated all 43 static pages.
- The running local development server returned HTTP 200 for `/afm`, `/teaching/extraction` and `/conductivity/database`. AFM and teaching served the scoped theme attribute, and the compiled stylesheet served the scoped school controls and teal palette. Conductivity themes its client-rendered record cards, not the shared database shell.
- All 19 AFM JSON files match the pre-teaching backup byte-for-byte (SHA-256). `git diff --check` passed.
- Fresh browser screenshot and interactive visual acceptance could not be completed because the native computer-use connection was unavailable. HTTP/build checks do not replace that visual acceptance; local preview remains available at `http://127.0.0.1:3000`.
