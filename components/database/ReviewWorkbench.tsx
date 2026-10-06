"use client";

/* eslint-disable @next/next/no-img-element */

import React, { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Domain } from "@/lib/domain";
import type { EvidenceMatch } from "@/lib/evidence";
import type { BBox, FieldProvenance } from "@/lib/schema";
import { formatCof, formatProvenance, provenanceBadge } from "@/lib/schema";
import type { ClientModule } from "@/components/registry.client";
import { openRecordEvidence, quantityLabel, type UnitMode } from "@/components/recordCardParts";

type AnyRecord = any;

export type ReviewIssueFilter = "all" | "ready" | "needs" | "low-confidence" | "missing-evidence" | "mock";

export interface ReviewMatrixCell {
  key: string;
  label: string;
  value: string;
  editableValue?: string;
  provenance?: FieldProvenance;
  primary?: boolean;
}

export interface SharedReviewCell extends ReviewMatrixCell {
  recordId: string;
  sourceId?: string;
  coverage: number;
  total: number;
  evidenceCount: number;
}

export function buildReviewMatrixCells(record: AnyRecord, domain: Domain, units: UnitMode): ReviewMatrixCell[] {
  const core = record.core ?? {};
  const extended = record.extended ?? {};
  const ionicLiquid = core.ionicLiquid ?? {};
  const provenance = record.provenance ?? {};
  const quantity = (value: any) => value ? quantityLabel(value, units) : "—";
  const common: ReviewMatrixCell[] = [
    { key: "cation", label: "Cation", value: ionicLiquid.cation || "—", editableValue: ionicLiquid.cation || "", provenance: provenance.cation },
    { key: "anion", label: "Anion", value: ionicLiquid.anion || "—", editableValue: ionicLiquid.anion || "", provenance: provenance.anion },
  ];
  if (domain === "conductivity") return [
    ...common,
    { key: "surface", label: "Surface", value: core.surface || "—", editableValue: core.surface || "", provenance: provenance.surface },
    { key: "temperature", label: "Temp", value: quantity(core.temperature), editableValue: core.temperature?.raw || "", provenance: provenance.temperature },
    { key: "method", label: "Method", value: extended.method || "—", editableValue: extended.method || "", provenance: provenance.method },
    { key: "conductivity", label: "Conductivity", value: quantity(core.conductivity), editableValue: core.conductivity?.raw || "", provenance: provenance.conductivity, primary: true },
    ...([
      ["capacitance", "Capacitance", core.capacitance, true],
      ["electricField", "Electric field", core.electricField, true],
      ["viscosity", "Viscosity", extended.viscosity, true],
      ["electrochemicalWindow", "Electrochemical window", core.electrochemicalWindow, true],
      ["chargeTransferResistance", "Charge-transfer resistance", core.chargeTransferResistance, true],
      ["electrodePotential", "Electrode potential", core.electrodePotential, false],
      ["pressure", "Pressure", extended.pressure, false],
    ] as const).filter(([, , value]) => value).map(([key, label, value, primary]) => ({
      key, label, value: quantity(value), editableValue: value.raw || "", provenance: provenance[key], primary,
    })),
    ...(["potentialReference", "cellConfiguration", "workingElectrode", "counterElectrode", "referenceElectrode", "positiveElectrode", "negativeElectrode"] as const)
      .filter((key) => extended[key]).map((key) => ({
        key, label: key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
        value: extended[key], editableValue: extended[key], provenance: provenance[key],
      })),
  ].filter((cell) => cell.key !== "conductivity" || core.conductivity || ![core.capacitance, core.electricField, extended.viscosity, core.electrochemicalWindow, core.chargeTransferResistance].some(Boolean));
  if (domain === "diffusion") return [
    ...common,
    { key: "species", label: "Species", value: core.species || "—", editableValue: core.species || "", provenance: provenance.species },
    { key: "systemName", label: "System", value: extended.systemName || "—", editableValue: extended.systemName || "", provenance: provenance.systemName },
    { key: "poreSize", label: "Pore size", value: quantity(extended.poreSize), editableValue: extended.poreSize?.raw || "", provenance: provenance.poreSize },
    { key: "temperature", label: "Temp", value: quantity(core.temperature), editableValue: core.temperature?.raw || "", provenance: provenance.temperature },
    { key: "method", label: "Method", value: extended.method || "—", editableValue: extended.method || "", provenance: provenance.method },
    { key: "diffusion", label: "Diffusion D", value: quantity(core.diffusion), editableValue: core.diffusion?.raw || "", provenance: provenance.diffusion, primary: true },
  ];
  return [
    ...common,
    { key: "substrate", label: "Substrate", value: core.substrate || "—", editableValue: core.substrate || "", provenance: provenance.substrate },
    { key: "load", label: "Load", value: quantity(core.load), editableValue: core.load?.raw || "", provenance: provenance.load },
    { key: "temperature", label: "Temp", value: quantity(core.temperature), editableValue: core.temperature?.raw || "", provenance: provenance.temperature },
    { key: "velocity", label: "Velocity", value: quantity(extended.velocity), editableValue: extended.velocity?.raw || "", provenance: provenance.velocity },
    { key: "potential", label: "Potential", value: quantity(extended.potential), editableValue: extended.potential?.raw || "", provenance: provenance.potential },
    { key: "cof", label: "COF", value: formatCof(core.cof), editableValue: core.cof == null ? "" : String(core.cof), provenance: provenance.cof, primary: true },
  ];
}

