"use client";

import { useMemo, useState } from "react";
import { parseQuantity, stdLabel } from "@/lib/units";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { FlexibleField } from "@/lib/schema";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import {
  CONDUCTIVITY_PROVENANCE_FIELDS,
  type ConductivityExtractedFields,
  type ConductivityRecord,
} from "@/lib/conductivity/schema";
import { Field, Group, Layer, ProvenanceRows, SelectField, provRowsFromRecord, provRowsToFields, type ProvRow } from "../editorParts";

/**
 * Inline editor for a conductivity record. The curator edits raw values; the
 * platform re-standardizes supported units while preserving normalized raw
 * units such as µF/cm² and Ω cm². Identity, conditions, and at least one
 * target electrochemical property gate official approval.
 */
export function ConductivityEditor({
  record,
  onSaved,
  onCancel,
  domain = DEFAULT_DOMAIN,
}: {
  record: ConductivityRecord;
  onSaved: () => void;
  onCancel: () => void;
  domain?: Domain;
}) {
  const e = record.extended;

  const [title, setTitle] = useState(record.paper.title);
  const [cation, setCation] = useState(record.core.ionicLiquid.cation);
  const [anion, setAnion] = useState(record.core.ionicLiquid.anion);
  const [surface, setSurface] = useState(record.core.surface);
  const [temperature, setTemperature] = useState(record.core.temperature?.raw ?? "");
  const [conductivity, setConductivity] = useState(record.core.conductivity?.raw ?? "");
  const [capacitance, setCapacitance] = useState(record.core.capacitance?.raw ?? "");
  const [electricField, setElectricField] = useState(record.core.electricField?.raw ?? "");
  const [electrodePotential, setElectrodePotential] = useState(record.core.electrodePotential?.raw ?? "");
  const [electrochemicalWindow, setElectrochemicalWindow] = useState(record.core.electrochemicalWindow?.raw ?? "");
  const [chargeTransferResistance, setChargeTransferResistance] = useState(record.core.chargeTransferResistance?.raw ?? "");
  const [potentialReference, setPotentialReference] = useState(e.potentialReference ?? "");

  const [method, setMethod] = useState(e.method ?? "");
  const [viscosity, setViscosity] = useState(e.viscosity?.raw ?? "");
  const [waterContent, setWaterContent] = useState(e.waterContent ?? "");
  const [concentration, setConcentration] = useState(e.concentration ?? "");
  const [density, setDensity] = useState(e.density ?? "");
  const [cellConstant, setCellConstant] = useState(e.cellConstant ?? "");

  const [flexible, setFlexible] = useState<FlexibleField[]>(record.flexible);
  const [provRows, setProvRows] = useState<ProvRow[]>(provRowsFromRecord(record.provenance));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tempQ = parseQuantity(temperature, "temperature");
  const sigmaQ = parseQuantity(conductivity, "conductivity");
  const capacitanceQ = parseQuantity(capacitance, "capacitance");
  const electricFieldQ = parseQuantity(electricField, "electricField");
  const electrodePotentialQ = parseQuantity(electrodePotential, "potential");
  const electrochemicalWindowQ = parseQuantity(electrochemicalWindow, "potential");
  const chargeTransferResistanceQ = parseQuantity(chargeTransferResistance, "resistance");
  const viscQ = parseQuantity(viscosity, "viscosity");

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!cation.trim()) m.push("Cation");
    if (!anion.trim()) m.push("Anion");
    if (!surface.trim()) m.push("Surface");
    if (!tempQ || tempQ.value == null) m.push("Temperature");
    if (!sigmaQ && !capacitanceQ && !electricFieldQ && !electrochemicalWindowQ && !chargeTransferResistanceQ) {
      m.push("Target electrochemical property");
    }
    return m;
  }, [cation, anion, surface, tempQ, sigmaQ, capacitanceQ, electricFieldQ, electrochemicalWindowQ, chargeTransferResistanceQ]);

  const setFlex = (i: number, key: keyof FlexibleField, value: string) =>
    setFlexible((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const save = async () => {
    const fields: ConductivityExtractedFields = {
      paper: { ...record.paper, title },
      cation,
      anion,
      cationSmiles:
        cation.trim() === record.core.ionicLiquid.cation.trim()
          ? record.core.ionicLiquid.cationSmiles
          : undefined,
      anionSmiles:
        anion.trim() === record.core.ionicLiquid.anion.trim()
          ? record.core.ionicLiquid.anionSmiles
          : undefined,
      surface,
      temperature,
      conductivity,
      capacitance,
      electricField,
      electrodePotential,
      electrochemicalWindow,
      chargeTransferResistance,
      potentialReference,
      method,
      viscosity,
      waterContent,
      concentration,
      density,
      cellConstant,
      flexible: flexible.filter((f) => f.key.trim() && f.value.trim()),
      provenance: provRowsToFields(provRows),
      confidence: record.confidence,
    };
    setBusy(true);
    setError(null);
    try {
      await requestJson(
        `/api/${domain}/records/${encodeURIComponent(record.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fields }),
        },
        "Could not save this conductivity record"
      );
      onSaved();
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not save this conductivity record. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-300 bg-white p-4 shadow-card">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-xs text-ink-500">{record.id}</span>
          <span className="text-sm font-semibold">Editing record</span>
          {missing.length > 0 && (
            <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
              missing core: {missing.join(", ")}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="btn px-3 py-1.5 text-xs">Cancel</button>
          <button onClick={save} disabled={busy} className="btn-primary px-3 py-1.5 text-xs">{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      {error && <div className="mb-3"><RequestError>{error}</RequestError></div>}

      <Group label="Source">
        <Field className="sm:col-span-3" label="Paper title" value={title} onChange={setTitle} placeholder="Paper title" />
      </Group>

      {/* BASE LAYER */}
      <Layer tone="brand" name="Base layer · core (required)">
        <Field req label="Cation" value={cation} onChange={setCation} placeholder="[BMIM]" mono missing={!cation.trim()} />
        <Field req label="Anion" value={anion} onChange={setAnion} placeholder="[BF4]" mono missing={!anion.trim()} />
        <Field req label="Surface" value={surface} onChange={setSurface} placeholder="Pt / glassy carbon" missing={!surface.trim()} />
        <Field req label="Temperature" value={temperature} onChange={setTemperature} placeholder="298.15 K / 25 °C"
          std={stdLabel(tempQ)} missing={!tempQ || tempQ.value == null} />
        <Field label="Conductivity (σ)" value={conductivity} onChange={setConductivity} placeholder="12 mS/cm"
          std={stdLabel(sigmaQ)} mono />
      </Layer>

      <Layer tone="slate" name="Electrical measurements · optional">
        <Field label="Capacitance" value={capacitance} onChange={setCapacitance} placeholder="120 pF / 82.9 µF/cm²"
          std={stdLabel(capacitanceQ)} mono />
        <Field label="Electric field" value={electricField} onChange={setElectricField} placeholder="1 kV/m / 0.2 V/Å"
          std={stdLabel(electricFieldQ)} mono />
        <Field label="Electrode potential" value={electrodePotential} onChange={setElectrodePotential} placeholder="-1.0 V"
          std={stdLabel(electrodePotentialQ)} mono />
        <Field label="Potential reference" value={potentialReference} onChange={setPotentialReference} placeholder="Ag/AgCl / Na+/Na" />
        <Field label="Electrochemical window" value={electrochemicalWindow} onChange={setElectrochemicalWindow} placeholder="0.1–5.0 V"
          std={stdLabel(electrochemicalWindowQ)} mono />
        <Field label="Charge-transfer resistance" value={chargeTransferResistance} onChange={setChargeTransferResistance} placeholder="255.5 Ω cm²"
          std={stdLabel(chargeTransferResistanceQ)} mono />
      </Layer>

      {/* MIDDLE LAYER */}
      <Layer tone="slate" name="Middle layer · extended (optional)">
        <SelectField label="Method" value={method} onChange={setMethod} options={["", "EIS", "conductivity cell", "CV", "chronoamperometry", "galvanostatic charge-discharge", "MD simulation"]} />
        <Field label="Viscosity" value={viscosity} onChange={setViscosity} placeholder="45 cP" std={stdLabel(viscQ)} />
        <Field label="Water content" value={waterContent} onChange={setWaterContent} placeholder="120 ppm" />
        <Field label="Concentration" value={concentration} onChange={setConcentration} placeholder="0.5 mol/L" />
        <Field label="Density" value={density} onChange={setDensity} placeholder="1.21 g/cm³" />
        <Field label="Cell constant" value={cellConstant} onChange={setCellConstant} placeholder="1.0 cm⁻¹" />
      </Layer>

      {/* OUTER LAYER */}
      <div className="mt-3 rounded-xl border border-dashed border-violet-300 bg-violet-50/30 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-eyebrow text-violet-500">Outer layer · flexible (raw JSON catch-all)</span>
          <button
            onClick={() => setFlexible((p) => [...p, { key: "", value: "", note: "" }])}
            className="rounded-lg border border-violet-200 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100"
          >
            + Add field
          </button>
        </div>
        {flexible.length === 0 && <p className="text-xs text-ink-400">Park anything without a formal home here — it’s kept with a note, not discarded.</p>}
        <div className="space-y-2">
          {flexible.map((f, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <input value={f.key} onChange={(ev) => setFlex(i, "key", ev.target.value)} placeholder="key (e.g. pressure)"
                className="w-36 rounded-lg border border-violet-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400" />
              <input value={f.value} onChange={(ev) => setFlex(i, "value", ev.target.value)} placeholder="value"
                className="w-32 rounded-lg border border-violet-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400" />
              <input value={f.note ?? ""} onChange={(ev) => setFlex(i, "note", ev.target.value)} placeholder="note / source"
                className="flex-1 rounded-lg border border-violet-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400" />
              <button onClick={() => setFlexible((p) => p.filter((_, idx) => idx !== i))}
                className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs text-ink-400 hover:border-rose-200 hover:text-rose-600">✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* PROVENANCE */}
      <ProvenanceRows
        rows={provRows}
        onChange={setProvRows}
        fields={CONDUCTIVITY_PROVENANCE_FIELDS}
        defaultField="conductivity"
      />
    </div>
  );
}
