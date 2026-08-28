# IonicLink v2

A compact, elegant system for extracting **standardized ionic-liquid data** from
scientific papers. Three **isolated modules** share one workflow:

- **Tribology** — *ionic liquid → tribopair → conditions → COF* (friction).
- **Conductivity** — *ionic liquid → surface → conditions → σ* (ionic conductivity).
- **Diffusion** — *ionic liquid → species → conditions → D* (self-diffusion; one record per diffusing ion).

Each module has its own database file (`data/<domain>.db`), extraction prompt, schema, and
review queue, so the datasets can never cross-contaminate. The app routes are
`/<domain>/{extract,database,library,design}` with a domain switcher in the nav. The
**Design Studio** (`/<domain>/design`) predicts the domain's property for unmeasured
cation×anion pairs and ranks new candidate materials — every estimate is a weighted
combination of the curated records, cited down to the verbatim quote, and the whole
instrument honestly gates itself while a domain's dataset is still small.

## The flow

```
Extract            Review              Publish
─────────          ────────            ─────────
PDF / text   ─▶    Review Queue   ─▶   Checked Database   ─▶  CSV
(AI extract)       (approve/edit)      (clean records)        (export)
```

1. **Extract** — drop a PDF or paste text. Claude-compatible tool use
   standardizes every friction result into candidate records. No key? A deterministic
   mock extractor keeps the whole flow working offline.
2. **Review** — candidates land in the Review Queue. Approve the accurate ones into the
   Checked Database; reject the rest. Nothing is published blindly.
3. **Export** — filter by scale (nano/AFM vs macro/tribometer) or search, then download CSV.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind**
- **better-sqlite3** — one local file per domain (`data/<domain>.db`) plus the isolated
  classroom store (`data/teaching.db`), with no DB server
- **OpenAI-compatible chat completions** + **@anthropic-ai/sdk fallback** — structured extraction via forced tool-use
- **unpdf** — serverless-friendly PDF text extraction
- **smiles-drawer** — 2D structure rendering from SMILES
- **Ketcher standalone** — browser-based molecular structure editor
- **OpenChemLib** — canonical molecular-graph keys for indexed exact structure search

## Run it

```bash
npm install
npm run migrate            # one-time: data/ioniclink.db → data/tribology.db (no-op on fresh installs)
npm run migrate:structures # optional backup + rebuild of exact-search structure keys
npm run dev                # http://localhost:3000
npm test                   # run the standalone node:assert test suite
npm run check:fast         # lint + TypeScript check
npm run check              # full verification: lint, types, tests, production build
```

Sample data is optional. Each seed command is safe by default: it only seeds an empty
domain database and refuses to overwrite existing records.

```bash
npm run seed               # tribology
npm run seed:conductivity  # conductivity
npm run seed:diffusion     # diffusion
```

To intentionally delete and rebuild a domain's records, pass `--reset` explicitly.
Before deleting anything, IonicLink writes a SQLite snapshot to `data/backups/`:

```bash
npm run seed -- --reset
npm run seed:conductivity -- --reset
npm run seed:diffusion -- --reset
```

For live AI extraction, copy `.env.local.example` → `.env.local` and set `OPENAI_BASE_URL` plus `OPENAI_API_KEY`.
Without it, the Extract page runs in mock mode. The teaching experiment uses checked-in,
frozen AI suggestions and does not require a live AI key.

### Zero-configuration teaching experiment

Open `/teaching`. Students enter only a pseudonymous ID (a student number or initials; no
real name, invite code, group code, or paper selection) and complete two automatically
assigned rounds. Reusing the same ID restores the current round and draft. For a 30-student
class, balanced assignment produces 15 students in each sequence:

| Sequence | Round 1 | Round 2 |
| --- | --- | --- |
| Manual → AI | Paper A, blank manual form | Paper B, frozen AI suggestions to verify or edit |
| AI → Manual | Paper A, frozen AI suggestions to verify or edit | Paper B, blank manual form |

All six values are required before a round can be submitted. Page and evidence fields remain
optional, but missing or incorrect citations reduce the evidence metrics. Drafts save
automatically. The client sends activity heartbeats every 15 seconds only while the page is
visible and the student has been active within the previous 120 seconds; no keystroke,
clipboard, or paper text is recorded.

The server bootstraps the versioned experiment from
`config/teaching/default-experiment.v1.json` on the first student join or teacher-dashboard
load. Teaching schema migrations are automatic; `npm run migrate` and the domain seed/reset
commands do not operate on teaching data. Runtime state is stored in
`${IONICLINK_DATA_DIR:-<repository>/data}/teaching.db` and is ignored by Git. For a fresh local
trial, point `IONICLINK_DATA_DIR` at a new empty directory instead of deleting or reusing a
real class database.

Set a long, unique `TEACHING_TEACHER_PASSWORD` before the teacher needs access. The teacher
uses the same `/teaching` entry and is redirected to `/teaching/admin`, which opens the
current experiment directly, refreshes while visible, and provides paired results,
paper/sequence/timing diagnostics, participant drill-down, and CSV exports. Teachers do not
create a project, configure papers, assign groups, or grade fields for the default workflow.

