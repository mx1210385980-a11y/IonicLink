"use client";

import { useMemo, useState } from "react";
import { parseQuantity, stdLabel } from "@/lib/units";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import type { FlexibleField } from "@/lib/schema";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import {
  DIFFUSION_PROVENANCE_FIELDS,
  type DiffusionExtractedFields,
  type DiffusionRecord,
} from "@/lib/diffusion/schema";
import { Field, Group, Layer, ProvenanceRows, SelectField, provRowsFromRecord, provRowsToFields, type ProvRow } from "../editorParts";

/**
 * Inline editor for a diffusion record. The curator edits raw values; the
 * platform re-standardizes D → m²/s and viscosity → Pa·s on save. Core fields
 * (cation, anion, species, temperature, diffusion) gate official approval.
 */
export function DiffusionEditor({
  record,
  onSaved,
  onCancel,
  domain = DEFAULT_DOMAIN,
}: {
  record: DiffusionRecord;
  onSaved: () => void;
  onCancel: () => void;
  domain?: Domain;
}) {
  const e = record.extended;

  const [title, setTitle] = useState(record.paper.title);
  const [cation, setCation] = useState(record.core.ionicLiquid.cation);
  const [anion, setAnion] = useState(record.core.ionicLiquid.anion);
  const [species, setSpecies] = useState(record.core.species);
  const [temperature, setTemperature] = useState(record.core.temperature?.raw ?? "");
  const [diffusion, setDiffusion] = useState(record.core.diffusion?.raw ?? "");

  const [systemName, setSystemName] = useState(e.systemName ?? "");
  const [poreSize, setPoreSize] = useState(e.poreSize?.raw ?? "");
  const [method, setMethod] = useState(e.method ?? "");
  const [nucleus, setNucleus] = useState(e.nucleus ?? "");
  const [surface, setSurface] = useState(e.surface ?? "");
  const [viscosity, setViscosity] = useState(e.viscosity?.raw ?? "");
  const [waterContent, setWaterContent] = useState(e.waterContent ?? "");
  const [concentration, setConcentration] = useState(e.concentration ?? "");

  const [flexible, setFlexible] = useState<FlexibleField[]>(record.flexible);
  const [provRows, setProvRows] = useState<ProvRow[]>(provRowsFromRecord(record.provenance));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tempQ = parseQuantity(temperature, "temperature");
  const dQ = parseQuantity(diffusion, "diffusion");
  const viscQ = parseQuantity(viscosity, "viscosity");
  const poreQ = parseQuantity(poreSize, "length");

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!cation.trim()) m.push("Cation");
    if (!anion.trim()) m.push("Anion");
    if (!species.trim()) m.push("Species");
    if (!tempQ || tempQ.value == null) m.push("Temperature");
    if (!dQ || dQ.value == null) m.push("Diffusion D");
    return m;
  }, [cation, anion, species, tempQ, dQ]);

  const setFlex = (i: number, key: keyof FlexibleField, value: string) =>
    setFlexible((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const save = async () => {
    const fields: DiffusionExtractedFields = {
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
      species,
      temperature,
      diffusion,
      systemName,
      poreSize,
      method,
      nucleus,
      surface,
      viscosity,
      waterContent,
      concentration,
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
        "Could not save this diffusion record"
      );
      onSaved();
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not save this diffusion record. Please try again."));
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
        <Field req label="Cation" value={cation} onChange={setCation} placeholder="[EMIM]" mono missing={!cation.trim()} />
        <Field req label="Anion" value={anion} onChange={setAnion} placeholder="[TFSI]" mono missing={!anion.trim()} />
        <Field req label="Species (diffusing ion)" value={species} onChange={setSpecies} placeholder="cation / anion" missing={!species.trim()} />
        <Field req label="Temperature" value={temperature} onChange={setTemperature} placeholder="303 K / 30 °C"
          std={stdLabel(tempQ)} missing={!tempQ || tempQ.value == null} />
        <Field req label="Diffusion D" value={diffusion} onChange={setDiffusion} placeholder="5.2 × 10⁻¹¹ m² s⁻¹"
          std={stdLabel(dQ)} mono missing={!dQ || dQ.value == null} />
      </Layer>

      {/* MIDDLE LAYER */}
      <Layer tone="slate" name="Middle layer · extended (optional)">
        <Field label="Confined system" value={systemName} onChange={setSystemName} placeholder="MCM-41 pores / silica nanochannel" />
        <Field label="Pore size" value={poreSize} onChange={setPoreSize} placeholder="2.5 nm / 38 Å" std={stdLabel(poreQ)} mono />
        <SelectField label="Method" value={method} onChange={setMethod} options={["", "PFG-NMR", "electrochemical", "MD simulation"]} />
        <Field label="Nucleus" value={nucleus} onChange={setNucleus} placeholder="¹H / ¹⁹F / ⁷Li" mono />
        <Field label="Surface (electrochemical only)" value={surface} onChange={setSurface} placeholder="Pt microelectrode" />
        <Field label="Viscosity" value={viscosity} onChange={setViscosity} placeholder="28 cP" std={stdLabel(viscQ)} />
        <Field label="Water content" value={waterContent} onChange={setWaterContent} placeholder="20 ppm" />
        <Field label="Concentration" value={concentration} onChange={setConcentration} placeholder="0.5 mol/L" />
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
              <input value={f.key} onChange={(ev) => setFlex(i, "key", ev.target.value)} placeholder="key (e.g. diffusion time)"
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
        fields={DIFFUSION_PROVENANCE_FIELDS}
        defaultField="diffusion"
      />
    </div>
  );
}
