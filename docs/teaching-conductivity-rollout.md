# Live conductivity teaching rollout — 2026-10-30

> Superseded for current classroom features by `docs/teaching-classroom-guide.md` (2026-10-31). AFM classroom artifacts, shared instructor stages, source-checked example keys and optional second-round crossover have since been implemented locally. Browser rehearsal and real-provider scientific acceptance are still required before campus rollout. The sections below describe the earlier increment, not the current completion state.

## Delivered in this increment

- Synchronized upstream `main` through `ef66f17` without merging NIST integration code.
- Kept the original six-field tribology teaching labs compatible. New Live classrooms select tribology or conductivity/electrochemistry.
- Added conductivity observations with ionic identity, property/landmark, value and unit, surface, temperature, composition, scan rate, potential, reference, method, varied parameter and its value, dependence and evidence locator.
- Teacher flow: create, select domain/channel, upload PDF, enter/import answer key, start groups, review submissions, finish and export records/assessment CSV.
- Student flow: join, receive PDF/group, enter/import observations, automatic server drafts with browser recovery and concurrent-edit protection, submit, view review and export own records.
- Both channels use the same schema. AI extraction calls the existing domain extractor; it is disabled when no provider is configured. No mock extraction is substituted.
- Answer-key changes rescore submissions without cancelling in-flight AI attempts. Stale edits return HTTP 409. Ended classrooms reject further edits.
- Multipart upload limits are enforced before form parsing. Classroom exports require instructor role and never promote classroom data into the research database.
- Extraction, AFM and teaching pages share page spacing, width, neutral background and brand color tokens. Domain-specific research record layouts remain intact.
- The prediction page explicitly identifies its current synthetic trend simulation; it is not a trained research predictor.

## How to use

1. Start IonicLink with the normal development command and open `/teaching/extraction`.
2. Sign in as an administrator for the instructor console; students use ordinary platform accounts.
3. Create a classroom and choose **Conductivity & electrochemistry**. Manual mode works without a model key.
4. Upload a paper and use **Download template** for the domain-specific CSV. Write `NR` for unreported fields, never a replacement zero.
5. Use one row per property and condition. Preserve a curve/table's changing variable and associated value. Do not mix different ionic liquids, reference electrodes or conditions into one measurement.
6. Upload/save the answer key, wait for students to join, then start. Both the answer key and student work can contain multiple rows.
7. Review automatic matches before interpreting accuracy. Text aliases and scientific trends are not semantic judgments; instructors can mark correct, incorrect or uncertain.
8. **Records CSV** exports observations and conditions. **Assessment CSV** exports per-cell comparison, marks and timing. Uncertain cells stay in the denominator and are counted separately.

Timing is wall-clock time from the first server-saved edit (AI: extraction start) to submission. It includes pauses; it is not an active-attention metric.

## NIST isolation and recovery

- The standalone NIST source/runtime and ILThermo/ThermoML archives remain outside this repository.
- Existing Start/Pause/Check scripts now reference the independent project. No download was restarted by this teaching update.
- Recovery bundles, pre-sync backups, environment backups and data snapshots remain local.
- Those backups and the local NIST archive are not repository deliverables. Do not commit `.env.local`, databases, literature archives or RAR files.

## Explicitly not completed yet

- AFM-specific classroom tasks and server-backed sharing/review of new AFM digitization drafts. Existing research curves and browser drafts are not migrated or relabelled as verified.
- Diffusion-specific Live classroom schemas.
- Conductivity/AFM model training, MD integration or three-way prediction. Current prediction UI remains a labelled simulation.
- Real-provider AI end-to-end validation on this computer: no model is currently configured. Manual classroom behavior, source-to-row mapping and access controls are testable without paid calls.

## Validation

Targeted unit/API/render checks cover domain compatibility, unit equivalents, dimension separation, row reordering, extra rows, NR handling, source mapping, CSV round trips, autosave conflicts, role isolation, cross-origin rejection, file-size bounds, review and next-classroom access. Browser checks use isolated test accounts/data, not real student grades or research measurements.

Final local verification:

- All 162 test files passed with `npm test` after fixing stale permission assertions and releasing the cached OCR worker when its API test finishes. The OCR cleanup does not change the extraction algorithm.
- Optimized build passed, including lint/type checks and all 43 static pages, using the separate `.next-preview` output directory.
- Browser: student joined, received the PDF, edited all conductivity fields, autosaved, reloaded without losing records, submitted and downloaded CSV. Instructor reviewed a field as uncertain, saved a note, saw rescoring and downloaded assessment CSV.
- Independent NIST service: local `EMIM TFSI` search returned 1,412 datasets; `hZxWt` CSV export returned HTTP 200. No online re-download or platform import was needed.
- Pre-existing database row counts match the backups: 146 conductivity records, 4 tribology records, 0 diffusion records and 10 account rows. All 19 AFM JSON files matched their pre-sync SHA-256 hashes. The new classroom demo lives only in the isolated browser-test directory.
- Main development app is listening on loopback port 3000. The independent NIST browser is listening on loopback port 3030. No changes have been committed, pushed or deployed to the campus server.