export function reviewRecordHasMissingEvidence(record: AnyRecord, domain: Domain): boolean {
  if (domain === "conductivity") {
    const targets = buildReviewMatrixCells(record, domain, "raw").filter((cell) => cell.primary && reviewCellHasValue(cell));
    if (targets.length) return targets.some((cell) => !cell.provenance);
  }
  const field = domain === "conductivity" ? "conductivity" : domain === "diffusion" ? "diffusion" : "cof";
  return !record.provenance?.[field];
}

export function reviewRecordHasLowConfidence(record: AnyRecord): boolean {
  return typeof record.confidence === "number" && record.confidence < 0.8;
}

export function reviewIssueBucket(record: AnyRecord, domain: Domain, coreCompleteness: ClientModule["coreCompleteness"]): Exclude<ReviewIssueFilter, "all" | "low-confidence"> {
  if (record.extraction?.source === "mock") return "mock";
  if (!coreCompleteness(record).complete) return "needs";
  if (reviewRecordHasMissingEvidence(record, domain)) return "missing-evidence";
  return "ready";
}

export function reviewRecordMatchesFilter(record: AnyRecord, filter: ReviewIssueFilter, domain: Domain, coreCompleteness: ClientModule["coreCompleteness"]): boolean {
  if (filter === "all") return true;
  if (filter === "low-confidence") return reviewRecordHasLowConfidence(record);
  return reviewIssueBucket(record, domain, coreCompleteness) === filter;
}

function reviewCellHasValue(cell?: ReviewMatrixCell): boolean {
  return Boolean(cell && (cell.editableValue?.trim() || (cell.value && cell.value !== "—")));
}

export function reviewCellNeedsVerification(cell: ReviewMatrixCell): boolean {
  if ((cell.key === "cation" || cell.key === "anion") && !cell.provenance) return false;
  if (cell.key !== "temperature") return true;
  if (cell.provenance?.basis === "assumed") return false;
  if (cell.provenance) return true;
  const reportedValue = `${cell.editableValue ?? ""} ${cell.value}`.trim();
  return !/\b(not\s+(?:stated|reported|specified)|room\s*temp(?:erature)?|ambient(?:\s+conditions)?|rt)\b|室温/i.test(reportedValue);
}

export function buildSharedReviewCells(records: AnyRecord[], domain: Domain, units: UnitMode): SharedReviewCell[] {
  if (records.length === 0) return [];
  return buildReviewMatrixCells(records[0], domain, units).flatMap((definition) => {
    if (definition.primary || !reviewCellHasValue(definition)) return [];
    const entries = records.map((record) => ({ record, cell: buildReviewMatrixCells(record, domain, units).find((candidate) => candidate.key === definition.key) }));
    if (!entries.every(({ cell }) => reviewCellHasValue(cell) && cell?.value === definition.value)) return [];
    const owner = entries.find(({ cell }) => Boolean(cell?.provenance)) ?? entries[0];
    return [{ ...definition, provenance: owner.cell?.provenance, recordId: owner.record.id, sourceId: owner.record.sourceId, coverage: entries.length, total: records.length, evidenceCount: entries.filter(({ cell }) => Boolean(cell?.provenance)).length }];
  });
}

interface ReviewWorkbenchProps {
  domain: Domain;
  records: AnyRecord[];
  units: UnitMode;
  clientModule: ClientModule;
  queryReady: boolean;
  mutationBusy: boolean;
  selected: ReadonlySet<string>;
  editingId: string | null;
  editor?: ReactNode;
  onToggle: (id: string) => void;
  onEdit: (id: string) => void;
  onQuickEdit: (id: string, field: string, value: string) => Promise<boolean>;
  onApprove: (id: string) => void | Promise<void>;
  onReject: (id: string) => void | Promise<void>;
}