The primary analysis includes only students who completed both rounds, were not excluded,
have current automatic scores, have positive active time in both modes, and have `valid`
timing in both modes. Accuracy is `correct fields / 6`; coverage is `non-empty fields / 6`.
Within-student time and accuracy differences are `AI - manual`, so a negative time difference
means AI was faster. The saved-time headline is
`(manual median - AI median) / manual median`. The dashboard reports paired median
differences, seeded bootstrap 95% confidence intervals, and a two-sided Wilcoxon signed-rank
approximation (shown as unavailable with fewer than five non-zero differences). It also shows
evidence coverage/accuracy, AI adoption/modification, AI error correction/error adoption, and
the strict count that was both faster and more accurate with AI.

The normal CSV contains the entered student IDs; the anonymized export replaces them with
stable `S001`, `S002`, … labels. Both exports contain one row per participant with the two
rounds' aggregate metrics and an exclusion flag. Neither export contains final answer or
evidence text, frozen AI text, gold answers, scoring rules, participant IDs, or free-text
exclusion reasons. CSV output includes a UTF-8 BOM and spreadsheet-formula escaping.

The student UI and API never send gold rules, future-round answers, or AI suggestions during
a manual round. The gold rules are nevertheless part of the server source configuration; do
not give students repository/config access before a blind classroom run.

### Group crossover experiment (optional second experiment type)

Alongside the default experiment, teachers can create **group crossover** experiments from the
admin page: the class is split into an even number of groups, adjacent groups pair into
super-groups, and the two groups in a super-group swap papers and flip extraction mode between
rounds (odd group: AI-assisted first, even group: manual first). The teacher picks one checked
tribology record per group as the paper pool (one record = one operating-condition point),
imports a roster mapping student names/IDs to groups, and shares the experiment invite code.
Students join with their rostered name plus the code; auto-scoring uses the checked record as
the gold standard and teachers can override per-field verdicts, which then win in all
analytics and exports. See `docs/teaching-group-crossover.md` for the full teacher workflow
(Chinese).

## Data model

One record = one measured result (a COF for tribology, a σ for conductivity, a per-species D
for diffusion). The shared three-layer shape lives in [`lib/domain.ts`](lib/domain.ts); each
domain binds it to its own core/extended in [`lib/schema.ts`](lib/schema.ts) (tribology),
[`lib/conductivity/schema.ts`](lib/conductivity/schema.ts), and
[`lib/diffusion/schema.ts`](lib/diffusion/schema.ts). A module
([`lib/modules/`](lib/modules)) supplies each domain's prompt, tool schema, ingest, promoted
columns, and CSV. The DB keeps the full record as JSON plus a few promoted columns for fast
filtering — schema can evolve without migrations.

## Layout

| Path | What |
|------|------|
| `app/` | Next.js App Router pages and API routes |
| `app/page.tsx` | Global landing — chooser between the modules |
| `app/[domain]/` | Per-domain `page` (hero) + `extract` / `database` / `library` / `design` |
| `app/api/[domain]/` | `extract`, `batch`, `records` (CRUD + bulk delete), `export`, `source` |
| `app/teaching/`, `app/api/teaching/` | Zero-configuration student/teacher pages and role-protected teaching APIs |
| `components/` | React UI components for extraction, records, navigation, and Design Studio |
| `components/teaching/` | Student gateway/workspace and the live paired teacher dashboard |
| `lib/domain.ts` | `Domain`, the generic `DomainRecord`, the per-domain DB-file boundary |
| `lib/modules/` | The `Module` contract + `tribology` / `conductivity` / `diffusion` implementations + registry |
| `lib/conductivity/`, `lib/diffusion/` | Per-domain schema, ingest, and extractor |
| `lib/predict/` | The Design Studio engine — ion descriptors, kernel regression, Arrhenius fits, LOO calibration, candidate atlas |
| `lib/` | shared `db`, `extract`, `units`, `pdf`, `csv`, `ionStructures`, and teaching facade |
| `lib/teaching/` | Versioned bootstrap, migrations, assignment, scoring, activity, and paired analytics |
| `config/teaching/` | Immutable default paper pair, frozen AI suggestions, and deterministic gold rules |
| `scripts/` | seed, migration, WFF reproduction, cache prewarm, and evaluation utilities |
| `data/wff/` | small WFF model/evaluation fixture CSV files used by tests and local reproduction |
| `data/tribology/gold-standard/` | small extraction-evaluation fixture JSON |

## Repository hygiene

The repository intentionally keeps only source code, configuration, tests, and small
reproducible fixtures. Runtime and research-library artifacts stay outside Git:

- local SQLite databases: `data/*.db`, `data/*.db-*`, `data/*.sqlite*` (including the
  pseudonymous classroom responses in `teaching.db`)
- uploaded source PDFs and rendered page images: `data/*/sources/`
- generated reports and local cache folders: `reports/`, `.next*`, `.superpowers/`
- large literature/reference dumps, thesis drafts, debug exports, and personal notes

This keeps GitHub cloneable and deployable without mixing application code with the live
server database or one-off research backups.
