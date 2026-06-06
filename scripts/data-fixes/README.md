# Per-paper data fixes

> **Prefer the correction API over new raw-SQL scripts.** Reviewer corrections to
> a final record now have a sanctioned, validated, audited path:
> `POST /api/records/{record_id}/correct` (service:
> `backend/services/record_correction_service.py`). It applies corrected field
> values + curated per-field evidence, keeps the source candidate(s) in sync, links
> duplicates, recomputes confidence, and writes an activity-log entry. Pass
> `?dryRun=true` to preview the exact before/after diff before committing — the check
> that was missing when these scripts were written. Reach for a raw-SQL script here
> only for corrections the API genuinely can't express (e.g. literature-status edits).

One-off Python scripts that patch `backend/data/ioniclink.db` to correct
extraction mistakes for a specific paper. Each script targets a single DOI
(or a tight range of candidate IDs) and is kept here as an audit trail of
manual interventions — they're **not** meant to be re-run as part of normal
deployment.

## Naming

```
fix-<journal>-<year>-<scope>.py
```

e.g. `fix-chemcomm-2014-candidates-397-402.py` patches candidates 397–402
from a 2014 Chem. Commun. paper.

## Conventions every fix follows

- Resolves `DB_PATH` to `backend/data/ioniclink.db` relative to the repo root.
- Calls `backup_database(db_path)` before any mutation. The backup file lives
  next to the DB as `ioniclink.db.bak-<tag>-<unix-ts>`.
- Uses a single SQLite transaction per fix so partial writes can't land.
- Pins the acting user as `USER_ID = 1` (the seeded admin) for audit columns.

## Adding a new fix

1. Copy the most recent fix as a template.
2. Update the `DOI` (or candidate-ID list), the journal tag in the backup
   filename, and the field corrections.
3. Run once against a copy of the production DB. Verify with a `SELECT`.
4. Commit the script alongside the DB changes you produce.

## When a fix outgrows this folder

If the same correction shows up for ≥3 papers, promote the logic into
`backend/services/fallback_extraction_service.py` (or a sibling pre-processing
heuristic) so future extractions don't need the patch.
