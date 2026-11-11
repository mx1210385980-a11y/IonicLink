# Classroom handoff: conductivity and AFM

## One entry and three instructor stages

Open `/teaching/extraction` (AI experiment, Experiment I). Platform administrators see the instructor console; ordinary accounts see the student classroom. Do not create separate conductivity or AFM teaching backends.

The console follows **Prepare lesson -> Run classroom -> Review and export**. Only the selected stage is shown. Observations are paginated one at a time, with Measurement, Conditions, and Dependence/source groups. Lesson briefs, group summaries, assessment settings and crossover comparison are optional expandable sections.

The existing six-field tribology labs and their historical records remain compatible. The new Live registry supports tribology, conductivity/electrochemistry and AFM. A diffusion-specific teaching schema was not found in the synchronized upstream code; this work does not pretend that it exists or invent a diffusion lesson.

## 1. Prepare lesson

1. Create a classroom, select its domain and choose 2-8 groups.
2. Select manual groups, or alternating automatic/AI-assisted and manual groups. Conductivity AI requires a configured real extraction provider. AFM automatic recognition runs locally using the same recognizer as the research workspace; it does not need a paid language-model key.
3. Upload one readable PDF (20 MB maximum). Papers with no extractable text are currently rejected by the classroom upload workflow. Research image upload remains separate.
4. Open the lesson brief. The worked conductivity and AFM cases include instructor-only answer-key downloads. Upload the matching source paper yourself; no literature or grades are silently imported.
5. Write **Student task / target figures**: identify the table/panels, properties and comparisons to report, without revealing answers. Conductivity AI receives this scope separately from source evidence. AFM recognizes credible panels in the paper; students must remove out-of-scope proposals during review.
6. Enter or import the answer key using the domain-specific CSV/TSV/XLSX template. Each row is one property/landmark and its conditions. Complete every field; use NR for unreported information, never zero as a replacement.
7. Verify the key against the paper and save it. A replacement paper clears the old key, task and assessment policy. Concurrent key edits are version-checked; unsaved instructor edits are not replaced by polling.

New classrooms cannot start without a paper, a saved key and at least one student. These checks also run on the server, not only on disabled buttons. Legacy classrooms retain their older compatibility behavior.

### Assessment settings

Default: strict numeric comparison after supported unit conversion. Measured value/separation can have an instructor-selected relative tolerance (0-20%) and optional absolute tolerance with unit. An absolute tolerance only applies to a quantity with the same dimension. Conditions such as temperature or voltage are not relaxed by these tolerances.

Supported comparisons include C/K, conductivity, voltage, scan rate, current, force, length, spring constant and selected area-normalized electrochemical units. Absolute, mass-normalized and area-normalized quantities remain distinct. Unknown units must match exactly. Known ion aliases and a small set of trend spelling variants are normalized; open scientific interpretations still require instructor review.

Accuracy is matched fields divided by the maximum of answer/student row counts times the field count. Rows are matched one-to-one independently of order. Missing/extra rows count against accuracy. Correct/incorrect/uncertain review marks are retained; uncertain fields remain in the denominator. This is field-level classroom assessment, not certification of a research measurement.

## 2. Run classroom

1. Students sign in with their own platform accounts and open the same teaching entry.
2. If several classrooms are available, students choose the instructor's classroom. An active classroom cannot be silently replaced by joining another one.
3. Check the roster, paper and answer-key checklist, then start. Groups are assigned on the server and frozen.
4. Students read the assigned task and PDF, enter/import observations, or run their assigned automatic/AI-assisted extraction and review its proposals.
5. Student observations autosave to the server, with browser recovery and concurrent-edit protection. All fields, including collapsed sections, must be completed or explicitly NR before submission in a new classroom.
6. Students submit only after saving is confirmed. Timing is wall-clock time, including pauses: manual work starts at the first saved edit; automatic work starts at extraction. It is not active-attention time.

For AFM, source crops, curve samples, physical/relative coordinate status and segment gaps are stored on the classroom server. A teacher can open the student's saved panels during review. Student CSV/PNG downloads identify classroom digitization and do not label it as a verified research measurement.

Automatic AFM extrema are explicitly named minimum/maximum **digitized** force within the plot. They are not automatically interpreted as layer spacings, rupture forces or adhesive forces. Printed arrow annotations are a different task: students must read/check them. No default zero voltage or room-temperature assumption is substituted for missing conditions.

## 3. Review and export

1. View the compact student summary, optionally expand group summaries, and select a submitted student.
2. Open the source PDF and, for automatic AFM work, its saved source/extracted panels. Review individual fields, use correct/incorrect/uncertain marks and add a student-visible note.
3. Download **Records CSV** for observations and conditions; download **Assessment CSV** for per-field comparisons, review marks, timing and tolerance policy. Curve CSV/PNG is available in the AFM panel viewer.
4. Finish the classroom when appropriate. Finishing closes further student edits/submissions; the UI warns about unsubmitted students. Review and export remain available.

