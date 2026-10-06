# IonicLink v2

A compact, elegant system for extracting **standardized ionic-liquid data** from
scientific papers. Three **isolated modules** share one workflow:

- **Tribology** — *ionic liquid → tribopair → conditions → COF* (friction).
- **Conductivity** — *ionic liquid → surface → conditions → σ* (ionic conductivity).
- **Diffusion** — *ionic liquid → species → conditions → D* (self-diffusion; one record per diffusing ion).

Each module has its own database file (`data/<domain>.db`), extraction prompt, schema, and
review queue. The data-workspace routes are `/<domain>/{extract,database,library}`
with a domain switcher in the nav. **Model preview** (`/tribology/design`) is a
classroom simulation: its generated points and displayed metrics illustrate how
model settings affect a trend. They are not model-validation results from the
curated databases. The preview is currently available for tribology only.

## The flow

```
Extract            Review              Publish
─────────          ────────            ─────────
PDF / text   ─▶    Review Queue   ─▶   Checked Database   ─▶  CSV
(AI extract)       (approve/edit)      (clean records)        (export)
```

1. **Extract** — upload PDF or TXT papers for structured AI extraction, or import
   XLSX, CSV, or TSV datasets. Paper files and structured datasets use separate upload
   flows. Paper extraction requires a configured live provider; unconfigured extraction
   requests return a service-unavailable response.
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

For live AI extraction, copy `.env.local.example` → `.env.local` and configure one of its
supported providers. The default teaching AI group also requires a live extraction provider;
its extraction endpoint returns 503 when none is configured.

### Paper extraction teaching lab

Open `/teaching`. The current workflow compares AI-assisted and manual extraction of one
tribology paper. See [the teaching guide](docs/teaching-lab.md) for details.

1. The teacher opens **Instructor dashboard** → **New experiment**, selects an uploaded PDF,
   and verifies the answer key. Checked records provide a draft, or the teacher can upload
   a CSV, TSV, or XLSX answer table. Each experiment has up to 100 records and a fixed answer key.
2. Students choose **AI Extraction** or **Manual extraction**. The server assigns a student
   ID and enters the most recently created experiment. Valid cookies in the same browser
   restore each mode's saved progress while that experiment remains current.
3. The AI group starts live extraction, checks the candidate records against the source,
   edits as needed, and submits. **Save draft** persists edits for later restoration.
4. The manual group downloads a template, uploads the completed table, checks the saved
   preview, and submits with its self-recorded time in minutes.
5. The teacher dashboard refreshes every 15 seconds while visible, compares group results,
   and supports per-field review. Instructor decisions update final accuracy while preserving
   the original automatic score.

The six scored fields are `cation`, `anion`, `substrate`, `temperature`, `load`, and `cof`.
Records are matched one-to-one to maximize matching fields. Accuracy is
`matched fields / (max(answer-key records, student records) × 6)`, so missing or extra
records count in the denominator. Enter `NR` for unreported values; blanks are unmatched.
Temperature and load support unit conversion. The teacher can review equivalent terms or
other cases that the automatic comparison does not recognize.

AI time runs from the first extraction start to review submission, including model waits,
retries, time away from the page, and review. Manual time is self-reported. Group means use
submitted results only; the speed ratio is `manual mean time / AI mean time`. These are
descriptive classroom comparisons with different timing sources, not controlled causal results.

The current instructor entry is open: `/api/teaching/lab/enter` creates a teacher session
without a password. General application login and `TEACHING_TEACHER_PASSWORD` do not protect
this entry. Deployments requiring restricted teaching access need a separate access-control
configuration. The password setting remains used by the retained teaching-session login API.

Teaching tables initialize automatically in `${IONICLINK_DATA_DIR:-<repository>/data}/teaching.db`.
The teacher creates each experiment; source copies live under `teaching-papers/<sourceId>/`.
Student answers stay separate from the formal literature databases. Existing teaching tables,
crossover code, and valid unfinished sessions remain supported; `/teaching` and its instructor
dashboard use the workflow above. The retained crossover design is described in
[its reference guide](docs/teaching-group-crossover.md). Domain seed/reset commands do not
operate on teaching data. Use a new `IONICLINK_DATA_DIR` for an isolated local trial.

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
| `app/[domain]/` | Per-domain extraction, database, and document library; tribology model preview; domain roots redirect home |
| `app/api/[domain]/` | `extract`, `batch`, `records` (CRUD + bulk delete), `export`, `source` |
| `app/teaching/`, `app/api/teaching/` | Current paper-extraction lab and retained teaching-session APIs |
| `components/` | React UI components for extraction, records, navigation, and model preview |
| `components/teaching/` | Student gateway, manual/AI workspaces, and instructor review dashboard |
| `lib/domain.ts` | `Domain`, the generic `DomainRecord`, the per-domain DB-file boundary |
| `lib/modules/` | The `Module` contract + `tribology` / `conductivity` / `diffusion` implementations + registry |
| `lib/conductivity/`, `lib/diffusion/` | Per-domain schema, ingest, and extractor |
| `components/design/ModelPreview.tsx`, `lib/modelPreview.ts` | Interactive classroom model preview, simulation settings, and generated data |
| `lib/` | shared `db`, `extract`, `units`, `pdf`, `csv`, `ionStructures`, and teaching facade |
| `lib/teaching/` | Current lab storage, scoring, paper copies, and table import; retained crossover migrations and analytics |
| `config/teaching/` | Versioned paper pair, frozen AI suggestions, and gold rules for retained crossover sessions |
| `scripts/` | Seed, migration, data maintenance, and extraction-evaluation utilities |
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