const FILTER_OPTIONS: { key: ReviewIssueFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "ready", label: "Ready" }, { key: "needs", label: "Needs fields" },
  { key: "low-confidence", label: "Low confidence" }, { key: "missing-evidence", label: "Evidence gaps" }, { key: "mock", label: "Mock locked" },
];

export function ReviewWorkbench(props: ReviewWorkbenchProps) {
  const { domain, records, units, clientModule, queryReady, mutationBusy, selected, editingId, editor, onToggle, onEdit, onQuickEdit, onApprove, onReject } = props;
  const [issueFilter, setIssueFilter] = useState<ReviewIssueFilter>("all");
  const [activePaper, setActivePaper] = useState("");
  const [activeRecordId, setActiveRecordId] = useState("");
  const [activeCellKey, setActiveCellKey] = useState("");
  const issueCounts = useMemo(() => {
    const counts: Record<ReviewIssueFilter, number> = { all: records.length, ready: 0, needs: 0, "low-confidence": 0, "missing-evidence": 0, mock: 0 };
    for (const record of records) { counts[reviewIssueBucket(record, domain, clientModule.coreCompleteness)] += 1; if (reviewRecordHasLowConfidence(record)) counts["low-confidence"] += 1; }
    return counts;
  }, [clientModule.coreCompleteness, domain, records]);
  const filteredRecords = useMemo(() => records.filter((record) => reviewRecordMatchesFilter(record, issueFilter, domain, clientModule.coreCompleteness)), [clientModule.coreCompleteness, domain, issueFilter, records]);
  const paperGroups = useMemo(() => {
    const groups = new Map<string, AnyRecord[]>();
    for (const record of filteredRecords) { const title = record.paper?.title || "Untitled source"; const group = groups.get(title); if (group) group.push(record); else groups.set(title, [record]); }
    return [...groups.entries()].map(([title, groupRecords]) => ({ title, records: groupRecords }));
  }, [filteredRecords]);
  const resolvedPaper = paperGroups.some((group) => group.title === activePaper) ? activePaper : paperGroups[0]?.title ?? "";
  const activeRecords = useMemo(() => paperGroups.find((group) => group.title === resolvedPaper)?.records ?? [], [paperGroups, resolvedPaper]);
  const activeRecord = activeRecords.find((record) => record.id === activeRecordId) ?? activeRecords[0] ?? null;
  const activeCells = useMemo(() => activeRecord ? buildReviewMatrixCells(activeRecord, domain, units) : [], [activeRecord, domain, units]);
  const reviewCells = useMemo(() => activeCells.filter(reviewCellNeedsVerification), [activeCells]);
  const activeCell = reviewCells.find((cell) => cell.key === activeCellKey) ?? reviewCells.find((cell) => cell.primary) ?? reviewCells[0] ?? null;
  const sharedCells = useMemo(() => buildSharedReviewCells(activeRecords, domain, units), [activeRecords, domain, units]);
  const inspectorSharedCells = useMemo(() => sharedCells.filter(reviewCellNeedsVerification), [sharedCells]);
  const matrixColumns = useMemo(() => [...new Map((domain === "conductivity" ? activeRecords : activeRecords.slice(0, 1)).flatMap((record) => buildReviewMatrixCells(record, domain, units)).map((cell) => [cell.key, cell])).values()].filter((cell) => reviewCellNeedsVerification(cell) && (cell.primary || !sharedCells.some((shared) => shared.key === cell.key))), [activeRecords, domain, sharedCells, units]);
  useEffect(() => {
    if (!activeRecord) return;
    if (activeRecord.id !== activeRecordId) setActiveRecordId(activeRecord.id);
    if (!reviewCells.some((cell) => cell.key === activeCellKey)) setActiveCellKey(reviewCells.find((cell) => cell.primary)?.key ?? reviewCells[0]?.key ?? "");
  }, [activeCellKey, activeRecord, activeRecordId, reviewCells]);
  const moveRecord = useCallback((delta: number) => {
    if (!activeRecord || activeRecords.length === 0) return;
    const index = activeRecords.findIndex((record) => record.id === activeRecord.id);
    setActiveRecordId(activeRecords[Math.min(activeRecords.length - 1, Math.max(0, index + delta))].id);
  }, [activeRecord, activeRecords]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable='true']")) return;
      if (event.key.toLowerCase() === "j") moveRecord(1); else if (event.key.toLowerCase() === "k") moveRecord(-1);
      else if (event.key.toLowerCase() === "e" && activeRecord) onEdit(activeRecord.id);
      else if (event.key.toLowerCase() === "a" && activeRecord && clientModule.coreCompleteness(activeRecord).complete && activeRecord.extraction?.source !== "mock") void onApprove(activeRecord.id);
      else if (event.key === "Enter" && activeRecord && activeCell?.provenance) openRecordEvidence({ sourceId: activeRecord.sourceId, recordId: activeRecord.id, field: activeCell.key, value: activeCell.value, prov: activeCell.provenance, domain });
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [activeCell, activeRecord, clientModule, domain, moveRecord, onApprove, onEdit]);
  if (paperGroups.length === 0) return null;

  return <section data-testid="review-workbench" className="min-w-0 bg-white">
    <div className="border-b border-ink-200 px-5"><div className="flex items-center gap-7 overflow-x-auto" aria-label="Review issue filters">
      {FILTER_OPTIONS.filter((option) => option.key !== "ready" && (option.key === "all" || issueCounts[option.key] > 0 || option.key === issueFilter)).map((option) => <button key={option.key} type="button" aria-pressed={issueFilter === option.key} onClick={() => { setIssueFilter(option.key); setActivePaper(""); setActiveRecordId(""); }} className={`relative inline-flex min-h-12 shrink-0 items-center gap-2 py-3.5 text-sm font-semibold transition ${issueFilter === option.key ? "text-ink-950 after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:bg-brand-600" : "text-ink-600 hover:text-ink-950"}`}>{option.label}<span className={`font-mono text-xs ${issueFilter === option.key ? "text-brand-700" : "text-ink-400"}`}>{issueCounts[option.key]}</span></button>)}

    </div></div>
    <div className="grid min-w-0 lg:grid-cols-[17rem_20rem_minmax(0,1fr)] xl:grid-cols-[19rem_22rem_minmax(0,1fr)] 2xl:grid-cols-[20rem_24rem_minmax(0,1fr)]">
      <aside className="min-w-0 border-b border-ink-200 bg-white lg:border-b-0 lg:border-r" aria-label="Paper review queue"><div className="border-b border-ink-200 px-4 py-4"><div className="text-base font-semibold text-ink-950">Papers</div></div><div className="flex gap-1 overflow-x-auto p-2 lg:block lg:max-h-[47rem] lg:overflow-y-auto">{paperGroups.map((group) => { const active = group.title === resolvedPaper; const issueTotal = group.records.filter((record) => reviewIssueBucket(record, domain, clientModule.coreCompleteness) !== "ready").length; return <button key={group.title} type="button" onClick={() => { setActivePaper(group.title); setActiveRecordId(group.records[0]?.id ?? ""); }} className={`min-w-[17rem] border-l-[3px] border-b border-b-ink-100 px-4 py-4 text-left transition lg:w-full lg:min-w-0 ${active ? "border-l-brand-600 bg-brand-50" : "border-l-transparent hover:bg-ink-50"}`}><span className="line-clamp-2 font-serif text-[17px] font-semibold leading-[1.4] text-ink-950">{group.title}</span><span className="mt-2.5 flex items-center justify-between font-mono text-sm text-ink-600"><span>{group.records.length} records</span>{issueTotal > 0 ? <span className="text-amber-700">{issueTotal} issues</span> : null}</span></button>; })}</div></aside>
      <section className="min-w-0 border-b border-ink-200 bg-white lg:border-b-0 lg:border-r" aria-label="Records"><div className="border-b border-ink-200 px-4 py-4"><div className="flex items-center justify-between gap-3"><span className="text-base font-semibold text-ink-950">Records</span><span className="font-mono text-sm text-ink-600">{activeRecords.length}</span></div></div><div data-testid="review-matrix-scroller" className="max-h-[47rem] overflow-y-auto"><div data-testid="review-mobile-record">{activeRecords.map((record) => { const cells = buildReviewMatrixCells(record, domain, units); const bucket = reviewIssueBucket(record, domain, clientModule.coreCompleteness); const rowActive = record.id === activeRecord?.id; return <div key={record.id} data-testid="review-matrix-row" aria-current={rowActive ? "true" : undefined} className={`border-b border-ink-200 px-4 py-4 transition ${rowActive ? "bg-brand-50" : "hover:bg-ink-50"}`} onClick={() => setActiveRecordId(record.id)}><div className="flex items-center gap-2.5"><input type="checkbox" checked={selected.has(record.id)} disabled={!queryReady} onClick={(event) => event.stopPropagation()} onChange={() => onToggle(record.id)} aria-label={`Select ${record.id}`} className="h-4 w-4 rounded-[1px] border-ink-400 text-brand-700" /><span className="font-mono text-base font-semibold text-ink-800">{record.id}</span><span className="ml-auto"><ReviewStateBadge bucket={bucket} lowConfidence={reviewRecordHasLowConfidence(record)} /></span></div><div className="mt-3 space-y-1">{matrixColumns.map((definition) => { const candidate = cells.find((item) => item.key === definition.key) ?? { ...definition, value: "—" }; const selectedCell = rowActive && candidate.key === activeCell?.key; return <button key={candidate.key} type="button" onClick={(event) => { event.stopPropagation(); setActiveRecordId(record.id); setActiveCellKey(candidate.key); }} className={`flex min-h-10 w-full items-baseline gap-2 border-l-2 px-2.5 py-2 text-left text-base ${selectedCell ? "border-brand-600 text-brand-900" : "border-transparent text-ink-800 hover:border-ink-400"}`}><span className="w-20 shrink-0 text-sm text-ink-600">{candidate.label}</span><span className="min-w-0 flex-1 truncate font-mono font-semibold">{candidate.value}</span><EvidenceLocationBadge provenance={candidate.provenance} /></button>; })}</div></div>; })}</div></div></section>
      <EvidenceInspector record={activeRecord} cells={activeCells} cell={activeCell} title={resolvedPaper} sharedCells={inspectorSharedCells} domain={domain} mutationBusy={mutationBusy} completeness={activeRecord ? clientModule.coreCompleteness(activeRecord) : { complete: false, missing: [] }} editor={editingId ? editor : undefined} onSelectField={setActiveCellKey} onSelectShared={(recordId, field) => { setActiveRecordId(recordId); setActiveCellKey(field); }} onQuickEdit={onQuickEdit} onReject={() => activeRecord && onReject(activeRecord.id)} onEdit={() => activeRecord && onEdit(activeRecord.id)} onApprove={() => activeRecord && onApprove(activeRecord.id)} />
    </div>
  </section>;
}