### Optional second-round crossover

After all students submit and an alternating-method classroom is finished, expand **Optional: second-round crossover**. Prepare round 2 with a different paper and a new key. The same student roster/groups are retained and methods are swapped; old answers/grades are preserved. Renaming/re-uploading the same PDF text is rejected. The paired comparison is descriptive, not a controlled causal estimate.

## Source-checked worked cases

- Conductivity: Giroud et al., ECS Meeting Abstracts MA2008-02, abstract 26, PDF p. 2, Table 1. Five conductivity values at 20 C. Viscosity is not a conductivity column; unordered ionic-liquid identities do not define a monotonic slope. The general temperature statement is not converted into an invented numeric temperature series.
- AFM: McLean et al., DOI `10.1039/c4cp04522j`, existing `15.pdf`, PDF pp. 3-4. Sixteen printed arrow-position separations in Fig. 1A-E, [Li(G4)]TFSI/HOPG. Arrow positions are not adjacent-layer widths. Silicon probe and Pt pseudo-reference are reported; the DFT calculation's 298 K is not assigned to AFM measurements.

The platform limits key-pack downloads to instructors. Built-in examples come from published papers and their answers are visible in the repository's server source, though not bundled into student JavaScript. For assessed work, upload a separate answer key through the instructor console instead of committing it. Check the selected paper and task before class.

## Storage, isolation and deployment

Move `teaching.db`, `teaching-papers/` and the new `teaching-afm/` folder together when migrating classroom data. AFM artifacts have immutable generated IDs and authenticated access. Students cannot fetch another participant's result by changing the URL. No classroom submission is promoted into conductivity/AFM research data automatically.

NIST remains an independent project. No MD training or conductivity/AFM research predictor is introduced. Experiment II retains its explicit trend-simulation warning.

The pre-change backup is stored outside the repository. The feature branch does not deploy the campus server. Do not commit databases, original PDFs, downloaded NIST data, credentials or RAR archives.

## Validation and remaining release gate

Automated checks cover domain compatibility, classroom readiness, key version conflicts, record pagination, unit/dimension handling, finite grading tolerances, draft recovery, teacher review, CSV/PNG exports, role isolation, source replacement and two-round assignment.

The opt-in real-paper acceptance uses `TEACHING_AFM_ACCEPTANCE_PDF` with `15.pdf`, in an isolated test data directory. It exercises classroom creation, actual PDF upload, local recognition, artifact retrieval, point/PNG export, submission, record export and duplicate-paper rejection. It records separately that **human annotation review is simulated**; a perfect score after replacing proposals with the checked key is not an automatic extraction accuracy result.

The real-paper check also guards against crop-padding coordinate offsets. Numeric source profiles are now anchored to positioned ticks before physical export. Explicit shared-grid geometry may be inherited; unresolved frames remain relative. Original gaps are preserved, and no experimental baseline is forcibly subtracted. The 2.5%-of-force-range tail check is a coarse raster regression guard, not an uncertainty certificate or a publication-quality accuracy claim.

Browser interactive acceptance remains a release gate: the native Computer Use connection on this machine returned `native pipe unavailable (os error 2)`. Component/API tests and a successful build are not a substitute for a real instructor/student rehearsal. Conductivity's real-provider AI path also needs validation with the configured model; mocked-provider tests do not establish its scientific accuracy. Do not present this increment as already classroom-piloted or deployed.

### Local verification completed on 2026-10-31

- Complete automated regression: 169 test files, no failures. The real-paper acceptance is opt-in during the default run; it was also executed separately with the actual PDF. The pre-existing conditional real-database structure-coverage check remains conditional on its fixture.
- Lint and TypeScript checks passed with no ESLint warnings. Targeted checks were repeated after the final unsaved-review and tolerance-validation safeguards.
- Production build succeeded; local `/teaching/extraction`, `/afm` and `/conductivity/database` returned HTTP 200.
- Real AFM paper: 20 source panels, 20 physically calibrated results, 179-333 retained trace points per panel. Source panel and exported PNG were inspected. Forty automatic extrema proposals are distinct from the sixteen source-checked annotation answers. Human annotation review was simulated in the lifecycle test, not performed automatically by the recognizer.
- Long-distance median-force residuals were retained, not subtracted; the largest absolute residual in this coarse raster check was approximately 0.251 nN. This does not certify numerical accuracy at all landmarks.
- All 19 AFM research JSON files match the pre-work backup byte-for-byte (SHA-256). Research record counts remain 4 tribology, 146 conductivity and 0 diffusion; isolated classroom tests did not import demonstration accounts, grades or measurements into those databases.
- Regression exposed an existing usage-monitor bug: recent API actions could replace the user's latest viewed module with `Other`. The summary now selects the latest page view with deterministic timestamp/id ordering; its regression test passes.

Acceptance artifacts are kept outside Git. They include an original panel, exported PNG and points, and `real-paper-classroom-report.json`; no credentials or session cookies are included.
