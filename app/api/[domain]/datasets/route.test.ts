import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { NextRequest } from "next/server";
import { listRecords, resetAll } from "@/lib/db";
import { createTestAppSession } from "@/lib/auth.test-helpers";
import { POST } from "./route";

async function request(bytes: Uint8Array, mode: "preview" | "commit", cookie: string) {
  const form = new FormData();
  const fileBytes = bytes.slice().buffer as ArrayBuffer;
  form.set("file", new File([fileBytes], "fixture.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  form.set("mode", mode);
  form.set("paperTitle", "Fixture paper");
  return POST(
    new NextRequest("http://localhost/api/diffusion/datasets", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
      body: form,
    }),
    { params: { domain: "diffusion" } }
  );
}

async function main() {
  const { cookie } = await createTestAppSession();
  resetAll("diffusion");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["ionic_liquid", "D_cation", "D_anion", "D_unit", "temperature_value"]);
  sheet.addRow(["[BMIM][PF6]", 12.1, 8.6, "10^-12 m2/s", 349.9]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());

  const preview = await request(bytes, "preview", cookie);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).outputRecords, 2);
  assert.equal(listRecords("diffusion").length, 0, "preview does not write records");

  const committed = await request(bytes, "commit", cookie);
  const committedBody = await committed.json();
  assert.equal(committed.status, 200);
  assert.equal(committedBody.recordCount, 2);
  assert.equal(committedBody.alreadyCommitted, false);
  assert.equal(listRecords("diffusion").length, 2);

  const retried = await request(bytes, "commit", cookie);
  const retriedBody = await retried.json();
  assert.equal(retriedBody.alreadyCommitted, true);
  assert.equal(listRecords("diffusion").length, 2);

  console.log("dataset route preview/commit tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
