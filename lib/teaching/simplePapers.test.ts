import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { readSimplePaper, readSimplePdf, saveStudentUploadedPdf, simplePaperFingerprint } from "./simplePapers";
import { teachingDataDir } from "./store";

function pdf(text: string): Uint8Array {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let document = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(document.length); document += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const start = document.length;
  document += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return new TextEncoder().encode(document);
}
async function run() {
  await assert.rejects(saveStudentUploadedPdf("paper.txt", pdf("Paper")), /Choose a PDF/);
  await assert.rejects(saveStudentUploadedPdf("paper.pdf", new Uint8Array(20 * 1024 * 1024 + 1)), /20 MB/);
  await assert.rejects(saveStudentUploadedPdf("paper.pdf", new TextEncoder().encode("not a PDF")), /Invalid PDF/);
  await assert.rejects(saveStudentUploadedPdf("paper.pdf", new TextEncoder().encode("%PDF-broken")), /could not be read/);
  await assert.rejects(saveStudentUploadedPdf("empty.pdf", pdf("")), /no extractable text/);
  const bytes = pdf("Student owned paper EMIM BF4 steel");
  const source = await saveStudentUploadedPdf("../student-paper.pdf", bytes);
  const other = await saveStudentUploadedPdf("student-paper.pdf", bytes);
  assert.notEqual(source.id, other.id);
  assert.equal(source.fingerprint, other.fingerprint);
  const renamed = await saveStudentUploadedPdf("renamed.pdf", bytes);
  assert.equal(source.fingerprint, renamed.fingerprint);
  const different = await saveStudentUploadedPdf("student-paper.pdf", pdf("Different paper"));
  assert.notEqual(source.fingerprint, different.fingerprint);
  assert.equal(simplePaperFingerprint([{ page: 1, text: "Ａ  B\nC" }]), simplePaperFingerprint([{ page: 1, text: "A B C" }]));
  assert.equal(source.filename, "student-paper.pdf");
  assert.equal(source.pageCount, 1);
  assert.match(source.pages[0].text, /Student owned paper/);
  assert.deepEqual(await readSimplePaper(source.id), source);
  assert.deepEqual(await readSimplePdf(source.id), bytes);
  assert.equal(existsSync(path.join(teachingDataDir(), "tribology", "sources")), false);
  assert.equal(existsSync(path.join(teachingDataDir(), "tribology.db")), false);
  console.log("simple student PDF upload tests passed");
}
run().catch(error => { console.error(error); process.exitCode = 1; });