function EvidenceLocationBadge({ provenance }: { provenance?: FieldProvenance }) {
  const weak = provenance?.basis === "inferred" || provenance?.basis === "assumed";
  const label = provenanceBadge(provenance) || (provenance ? "source" : "no source");
  return <span title={provenance ? formatProvenance(provenance) || "Evidence available" : "Evidence not linked"} className={`shrink-0 rounded-[2px] border px-2 py-1 font-mono text-xs font-semibold ${provenance ? weak ? "border-amber-200 bg-amber-50 text-amber-800" : "border-brand-200 bg-brand-50 text-brand-800" : "border-ink-200 bg-ink-50 text-ink-600"}`}>{label}</span>;
}

function ReviewStateBadge({ bucket, lowConfidence }: { bucket: Exclude<ReviewIssueFilter, "all" | "low-confidence">; lowConfidence: boolean }) {
  const labels = { ready: "Ready", needs: "Needs fields", "missing-evidence": "Evidence gap", mock: "Mock" } as const;
  const tone = bucket === "ready" ? "text-brand-600" : bucket === "mock" ? "text-rose-600" : "text-amber-600";
  return <span className="inline-flex gap-1.5 font-mono"><span className={`text-xs font-semibold uppercase tracking-[0.06em] ${tone}`}>{labels[bucket]}</span>{lowConfidence && bucket === "ready" ? <span className="text-xs font-semibold uppercase text-amber-700">· Low conf</span> : null}</span>;
}

