import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { createTestAdminSession, createTestAppSession } from "@/lib/auth.test-helpers";
import { liveTeachingExample } from "@/lib/teaching/liveExamples.server";
import { terminateAfmAxisOcrWorker } from "@/lib/afm/imageAxisOcr.server";
import { POST as action } from "../route";
import { POST as uploadPaper } from "../paper/route";
import { POST as extract } from "../extract/route";
import { GET as curves } from "./route";
import { GET as exportRecords } from "../export/route";
import type { LiveAfmArtifact } from "@/lib/teaching/liveAfm";

async function main() {
  const input = process.env.TEACHING_AFM_ACCEPTANCE_PDF;
  if (!input) { console.log("Real-paper classroom acceptance is opt-in: set TEACHING_AFM_ACCEPTANCE_PDF (no paid model is called)."); return; }
  const admin = await createTestAdminSession(), student = await createTestAppSession();
  const req = (cookie: string, body: object) => new NextRequest("http://localhost:3000/api/teaching/live", { method: "POST", headers: { cookie, origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(body) });
  const created = await action(req(admin.cookie, { action: "create", name: "Isolated real-paper AFM acceptance", domain: "afm", channel: "alternating", groupCount: 2 }));
  assert.equal(created.status, 200); const { experiment } = await created.json();
  const pdf = await readFile(input);
  async function upload(experimentId: string) {
    const form = new FormData(); form.set("experimentId", experimentId); form.set("file", new File([new Uint8Array(pdf).buffer], "classroom-paper.pdf", { type: "application/pdf" }));
    return uploadPaper(new NextRequest("http://localhost:3000/api/teaching/live/paper", { method: "POST", headers: { cookie: admin.cookie, origin: "http://localhost:3000" }, body: form }));
  }
  const paper = await upload(experiment.id); assert.equal(paper.status, 200);
  const gold = liveTeachingExample("afm")!.rows;
  assert.equal((await action(req(admin.cookie, { action: "gold", experimentId: experiment.id, gold, taskInstructions: "Figure 1A-E: report the printed arrow-position separations, not digitized extrema." }))).status, 200);
  const joined = await action(req(student.cookie, { action: "join", experimentId: experiment.id }));
  const seat = (await joined.json()).participant;
  assert.equal((await action(req(admin.cookie, { action: "start", experimentId: experiment.id }))).status, 200);
  const recognized = await extract(req(student.cookie, { participantId: seat.id, version: 1 }));
  assert.equal(recognized.status, 200); const recognizedSeat = await recognized.json();
  assert(recognizedSeat.afmArtifactId); assert(recognizedSeat.rows.length > 0);
  const base = `http://localhost:3000/api/teaching/live/afm?experimentId=${experiment.id}&participantId=${seat.id}`;
  const get = (url: string, cookie = student.cookie) => new NextRequest(url, { headers: { cookie } });
  const artifact = await (await curves(get(base))).json() as LiveAfmArtifact;
  if (process.env.TEACHING_ACCEPTANCE_OUTPUT) {
    await mkdir(process.env.TEACHING_ACCEPTANCE_OUTPUT, { recursive: true });
    for (const curve of artifact.curves.filter((c) => /-(?:A|O)$/.test(c.id))) await writeFile(path.join(process.env.TEACHING_ACCEPTANCE_OUTPUT, `source-${curve.id}.png`), Buffer.from(curve.imageDataUrl.split(",")[1], "base64"));
  }
  assert.equal(artifact.curves.length, 20);
  assert.match(artifact.curves[0].id, /-A$/, "classroom panels follow source order, not confidence ranking");
  assert.match(artifact.curves[19].id, /-T$/);
  assert(artifact.curves.every((c) => c.axes && c.points.length > 20), JSON.stringify(artifact.curves.map((c) => ({ id: c.id, physical: Boolean(c.axes), points: c.points.length }))));
  const baselineResiduals = artifact.curves.map((curve) => {
    const tail = curve.points.filter(([x]) => x >= 2.1 && x <= 2.8).map((point) => point[1]).sort((a, b) => a - b);
    assert(tail.length > 5, `${curve.id}: long-distance tail must not be cropped`);
    return { panel: curve.id, medianForce: tail[Math.floor(tail.length / 2)] };
  });
  // Coarse raster regression guard (2.5% of the printed force range), not a
  // measurement uncertainty or a demand to subtract the experimental baseline.
  assert(baselineResiduals.every((item, i) => Math.abs(item.medianForce) < Math.abs(artifact.curves[i].axes!.yMax - artifact.curves[i].axes!.yMin) * 0.025), JSON.stringify(baselineResiduals));
  const csv = await curves(get(`${base}&curveId=${encodeURIComponent(artifact.curves[0].id)}&format=csv`));
  const png = await curves(get(`${base}&curveId=${encodeURIComponent(artifact.curves[0].id)}&format=png`));
  assert.equal(csv.status, 200); assert.equal(png.status, 200);
  // Simulate the required human source review, not automatic annotation recognition.
  const saved = await action(req(student.cookie, { action: "save", participantId: seat.id, version: recognizedSeat.version, rows: gold }));
  const savedSeat = await saved.json(); assert.equal(saved.status, 200);
  const submitted = await action(req(student.cookie, { action: "submit", participantId: seat.id, version: savedSeat.version, rows: gold }));
  const submittedSeat = await submitted.json(); assert.equal(submitted.status, 200); assert.equal(submittedSeat.score.accuracy, 1);
  const exported = await exportRecords(get(`http://localhost:3000/api/teaching/live/export?experimentId=${experiment.id}&format=records`, admin.cookie));
  assert.equal(exported.status, 200); assert.match(await exported.text(), /Annotated step separation/);
  assert.equal((await action(req(admin.cookie, { action: "finish", experimentId: experiment.id }))).status, 200);
  const second = await action(req(admin.cookie, { action: "nextRound", experimentId: experiment.id }));
  assert.equal(second.status, 200); const secondRound = await second.json();
  assert.equal((await upload(secondRound.experiment.id)).status, 400, "renaming the same PDF is not a valid crossover paper");
  const output = process.env.TEACHING_ACCEPTANCE_OUTPUT;
  const report = { source: path.basename(input), recognizedPanels: artifact.curves.length,
    physicalPanels: artifact.curves.filter((c) => c.axes).length, pointCounts: artifact.curves.map((c) => c.points.length),
    automaticallyProposedRows: recognizedSeat.rows.length, sourceCheckedLessonRows: gold.length,
    humanReviewSimulated: true, annotationRecognitionValidated: false, classroomLifecyclePassed: true,
    duplicateCrossoverPaperRejected: true, researchDatabaseModified: false };
  Object.assign(report, { baselineResiduals });
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "real-paper-classroom-report.json"), JSON.stringify(report, null, 2));
    await writeFile(path.join(output, "afm-classroom-export.png"), Buffer.from(await png.arrayBuffer()));
    await writeFile(path.join(output, "afm-classroom-points.csv"), await csv.text());
    await writeFile(path.join(output, "afm-classroom-source-panel.png"), Buffer.from(artifact.curves[0].imageDataUrl.split(",")[1], "base64"));
  }
  console.log(JSON.stringify(report));
}
main().finally(terminateAfmAxisOcrWorker);
