import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { createRecords, deleteRecords } from "../../../lib/db";
import { ingest as ingestTribology } from "../../../lib/ingest";
import { ingest as ingestConductivity } from "../../../lib/conductivity/ingest";
import { POST } from "./export/route";
import { createTestAppSession } from "../../../lib/auth.test-helpers";

const MARK = "__VISIBLE_EXPORT_TEST__";

function exportRequest(domain: string, ids: unknown, cookie: string) {
  return POST(
    new NextRequest(`http://localhost/api/${domain}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie, origin: "http://localhost" },
      body: JSON.stringify({ ids }),
    }),
    { params: { domain } }
  );
}

async function main() {
  const { cookie } = await createTestAppSession();
  const tribology = createRecords(
    "tribology",
    ["first", "second", "hidden"].map((suffix) =>
      ingestTribology({
        paper: { title: `${MARK}-${suffix}` },
        cation: "[BMIM]",
        anion: "[PF6]",
        substrate: "mica",
        temperature: "298 K",
        load: "5 nN",
        cof: 0.1,
      })
    ),
    "review"
  );
  const conductivity = createRecords(
    "conductivity",
    ["one", "two", "three", "foreign"].map((suffix) =>
      ingestConductivity({
        paper: { title: `${MARK}-conductivity-${suffix}` },
        cation: "[BMIM]",
        anion: "[PF6]",
        surface: "gold",
        temperature: "298 K",
        conductivity: "1 mS/cm",
      })
    ),
    "review"
  );

  try {
    const ordered = await exportRequest("tribology", [tribology[1].id, tribology[0].id], cookie);
    assert.equal(ordered.status, 200);
    assert.match(ordered.headers.get("Content-Type") ?? "", /^text\/csv/);
    assert.match(ordered.headers.get("Content-Disposition") ?? "", /ioniclink-tribology-visible\.csv/);
    const csv = await ordered.text();
    assert.ok(csv.indexOf(`${MARK}-second`) < csv.indexOf(`${MARK}-first`), "CSV preserves the requested ID order");
    assert.doesNotMatch(csv, new RegExp(`${MARK}-hidden`), "records outside ids[] are never exported");

    const foreign = await exportRequest("tribology", [conductivity[3].id], cookie);
    assert.equal(foreign.status, 404, "an ID absent from the requested domain is rejected");
    assert.match((await foreign.json() as { error: string }).error, /not found in tribology/i);

    const malformed = await exportRequest("tribology", [tribology[0].id, 42], cookie);
    assert.equal(malformed.status, 400);

    const unknownDomain = await exportRequest("unknown", [tribology[0].id], cookie);
    assert.equal(unknownDomain.status, 404);
  } finally {
    deleteRecords("tribology", tribology.map((record) => record.id));
    deleteRecords("conductivity", conductivity.map((record) => record.id));
  }

  console.log("Visible-record CSV export route tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
