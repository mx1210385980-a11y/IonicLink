"""Library dedup: keep 1 source per duplicate filename (migrate records),
delete redundant sources + their jobs, delete confirmed duplicate records."""
import sqlite3, json, shutil, os
from collections import defaultdict

DB = r"D:\Julyanffzz\Project\ioniclink\data\tribology.db"
SRC_DIR = r"D:\Julyanffzz\Project\ioniclink\data\tribology\sources"
DUPLICATE_RECORDS = ["#1055", "#714"]  # confirmed same measurement point as #582/#208

db = sqlite3.connect(DB)
db.execute("PRAGMA journal_mode=WAL")
c = db.cursor()

audit = {"migratedRecords": 0, "deletedJobs": 0, "deletedJobEvents": 0, "deletedSources": 0,
         "deletedRecords": 0, "removedDirs": 0, "failedDirs": []}
deleted_source_ids = set()

try:
    # ---- PDF dedup: group sources by filename ----
    c.execute("SELECT id, filename, created_at FROM sources ORDER BY filename, created_at")
    sources = [{"id": r[0], "filename": r[1], "createdAt": r[2]} for r in c.fetchall()]

    # record counts per source (payload.sourceId)
    c.execute("SELECT id, payload FROM records")
    rec_count = defaultdict(int)
    rec_payloads = []
    for rid, payload in c.fetchall():
        try:
            p = json.loads(payload)
        except Exception:
            continue
        sid = (p.get("sourceId") or "").lower()
        rec_count[sid] += 1
        rec_payloads.append((rid, payload, p, sid))

    by_name = defaultdict(list)
    for s in sources:
        by_name[s["filename"]].append(s)

    dup_groups = {f: v for f, v in by_name.items() if len(v) > 1}
    print(f"duplicate filename groups: {len(dup_groups)}")

    for fname, group in sorted(dup_groups.items(), key=lambda x: -len(x[1])):
        # keep the source with the most records; tie -> earliest created
        keeper = max(group, key=lambda s: (rec_count.get(s["id"], 0), -len(s["createdAt"])))
        removes = [s for s in group if s["id"] != keeper["id"]]
        removed_ids = {s["id"] for s in removes}

        # migrate records of removed sources to keeper
        for rid, payload, p, sid in rec_payloads:
            if sid in removed_ids:
                p["sourceId"] = keeper["id"]
                c.execute("UPDATE records SET payload = ? WHERE id = ?",
                          (json.dumps(p, ensure_ascii=False), rid))
                audit["migratedRecords"] += 1

        # delete jobs owned by removed sources + their events
        for s in removes:
            job_rows = c.execute("SELECT id, payload FROM jobs").fetchall()
            for jid, jpayload in job_rows:
                try:
                    jp = json.loads(jpayload)
                except Exception:
                    continue
                if (jp.get("sourceId") or "").lower() == s["id"]:
                    ev = c.execute("DELETE FROM job_events WHERE job_id = ?", (jid,)).rowcount
                    audit["deletedJobEvents"] += ev
                    c.execute("DELETE FROM jobs WHERE id = ?", (jid,))
                    audit["deletedJobs"] += 1

        # delete source rows
        for s in removes:
            c.execute("DELETE FROM sources WHERE id = ?", (s["id"],))
            deleted_source_ids.add(s["id"])
        audit["deletedSources"] += len(removes)
        print(f"  {fname!r}: {len(group)} -> keep {keeper['id'][:8]} ({rec_count.get(keeper['id'],0)} recs) "
              f"remove {[s['id'][:8] for s in removes]}")

    # ---- record dedup: confirmed duplicates ----
    for rid in DUPLICATE_RECORDS:
        cur = c.execute("SELECT id FROM records WHERE id = ?", (rid,)).fetchone()
        if cur:
            c.execute("DELETE FROM records WHERE id = ?", (rid,))
            audit["deletedRecords"] += 1
            print(f"  record {rid} deleted")

    db.commit()
    print("\nAUDIT:", json.dumps(audit, ensure_ascii=False))
except Exception:
    db.rollback()
    raise
finally:
    db.close()

# ---- disk cleanup: remove source directories for deleted sources ----
for sid in sorted(deleted_source_ids):
    d = os.path.join(SRC_DIR, sid)
    if os.path.isdir(d):
        try:
            shutil.rmtree(d)
            audit["removedDirs"] += 1
        except OSError as e:
            audit["failedDirs"].append(sid)
print("disk cleanup:", json.dumps({"removedDirs": audit["removedDirs"], "failedDirs": audit["failedDirs"]}, ensure_ascii=False))
