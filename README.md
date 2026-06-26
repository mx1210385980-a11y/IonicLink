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
PDF / text   ─▶    Review Queue   ─▶   Official Database  ─▶  CSV
(AI extract)       (approve/edit)      (clean records)        (export)
```

1. **Extract** — drop a PDF or paste text. Claude-compatible tool use
   standardizes every friction result into candidate records. No key? A deterministic
   mock extractor keeps the whole flow working offline.
2. **Review** — candidates land in the Review Queue. Approve the accurate ones into the
   Official Database; reject the rest. Nothing is published blindly.
3. **Export** — filter by scale (nano/AFM vs macro/tribometer) or search, then download CSV.

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind**
- **better-sqlite3** — one local file per domain (`data/<domain>.db`), no DB server
- **OpenAI-compatible chat completions** + **@anthropic-ai/sdk fallback** — structured extraction via forced tool-use
- **unpdf** — serverless-friendly PDF text extraction
- **smiles-drawer** — 2D structure rendering from SMILES

## Run it

```bash
npm install
npm run migrate            # one-time: data/ioniclink.db → data/tribology.db (no-op on fresh installs)
npm run seed               # seed the tribology database
npm run seed:conductivity  # seed the conductivity database
npm run seed:diffusion     # seed the diffusion database
npm run dev                # http://localhost:3000
npm test                   # run the standalone node:assert test suite
```

For live AI extraction, copy `.env.local.example` → `.env.local` and set `OPENAI_BASE_URL` plus `OPENAI_API_KEY`.
Without it, the Extract page runs in mock mode.

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
| `components/` | React UI components for extraction, records, navigation, and Design Studio |
| `lib/domain.ts` | `Domain`, the generic `DomainRecord`, the per-domain DB-file boundary |
| `lib/modules/` | The `Module` contract + `tribology` / `conductivity` / `diffusion` implementations + registry |
| `lib/conductivity/`, `lib/diffusion/` | Per-domain schema, ingest, and extractor |
| `lib/predict/` | The Design Studio engine — ion descriptors, kernel regression, Arrhenius fits, LOO calibration, candidate atlas |
| `lib/` | shared `db`, `extract`, `units`, `pdf`, `csv`, `ionStructures` |
| `scripts/` | seed, migration, WFF reproduction, cache prewarm, and evaluation utilities |
| `data/wff/` | small WFF model/evaluation fixture CSV files used by tests and local reproduction |
| `data/tribology/gold-standard/` | small extraction-evaluation fixture JSON |

## Repository hygiene

The repository intentionally keeps only source code, configuration, tests, and small
reproducible fixtures. Runtime and research-library artifacts stay outside Git:

- local SQLite databases: `data/*.db`, `data/*.db-*`, `data/*.sqlite*`
- uploaded source PDFs and rendered page images: `data/*/sources/`
- generated reports and local cache folders: `reports/`, `.next*`, `.superpowers/`
- large literature/reference dumps, thesis drafts, debug exports, and personal notes

This keeps GitHub cloneable and deployable without mixing application code with the live
server database or one-off research backups.