interface EvidenceInspectorProps {
  record: AnyRecord | null; cells: ReviewMatrixCell[]; cell: ReviewMatrixCell | null; title: string; sharedCells: SharedReviewCell[]; domain: Domain; mutationBusy: boolean; completeness: { complete: boolean; missing: string[] }; editor?: ReactNode;
  onSelectField: (field: string) => void; onSelectShared: (recordId: string, field: string) => void; onQuickEdit: (id: string, field: string, value: string) => Promise<boolean>; onReject: () => void | Promise<void>; onEdit: () => void; onApprove: () => void | Promise<void>;
}

function EvidenceInspector(props: EvidenceInspectorProps) {
  const { record, cells, cell, title, sharedCells, domain, mutationBusy, completeness, editor, onSelectField, onSelectShared, onQuickEdit, onReject, onEdit, onApprove } = props;
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(""); const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); setDraft(cell?.editableValue ?? ""); }, [cell?.editableValue, cell?.key, record?.id]);
  if (!record || !cell) return <aside className="p-5 text-xs text-ink-400">Select a field to inspect its evidence.</aside>;
  const reviewCells = cells.filter(reviewCellNeedsVerification);
  const ionicLiquid = [cells.find((candidate) => candidate.key === "cation")?.editableValue, cells.find((candidate) => candidate.key === "anion")?.editableValue].filter((value): value is string => Boolean(value?.trim()));
  const provenance = cell.provenance;
  const imageSrc = record.sourceId && provenance?.page != null ? `/api/${domain}/source/${encodeURIComponent(record.sourceId)}/page/${provenance.page}` : null;
  return (
    <aside data-testid="review-evidence-inspector" className="min-w-0 bg-white lg:flex lg:h-full lg:flex-col lg:overflow-y-auto">
      <h2 className="sticky top-0 z-20 shrink-0 border-b border-ink-200 bg-white px-4 py-4 text-base font-semibold text-ink-950">Where the data are from and the corresponding operating conditions</h2>
      <header className="border-b border-ink-200 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="line-clamp-2 max-w-3xl font-serif text-[26px] font-semibold leading-[1.18] text-ink-950" title={title}>{title}</h2>
            {ionicLiquid.length > 0 ? <div data-testid="review-ionic-liquid-title" className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1"><span className="text-[13px] font-semibold uppercase tracking-[0.1em] text-ink-600">Ionic liquid</span><span className="font-mono text-[15px] font-semibold text-ink-800">{ionicLiquid.join(" / ")}</span></div> : null}
          </div>
          <span className="shrink-0 font-mono text-sm text-ink-600">{reviewCells.filter((item) => item.provenance ?? sharedCells.find((shared) => shared.key === item.key)?.provenance).length}/{reviewCells.length} fields sourced</span>
        </div>
        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Record fields" data-testid="review-field-selector">
          {reviewCells.map((candidate) => {
            const shared = sharedCells.find((item) => item.key === candidate.key);
            const evidence = candidate.provenance ?? shared?.provenance;
            const active = candidate.key === cell.key;
            return <button key={candidate.key} type="button" data-field={candidate.key} aria-pressed={active} aria-label={`Inspect ${candidate.label}`} title={shared ? "Shared operating condition" : "Record value"}
              onClick={() => candidate.provenance || !shared?.provenance ? onSelectField(candidate.key) : onSelectShared(shared.recordId, candidate.key)}
              className={`inline-flex max-w-full items-center gap-2 rounded-md border px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${active ? "border-brand-600 bg-brand-50 text-brand-900" : "border-ink-200 bg-white text-ink-800 hover:border-brand-400"}`}>
              <span className="font-semibold">{candidate.label}</span>
              <span className="max-w-40 truncate font-mono font-semibold">{candidate.value}</span>
              <EvidenceLocationBadge provenance={evidence} />
            </button>;
          })}
        </nav>
      </header>

      <div className="grid min-w-0 lg:flex-1 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <div className="border-b border-ink-200 bg-white px-5 py-5 xl:border-b-0 xl:border-r xl:border-ink-200">
          <div className="flex items-start justify-between gap-3 border-b border-ink-200 pb-4">
            <div>
              <div className="text-base font-semibold text-ink-700">Field evidence</div>
              <div className="mt-2 flex items-baseline gap-2.5">
                <span className="text-lg font-semibold text-ink-700">{cell.label}</span>
                <span className="truncate font-mono text-[22px] font-bold text-ink-950">{cell.value}</span>
              </div>
            </div>
            <span className="rounded-[2px] border border-ink-200 bg-ink-50 px-2 py-1 font-mono text-sm font-semibold text-ink-700">{record.id}</span>
          </div>

          {editing ? (
            <div className="mt-4 rounded-[2px] border border-brand-300 bg-brand-50 p-4">
              <label className="text-sm font-semibold text-brand-800" htmlFor={`quick-edit-${record.id}-${cell.key}`}>Edit reported value</label>
              <input id={`quick-edit-${record.id}-${cell.key}`} value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-2 min-h-11 w-full rounded-[2px] border border-brand-300 bg-white px-3 py-2.5 font-mono text-base outline-none" />
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-2 text-sm font-semibold text-ink-500">Cancel</button>
                <button type="button" disabled={saving || mutationBusy || !draft.trim()} onClick={async () => { setSaving(true); const saved = await onQuickEdit(record.id, cell.key, draft.trim()); setSaving(false); if (saved) setEditing(false); }} className="rounded-[2px] bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40">{saving ? "Saving…" : "Save value"}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="mt-4 min-h-12 w-full rounded-[2px] border border-ink-300 bg-white px-4 py-3 text-base font-semibold text-ink-900 transition hover:border-brand-700 hover:text-brand-800">Quick edit this field</button>
          )}

          {provenance ? (
            <EvidenceSummary provenance={provenance} onOpen={() => openRecordEvidence({ sourceId: record.sourceId, recordId: record.id, field: cell.key, value: cell.value, prov: provenance, domain })} />
          ) : (
            <div className="mt-4 rounded-[2px] border border-dashed border-amber-400 bg-amber-50 p-4">
              <div className="text-base font-semibold text-amber-800">Evidence not linked</div>
              <p className="mt-1 text-sm leading-6 text-amber-700">Add a source location before approving this record.</p>
            </div>
          )}


        </div>

        <div className="min-w-0 bg-white px-5 py-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-base font-semibold text-ink-800">Original source</span>
            <span className="font-mono text-sm font-semibold text-brand-700">{provenance ? provenanceBadge(provenance) || "source" : "not linked"}</span>
          </div>
          {imageSrc && provenance ? <ReviewEvidencePage imageSrc={imageSrc} sourceId={record.sourceId} recordId={record.id} field={cell.key} value={cell.value} provenance={provenance} domain={domain} /> : <div className="grid min-h-72 place-items-center border border-dashed border-ink-300 bg-ink-50 px-6 text-center text-sm text-ink-600">Select a field with a page reference to view the source document.</div>}
        </div>
      </div>

      {editor ? <div className="border-t border-brand-200 bg-brand-50/30 p-4">{editor}</div> : null}
      <footer className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-ink-300 bg-white px-5 py-3">
        <div className="mr-auto"><div className="font-mono text-[13px] font-semibold text-ink-700">{record.id}</div><div className="text-xs text-ink-400">{completeness.complete ? "Core fields complete" : `Missing: ${completeness.missing.join(", ")}`}</div></div>
        <button type="button" onClick={onReject} disabled={mutationBusy} className="min-h-11 rounded-[2px] border border-rose-300 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700">Reject</button>
        <button type="button" onClick={onEdit} disabled={mutationBusy} className="min-h-11 rounded-[2px] border border-ink-300 bg-white px-4 py-2.5 text-sm font-semibold text-ink-900">Edit record</button>
        <button type="button" onClick={onApprove} disabled={mutationBusy || record.extraction?.source === "mock" || !completeness.complete} className="min-h-11 rounded-[2px] bg-brand-700 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40">Approve & next</button>
      </footer>
    </aside>
  );
}

