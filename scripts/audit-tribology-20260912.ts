/** Source-reviewed, optimistic-concurrency-checked repair. Dry run by default. */
import Database from "better-sqlite3";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { parseQuantity } from "../lib/units";
import { coreCompleteness } from "../lib/schema";
import { tribologyModule } from "../lib/modules/tribology";
import { recordStructureKey } from "../lib/structureSearch.server";

async function main() {
  const dir = path.resolve("data/audit-2026-09-12");
  const apply = process.argv.includes("--apply");
  const db = new Database(path.resolve("data/tribology.db"), { readonly: !apply });
  const rows = db.prepare("SELECT * FROM records ORDER BY id").all() as any[];
  const baseline = JSON.parse(readFileSync(path.join(dir, "before-records.json"), "utf8"));
  assert.equal(rows.length, baseline.length, "Record set changed; re-audit before applying");
  for (const row of rows) assert.deepEqual(JSON.parse(row.payload), baseline.find((r: any) => r.id === row.id), `Concurrent edit: ${row.id}`);
  const records = rows.map(row => JSON.parse(row.payload));
  const byId = new Map<string, any>(records.map(r => [r.id, r]));
  const notes = new Map<string, string[]>();
  const holds = new Map<string, string[]>();
  const note = (r: any, text: string) => notes.set(r.id, [...(notes.get(r.id) || []), text]);
  const hold = (r: any, text: string) => { holds.set(r.id, [...(holds.get(r.id) || []), text]); r.status = "review"; };
  const flex = (r: any, key: string, value: string, why: string) => {
    r.flexible = r.flexible.filter((f: any) => f.key !== key);
    r.flexible.push({ key, value, note: why });
  };
  const span = (a: number, b: number) => records.filter(r => +r.id.slice(1) >= a && +r.id.slice(1) <= b);
  const prov = (r: any, field: string, p: any) => { r.provenance ||= {}; r.provenance[field] = p; };

  // Two seed rows can be reconstructed from the actual uploaded paper, Table 2.
  for (const [id, potential, cof] of [["#001", "+0.5 V", 0.12], ["#002", "-0.5 V", 0.20]] as const) {
    const r = byId.get(id), template = structuredClone(byId.get("#087"));
    const identity = r.core.ionicLiquid;
    Object.assign(r, template, { id, createdAt: r.createdAt, status: "official" });
    r.core.ionicLiquid = identity;
    r.core.cof = cof;
    r.extended.potential = parseQuantity(potential, "potential");
    prov(r, "cof", { page: 4, table: "Table 2", basis: "direct", basisNote: "Visually verified BMIM I row and potential column in source PDF." });
    prov(r, "potential", { page: 4, table: "Table 2", basis: "direct" });
    note(r, "按原文 Table 2 重建种子记录：修正 DOI、来源、实验方法及证据；#002 COF 0.18→0.20。");
  }
  for (const r of span(3, 4)) hold(r, "记录来自 scripts/seed.ts 示例，缺少对应原始文献，暂停正式库使用。");

  for (const [id, thickness, layers] of [["#007", 1.08, 3], ["#008", 0.23, 1]] as const) {
    const r = byId.get(id);
    r.extended.filmThickness = parseQuantity(`${thickness} ± 0.15 nm`, "length");
    r.extended.filmLayers = layers;
    prov(r, "filmThickness", { page: 3, basis: "direct", basisNote: "Source prose identifies n=3 at 1.08 ± 0.15 nm and n=1 at 0.23 ± 0.15 nm." });
    note(r, "分离膜厚与层数，恢复膜厚单位及 ±0.15 nm 不确定度。");
  }
  const seven = byId.get("#007");
  seven.core.load = parseQuantity("up to ~10 µN", "force");
  prov(seven, "load", { page: 3, basis: "direct", basisNote: "PDF visually reads up to ~10 µN for n=3, not 10 mN." });
  note(seven, "修正原文 µN 被误读为 mN，载荷上限 0.01 N→0.00001 N。");
  const eight = byId.get("#008");
  flex(eight, "previous_load_unverified", eight.core.load.raw, "原载荷属于误读，n=1 拟合区间仍待原图确认。");
  eight.core.load = null;
  hold(eight, "n=1 膜的拟合载荷区间未核实；已清除误用的 10 mN，保留 COF 与膜厚。");

  for (const r of span(9, 16)) {
    if (r.extended.surface && r.core.substrate === "PTFE") {
      r.extended.surface.conductor = false;
      note(r, "修正 PTFE 材料描述中的导电性标记。");
    }
    if (r.flexible.some((f: any) => f.key === "medium" && f.value === "air")) {
      r.core.ionicLiquid = { cation: "none (air control)", anion: "none (air control)" };
      delete r.extended.waterContent;
      note(r, "按 Fig.3b 空气对照恢复介质身份，去除误附 EAN 离子身份。");
      hold(r, "空气对照，保留供比较；不作为离子液体实验自动入库。");
    }
  }
  // In this manuscript the denominator is not yet independently verified.
  for (const r of span(38, 40)) {
    r.core.load = parseQuantity(r.core.load.raw, "force");
    note(r, "移除将 mN/m 当作 N 的错误标准值，保留原始归一化载荷。");
    hold(r, "需确认归一化分母及对应探针实测半径后换算力；#039/040 的高载荷起点也需单独核实。");
    if (r.extended.roughness?.std == null && r.extended.roughness) {
      flex(r, "roughness_description", r.extended.roughness.raw, "原文定性描述，未给数值粗糙度。");
      delete r.extended.roughness;
      delete r.extended.surface.roughness;
    }
  }
  for (const r of span(41, 45)) hold(r, "Fig.2 图例的速度映射与 Fig.4 曲线/正文存在冲突；区分斜率 COF 和固定载荷力比后再入库。");

  for (const r of span(46, 54)) {
    flex(r, "reported_normalized_load", r.core.load.raw, "全文扫描区间 0–35 mN/m；COF 拟合区间为 15–35 mN/m。");
    r.core.load = parseQuantity("~37.5–87.5 nN", "force");
    prov(r, "load", { page: 3, section: "AFM Friction Measurements", basis: "inferred", basisNote: "F=(F/R)R; fitted 15–35 mN/m, nominal diameter 5 µm (page 2), R=2.5 µm gives 37.5–87.5 nN. Approximate because the nominal rather than individual measured diameter is available." });
    if (r.extended.additives) {
      flex(r, "polymer_preparation_concentration", "0.01 wt%", "吸附溶液浓度；测量前用纯 IL 冲洗去除未吸附 PEO（第2页）。");
      r.extended.concentration = "adsorbed PEO; bulk solution exchanged with pure IL";
    }
    note(r, "按 F/R 与 5 µm 标称直径换算正确拟合载荷；保留推导及半径精度限制。核对 Table 2 全部对应条件。");
  }
  for (const r of span(55, 66)) {
    const boundary = +r.id.slice(1) % 2 === 0;
    flex(r, "reported_normalized_load", r.core.load.raw, "原文 F/(2πR)，第3页，标称直径14.5 µm。");
    const max = 1e-3 * 2 * Math.PI * 7.25e-6 * 1e9;
    r.core.load = parseQuantity(boundary ? `~${(0.2 * max).toPrecision(4)}–${max.toPrecision(4)} nN` : `~0–${(0.2 * max).toPrecision(4)} nN`, "force");
    prov(r, "load", { page: 3, basis: "inferred", basisNote: "F=[F/(2πR)]×2πR; R=14.5/2 µm from nominal probe diameter. Boundary 0.2–1 mN/m; multilayer 0–0.2 mN/m. Nominal-radius conversion, not a directly measured force." });
    if (r.extended.filmThickness?.std == null && r.extended.filmThickness) {
      flex(r, "film_description", r.extended.filmThickness.raw, "论文给出层结构描述，未测定该点数值膜厚。");
      delete r.extended.filmThickness;
      if (boundary) r.extended.filmLayers = 1;
    }
    prov(r, "cof", { page: 4, table: "Table 1", basis: "direct", basisNote: r.id === "#066" ? "Table reports rounded 0.6; page 5 prose gives 0.57. Retain Table 1 precision consistently." : "Verified material and regime against Table 1." });
    note(r, "按 F/(2πR) 换算载荷，清理非数值膜厚，核对 Table 1 的材料/摩擦区间。");
  }
  for (const r of span(67, 69)) hold(r, "现有 COF 使用约 F/N 而非高载荷段 ΔF/ΔN；需重新数字化 Fig.4a 多点拟合，原值仅供复核。");
  const oil = byId.get("#070");
  oil.core.ionicLiquid = { cation: "none (hexadecane control)", anion: "none (hexadecane control)" };
  delete oil.extended.additives;
  delete oil.extended.waterContent;
  flex(oil, "medium", "pure hexadecane", "Table 1 的无 IL 对照。");
  note(oil, "纯十六烷对照去除错误的 IL 离子身份和添加剂。");
  hold(oil, "纯十六烷对照，保留供比较；不作为离子液体实验自动入库。");
  for (const r of span(71, 74)) {
    r.core.load = parseQuantity(">5 nN", "force");
    flex(r, "acquisition_load_range", "0–100 nN", "完整扫描区间，与线性区间区分。");
    prov(r, "load", { page: 2, basis: "inferred", basisNote: "Linear regime above 5 nN described for Fig.2; Table 1 fits use the linear regime. Full acquisition ramp is 0–100 nN." });
    flex(r, "cof_uncertainty", "±0.05", "Table 1 caption, page 3.");
    prov(r, "cof", { page: 3, table: "Table 1", basis: "direct", basisNote: "Visually checked concentration column and COF." });
    note(r, "补齐 Table 1 的误差范围，区分扫描载荷与拟合区间。");
  }
  for (const r of span(75, 80)) hold(r, "图示存在非线性或分段区间；现有单一 COF 与拟合载荷区间缺少可复算的数字化依据。");
  for (const r of span(71, 80)) {
    if (!r.extended.roughness) {
      r.extended.roughness = parseQuantity("1.0 ± 0.5 nm", "length");
      r.extended.surface.roughness = structuredClone(r.extended.roughness);
      prov(r, "roughness", { page: 3, basis: "direct", basisNote: "Same Au(111) substrate throughout the experiments; page 3 reports gold RMS=1.0 ±0.5 nm." });
      note(r, "补齐原文同一金基底已报告的 RMS 粗糙度1.0±0.5 nm。");
    }
  }
  for (const r of span(81, 86)) {
    r.core.load = parseQuantity(">10 nN", "force");
    prov(r, "load", { page: 3, figure: "Fig. 2", basis: "direct", basisNote: "Caption explicitly defines COF as gradient for normal force higher than 10 nN." });
    prov(r, "cof", { page: 3, figure: "Fig. 2", basis: "direct", basisNote: "Read printed µ label; −1.0/−1.5 V labels are 0.020. Prose 0.20 conflicts with labels." });
    flex(r, "velocity_source_discrepancy", "methods 6.5 µm/s; Fig.2 caption 6 µm/s", "保留现有方法段速度，记录图注差异，未将二者伪装为一致。");
    note(r, "核对 Fig.2 数值标签并修正拟合载荷；保留速度图文差异。");
    hold(r, "方法段6.5 µm/s与图注6 µm/s冲突，需确定最终采用的速度；#086为空气对照。");
  }
  for (const r of span(88, 94)) {
    flex(r, "cof_uncertainty", "±0.10", "Table 2 caption on PDF page 10.");
    flex(r, "velocity_source_discrepancy", "methods 6.5 µm/s; Fig.1 caption 6 µm/s", "本记录按 Fig.1 采用6 µm/s，方法段另报6.5 µm/s。");
    prov(r, "cof", { page: 10, table: "Table 2", basis: "direct", basisNote: "Verified all seven rows and ±0.10 uncertainty against rendered PDF." });
    note(r, "恢复 Table 2 统一 ±0.10 误差，核对各离子组合的 COF。");
    hold(r, "方法段和图注速度有6.5/6 µm/s差异；#094为空气对照且缺少独立速度依据。");
  }

  // Shared evidence can be copied only for the same source and exact stored value.
  const valueOf = (r: any, f: string) => f === "cation" || f === "anion" ? r.core.ionicLiquid[f] : r.core[f] ?? r.extended[f];
  for (const r of records) for (const field of ["cation", "anion", "substrate", "temperature", "load", "probe", "velocity", "roughness", "waterContent"]) {
    const value = valueOf(r, field);
    if (!r.sourceId || value == null || r.provenance?.[field]) continue;
    const donor = records.find(d => d.id !== r.id && d.sourceId === r.sourceId && JSON.stringify(valueOf(d, field)) === JSON.stringify(value) && d.provenance?.[field]?.page);
    if (donor) { prov(r, field, structuredClone(donor.provenance[field])); note(r, `补齐同文献同值字段 ${field} 的已有出处。`); }
  }
  const approve = new Set([...span(35, 37), ...span(46, 66), ...span(71, 74), byId.get("#087")].map(r => r.id));
  for (const r of records) {
    if (approve.has(r.id) && !holds.has(r.id)) {
      assert.ok(coreCompleteness(r).complete, `${r.id} incomplete`);
      assert.notEqual(r.extraction?.source, "mock");
      r.status = "official";
      note(r, "已核对原文数据与条件，按现有平台温度约定确认入库；assumed 温度不视为实测。");
    }
    if (holds.has(r.id)) flex(r, "audit_review_required", holds.get(r.id)!.join(" "), "2026-09-12 全量复核；修复后再确认入库。");
  }
  const changes = records.map(r => {
    const before = baseline.find((b: any) => b.id === r.id);
    return { id: r.id, beforeStatus: before.status, afterStatus: r.status, changed: JSON.stringify(before) !== JSON.stringify(r), notes: notes.get(r.id) || [], hold: holds.get(r.id) || [] };
  });
  const report = { applied: apply, originalCount: rows.length, changed: changes.filter(c => c.changed).length,
    approved: changes.filter(c => c.beforeStatus === "review" && c.afterStatus === "official").map(c => c.id),
    returnedToReview: changes.filter(c => c.beforeStatus === "official" && c.afterStatus === "review").map(c => c.id),
    official: records.filter(r => r.status === "official").length, review: records.filter(r => r.status === "review").length,
    assumedTemperatures: records.filter(r => r.provenance?.temperature?.basis === "assumed").map(r => r.id), changes };
  writeFileSync(path.join(dir, "repair-plan.json"), JSON.stringify(report, null, 2));
  writeFileSync(path.join(dir, "planned-records.json"), JSON.stringify(records, null, 2));
  if (apply) {
    mkdirSync("data/backups", { recursive: true });
    const backup = path.resolve(`data/backups/tribology-audit-${Date.now()}.db`);
    await db.backup(backup);
    const backupDb = new Database(backup, { readonly: true });
    assert.equal(backupDb.pragma("integrity_check", { simple: true }), "ok");
    backupDb.close();
    db.transaction(() => {
      for (const r of records) {
        const original = rows.find(row => row.id === r.id);
        const columns: any = { status: r.status, paper_title: r.paper.title, cation: r.core.ionicLiquid.cation, anion: r.core.ionicLiquid.anion,
          cation_structure_key: recordStructureKey(r, "cation"), anion_structure_key: recordStructureKey(r, "anion"), payload: JSON.stringify(r) };
        for (const c of tribologyModule.promotedColumns) columns[c.name] = c.get(r);
        const result = db.prepare(`UPDATE records SET ${Object.keys(columns).map(k => `${k}=@${k}`).join(",")} WHERE id=@id AND payload=@oldPayload`).run({ ...columns, id: r.id, oldPayload: original.payload });
        assert.equal(result.changes, 1, `Concurrent modification ${r.id}`);
      }
      assert.equal((db.prepare("SELECT count(*) AS n FROM records").get() as any).n, rows.length);
    })();
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
    for (const r of records) assert.deepEqual(JSON.parse((db.prepare("SELECT payload FROM records WHERE id=?").get(r.id) as any).payload), JSON.parse(JSON.stringify(r)));
    writeFileSync(path.join(dir, "applied-result.json"), JSON.stringify({ ...report, backup, verified: true }, null, 2));
  }
  console.log(JSON.stringify({ ...report, changes: undefined, assumedTemperatures: report.assumedTemperatures.length }, null, 2));
  db.close();
}
main().catch(error => { console.error(error); process.exitCode = 1; });
