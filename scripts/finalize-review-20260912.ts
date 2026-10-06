import Database from "better-sqlite3";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseQuantity } from "../lib/units";
import { coreCompleteness } from "../lib/schema";
import { tribologyModule } from "../lib/modules/tribology";
import { recordStructureKey } from "../lib/structureSearch.server";

async function main() {
  const dir = path.resolve("data/audit-2026-09-12-final");
  const apply = process.argv.includes("--apply");
  const before = JSON.parse(readFileSync(path.join(dir, "before-records.json"), "utf8"));
  const fits = JSON.parse(readFileSync(path.join(dir, "digitized-fits.json"), "utf8"));
  const db = new Database("data/tribology.db", { readonly: !apply });
  const rows = db.prepare("SELECT id,payload FROM records ORDER BY id").all() as any[];
  assert.deepEqual(rows.map(row => JSON.parse(row.payload)), before, "Database changed since review snapshot");
  const review = before.filter((r: any) => r.status === "review");
  assert.equal(review.length, 38);
  const fixed = new Map<string, any>();
  const decisions: any[] = [];
  const addFlex = (r: any, key: string, value: string, note: string) => {
    r.flexible = r.flexible.filter((f: any) => f.key !== key);
    r.flexible.push({ key, value, note });
  };
  const repair = (id: string, why: string, update: (r: any) => void) => {
    const r = structuredClone(before.find((r: any) => r.id === id));
    assert.ok(r);
    update(r);
    r.flexible = r.flexible.filter((f: any) => f.key !== "audit_review_required");
    addFlex(r, "audit_resolution", why, "2026-09-12 二次复核；原文证据及计算过程已归档。");
    r.status = "official";
    assert.ok(coreCompleteness(r).complete, `${id}: missing required core`);
    fixed.set(id, r);
    decisions.push({ id, action: id === "#007" ? "correct_official" : "approved", reason: why });
  };
  repair("#008", "Poppler重新渲染恢复Fig.4A；n=1曲线可读范围约680–1200 µN，COF=0.12±0.02取正文。", r => {
    r.core.load = parseQuantity("~680–1200 µN", "force");
    r.provenance.load = { page: 3, figure: "Fig.4A", basis: "inferred", basisNote: "Approximate plotted n=1 point range from restored vector rendering; not exact author-supplied fit endpoints." };
    addFlex(r, "cof_uncertainty", "±0.02", "Page 3 directly reported.");
  });
  // Correct the first pass's text-only load interpretation now the graph is visible.
  repair("#007", "恢复Fig.4A后纠正上次仅依文字采用的10 µN：n=3点列约0–850 µN。图中剪切力约10 µN与COF=0.009相容；10 µN不是这条曲线的法向载荷上限。", r => {
    r.core.load = parseQuantity("~0–850 µN", "force");
    r.provenance.load = { page: 3, figure: "Fig.4A", basis: "inferred", basisNote: "Approximate full plotted n=3 load range. Text's ~10 µN normal-force statement conflicts with Fig.4A; plotted force axes and reported slope support this range. Exact fit endpoints not reported." };
    addFlex(r, "cof_uncertainty", "±0.002", "Page 3 directly reported.");
  });
  for (const [id, force] of [["#043", 9.5], ["#044", 7.0], ["#045", 6.5]] as const) {
    repair(id, "独立按Fig.4b原始摩擦轨迹和其自身速度图例重建固定载荷力比；不使用有歧义的Fig.2图例，也不将FS/FN当成拟合斜率。", r => {
      r.core.cof = Number((force / 68.7).toPrecision(2));
      r.extended.cofMethod = "apparent kinetic friction ratio FS/FN at fixed load (not dFS/dFN)";
      r.provenance.cof = { page: 14, figure: "Fig.4b", basis: "inferred", basisNote: `Approximate plateau magnitude FS≈${force} µN read from the trace identified by Fig.4b's own velocity legend; FN=68.7 µN in caption. FS/FN=${force/68.7}. Approximate ratio, not fitted friction slope.` };
      r.provenance.velocity = { page: 14, figure: "Fig.4b", basis: "direct", basisNote: "Own trace legend: black 470 nm/s, blue 105 nm/s, grey 52 nm/s. No mapping from Fig.2 used." };
      r.provenance.filmThickness = { page: 14, figure: "Fig.4b", basis: "direct", quote: "D =1.1 nm and FN = 68.7 μN" };
      r.flexible = r.flexible.filter((f: any) => f.key !== "layer_count");
      addFlex(r, "digitized_shear_force", `~${force} µN`, "Plateau amplitude estimated from Fig.4b; numerical raw data unavailable.");
      addFlex(r, "measurement_definition", "FS/FN; fixed load", "Separate from slope-based COF when comparing or training models.");
      r.confidence = 0.65;
    });
  }
  for (const [id, f] of Object.entries(fits) as [string, any][]) {
    if (!f.accepted) continue;
    repair(id, `从原图标记数字化${f.points_nN.length}个点，带截距OLS重算COF；R²=${f.r2.toFixed(4)}，去掉首尾点后斜率变化低于15%。`, r => {
      const xs = f.points_nN.map((p: number[]) => p[0]);
      r.core.cof = Number(f.slope.toPrecision(2));
      r.core.load = parseQuantity(`~${Math.min(...xs).toFixed(1)}–${Math.max(...xs).toFixed(1)} nN`, "force");
      r.extended.cofMethod = "OLS dFlateral/dFnormal with free intercept on digitized plotted marker centers";
      const page = id < "#070" ? 6 : 3;
      r.provenance.cof = { page, figure: f.figure, basis: "inferred", basisNote: `Raster digitization; free-intercept OLS slope=${f.slope}, R2=${f.r2}. Calibration, coordinates, residual diagnostics and endpoint sensitivity in data/audit-2026-09-12-final/digitized-fits.json. Original replicate data not recovered.` };
      r.provenance.load = { page, figure: f.figure, basis: "inferred", basisNote: "Range of the digitized points actually used for this slope fit, not the full acquisition ramp." };
      addFlex(r, "digitized_fit_diagnostics", `n=${f.points_nN.length}; R2=${f.r2.toFixed(4)}; slope=${f.slope.toFixed(4)}; trimmed=${f.trimmed_slope.toFixed(4)}`, "Digitization sensitivity is not an experimental confidence interval; treat as an approximate graphical estimate.");
      r.confidence = 0.65;
    });
  }
  const deletedSamples: any[] = [], rejected: any[] = [];
  const controls = new Set(["#009", "#014", "#015", "#016", "#070", "#086", "#094"]);
  for (const r of review) {
    if (fixed.has(r.id)) continue;
    let reason: string;
    if (["#003", "#004"].includes(r.id)) {
      reason = "已核实为seed.ts示例数据，按用户要求删除。";
      deletedSamples.push({ record: r, reason });
      decisions.push({ id: r.id, action: "deleted_sample", reason });
      continue;
    }
    if (controls.has(r.id)) reason = "空气或纯十六烷对照，不属于离子液体测量记录；已归档原数据，拒绝进入正式IL库。";
    else if (["#038", "#039", "#040"].includes(r.id)) reason = "重新检查方法段及Fig.5，仍只给mN/m归一化量，没有可确认的归一化分母/逐探针尺寸；缺少可靠N值，高载荷起点也非同一值。";
    else if (["#041", "#042"].includes(r.id)) reason = "Fig.2速度图例、Fig.4轨迹及正文对应关系相互冲突；无独立原始数据确定Fig.2斜率对应的速度，拒绝采用猜测映射。";
    else if (fits[r.id]) {
      const f = fits[r.id];
      reason = `已尝试数字化分段拟合：斜率${f.slope.toFixed(4)}，R²=${f.r2.toFixed(4)}，去首尾点斜率${f.trimmed_slope.toFixed(4)}；稳定性不足以恢复原记录的单一COF。`;
    } else reason = "重新核对方法段和对应图注，速度仍分别为6.5和6 µm/s；原文未解释差异，未获得独立依据判定准确条件，拒绝入库。";
    rejected.push({ record: r, reason, attemptedFit: fits[r.id] || null });
    decisions.push({ id: r.id, action: "rejected", reason });
  }
  assert.equal(decisions.filter(d => d.action !== "correct_official").length, 38);
  assert.equal(new Set(decisions.map(d => d.id)).size, decisions.length);
  const manifest: any = { applied: false, before: { official: 54, review: 38, total: 92 },
    approved: decisions.filter(d => d.action === "approved").length, deletedSamples: deletedSamples.length,
    rejected: rejected.length, correctedOfficial: ["#007"], decisions,
    policy: "No fabricated resolution of conflicting conditions. Graphical estimates retain inferred provenance. Rejection uses the existing application DELETE semantics, after archival." };
  manifest.after = { official: 54+manifest.approved, review: 0, total: 54+manifest.approved };
  writeFileSync(path.join(dir, "rejected-records.json"), JSON.stringify(rejected,null,2));
  writeFileSync(path.join(dir, "deleted-samples.json"), JSON.stringify(deletedSamples,null,2));
  writeFileSync(path.join(dir, "approved-records.json"), JSON.stringify([...fixed.values()],null,2));
  writeFileSync(path.join(dir, "decision-manifest.json"), JSON.stringify(manifest,null,2));
  if (apply) {
    const backup = path.resolve(`data/backups/tribology-final-review-${Date.now()}.db`);
    await db.backup(backup);
    const b = new Database(backup,{readonly:true});
    assert.equal(b.pragma("integrity_check",{simple:true}),"ok");
    assert.deepEqual((b.prepare("SELECT payload FROM records ORDER BY id").all() as any[]).map(x=>JSON.parse(x.payload)),before);
    b.close();
    // Save rollback metadata before the transaction, even if subsequent checks fail.
    manifest.backup = backup;
    manifest.backupSha256 = createHash("sha256").update(readFileSync(backup)).digest("hex");
    writeFileSync(path.join(dir,"decision-manifest.json"),JSON.stringify(manifest,null,2));
    db.transaction(() => {
      assert.deepEqual((db.prepare("SELECT id,payload FROM records ORDER BY id").all() as any[]), rows, "Concurrent database edit");
      for (const r of fixed.values()) {
        const values: any = { status: "official", payload: JSON.stringify(r), cation_structure_key: recordStructureKey(r,"cation"), anion_structure_key: recordStructureKey(r,"anion") };
        for (const c of tribologyModule.promotedColumns) values[c.name] = c.get(r);
        assert.equal(db.prepare(`UPDATE records SET ${Object.keys(values).map(k=>`${k}=@${k}`).join(",")} WHERE id=@id AND payload=@old`).run({...values,id:r.id,old:rows.find(x=>x.id===r.id).payload}).changes,1);
      }
      for (const {record:r} of [...deletedSamples,...rejected]) assert.equal(db.prepare("DELETE FROM records WHERE id=? AND status='review' AND payload=?").run(r.id,rows.find(x=>x.id===r.id).payload).changes,1);
      assert.equal((db.prepare("SELECT count(*) n FROM records WHERE status='review'").get() as any).n,0);
      assert.equal((db.prepare("SELECT count(*) n FROM records").get() as any).n,manifest.after.total);
    })();
    assert.equal(db.pragma("integrity_check",{simple:true}),"ok");
    const after = (db.prepare("SELECT payload FROM records ORDER BY id").all() as any[]).map(x=>JSON.parse(x.payload));
    for (const r of after) assert.deepEqual(r,JSON.parse(JSON.stringify(fixed.get(r.id) || before.find((b:any)=>b.id===r.id))));
    manifest.applied = true;
    manifest.verified = true;
    writeFileSync(path.join(dir,"after-records.json"),JSON.stringify(after,null,2));
    writeFileSync(path.join(dir,"decision-manifest.json"),JSON.stringify(manifest,null,2));
  }
  console.log(JSON.stringify({...manifest,decisions:undefined},null,2));
  db.close();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