function EvidenceSummary({ provenance, onOpen }: { provenance: FieldProvenance; onOpen: () => void }) {
  const excerpt = provenance.context?.trim() || provenance.quote?.trim();
  const locationParts = [
    provenance.page != null ? `Page ${provenance.page}` : null,
    provenance.table,
    provenance.figure,
    provenance.section,
  ].filter((part): part is string => Boolean(part));
  const basisLabel = provenance.basis === "direct" ? "Direct evidence" : provenance.basis === "inferred" ? "Inferred evidence" : provenance.basis === "assumed" ? "Assumption" : "Source linked";
  const weak = provenance.basis === "inferred" || provenance.basis === "assumed";

  return (
    <section data-testid="review-evidence-summary" className="mt-4 rounded-[2px] border border-brand-200 bg-brand-50/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-ink-900">Source evidence</h3>
        <span className={`rounded-[2px] border px-2.5 py-1 text-xs font-semibold ${weak ? "border-amber-200 bg-amber-100 text-amber-800" : "border-brand-200 bg-brand-100 text-brand-800"}`}>{basisLabel}</span>
      </div>
      {locationParts.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {locationParts.map((part) => <span key={part} className="rounded-[2px] border border-brand-200 bg-white px-2.5 py-1 font-mono text-xs font-semibold text-brand-800">{part}</span>)}
        </div>
      ) : null}
      <div className="mt-4 text-sm font-semibold text-ink-600">{provenance.context ? "Context around this value" : provenance.table ? "Verbatim table excerpt" : "Verbatim source excerpt"}</div>
      {excerpt ? (
        <blockquote className="mt-2 border-l-2 border-brand-500 pl-3 font-mono text-base font-semibold leading-7 text-ink-900">{excerpt}</blockquote>
      ) : (
        <p className="mt-2 text-sm leading-6 text-ink-600">The source location is recorded, but no excerpt was captured.</p>
      )}
      {!provenance.context && provenance.table && excerpt ? <p className="mt-3 text-sm leading-6 text-ink-600">This compact excerpt comes from a table row. Its cells are highlighted on the original page.</p> : null}
      {provenance.basisNote ? <p className="mt-3 rounded-[2px] border border-ink-200 bg-white px-3 py-2 text-sm leading-6 text-ink-700">{provenance.basisNote}</p> : null}
      <button type="button" onClick={onOpen} className="mt-4 min-h-11 w-full rounded-[2px] border border-brand-300 bg-white px-3 py-3 text-sm font-semibold text-brand-800 transition hover:border-brand-600 hover:bg-brand-50">Open full evidence</button>
    </section>
  );
}

export function reviewEvidenceLookupUrl(domain: Domain, sourceId: string, page: number, quote: string): string {
  return `/api/${domain}/source/${encodeURIComponent(sourceId)}/page/${page}?format=evidence&q=${encodeURIComponent(quote)}`;
}

function ReviewEvidencePage({
  imageSrc,
  sourceId,
  recordId,
  field,
  value,
  provenance,
  domain,
}: {
  imageSrc: string;
  sourceId: string;
  recordId: string;
  field: string;
  value: string;
  provenance: FieldProvenance;
  domain: Domain;
}) {
  const [boxes, setBoxes] = useState<BBox[] | null>(null);
  const [match, setMatch] = useState<EvidenceMatch | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const quote = provenance.quote?.trim() ?? "";

  useEffect(() => {
    setBoxes(null);
    setMatch(null);
    setLookupFailed(false);
    if (provenance.page == null || !quote) {
      setBoxes([]);
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(reviewEvidenceLookupUrl(domain, sourceId, provenance.page!, quote), {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Evidence lookup failed with HTTP ${response.status}`);
        const payload = await response.json() as { boxes?: BBox[]; match?: EvidenceMatch | null };
        if (controller.signal.aborted) return;
        setBoxes(Array.isArray(payload.boxes) ? payload.boxes : []);
        setMatch(payload.match ?? null);
      } catch {
        if (controller.signal.aborted) return;
        setBoxes([]);
        setLookupFailed(true);
      }
    })();

    return () => controller.abort();
  }, [domain, provenance.page, quote, sourceId]);

  const openDetailedEvidence = () => openRecordEvidence({
    sourceId,
    recordId,
    field,
    value,
    prov: provenance,
    domain,
  });

  return (
    <figure data-testid="review-source-page">
      <button
        type="button"
        onClick={openDetailedEvidence}
        className="relative block w-full overflow-hidden border border-ink-200 bg-white"
        aria-label="Open source document"
      >
        <img src={imageSrc} alt={`Source page ${provenance.page}`} className="h-auto w-full" />
        {boxes && boxes.length > 0 ? (
          <span data-testid="review-source-highlight" className="pointer-events-none absolute inset-0" aria-hidden>
            {boxes.map((box, index) => (
              <span
                key={`${box.x}-${box.y}-${index}`}
                className="absolute rounded-[2px] border border-amber-500/80 bg-amber-300/55 shadow-[0_0_0_1px_rgba(255,255,255,0.5)] mix-blend-multiply"
                style={{
                  left: `${Math.max(0, box.x - 0.004) * 100}%`,
                  top: `${Math.max(0, box.y - 0.002) * 100}%`,
                  width: `${Math.min(1, box.w + 0.008) * 100}%`,
                  height: `${Math.min(1, box.h + 0.004) * 100}%`,
                }}
              />
            ))}
          </span>
        ) : null}
      </button>
      <figcaption className="mt-2 flex min-h-5 items-center gap-2 text-xs">
        {boxes === null && quote ? <span className="text-ink-400">Locating quoted evidence…</span> : null}
        {boxes && boxes.length > 0 ? (
          <span className="inline-flex items-center gap-2 font-medium text-amber-700">
            <span className="h-3 w-5 rounded-sm border border-amber-500/80 bg-amber-300/55" />
            Evidence highlighted in the original page{match === "loose" ? " · approximate match" : match === "partial" ? " · partial match" : ""}
          </span>
        ) : null}
        {boxes && boxes.length === 0 && quote ? (
          <span className="font-medium text-amber-700">
            {lookupFailed ? "Evidence lookup failed — open detailed evidence to retry." : "Quoted evidence was not located on this page."}
          </span>
        ) : null}
        {boxes && boxes.length === 0 && !quote ? <span className="text-ink-400">No verbatim quote is stored for this field.</span> : null}
      </figcaption>
    </figure>
  );
}
