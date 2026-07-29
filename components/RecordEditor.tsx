"use client";

import { useMemo, useState } from "react";
import { deriveSlideVelocity, isVoltageLoad } from "@/lib/afm";
import { parseQuantity, stdLabel } from "@/lib/units";
import { PROVENANCE_FIELDS, type ExtractedFields, type FlexibleField, type IonicRecord } from "@/lib/schema";
import { DEFAULT_DOMAIN, type Domain } from "@/lib/domain";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import { Field, Group, Layer, ProvenanceRows, SelectField, provRowsFromRecord, provRowsToFields, type ProvRow } from "./editorParts";

/**
 * Inline editor over the three-layer model. The curator edits raw values; the
 * platform re-standardizes units and re-derives sliding velocity on save. Core
 * (base-layer) fields are marked required and gate official approval.
 */
export function RecordEditor({
  record,
  onSaved,
  onCancel,
  domain = DEFAULT_DOMAIN,
}: {
  record: IonicRecord;
  onSaved: () => void;
  onCancel: () => void;
  domain?: Domain;
}) {
  const e = record.extended;

  // paper + core
  const [title, setTitle] = useState(record.paper.title);
  const [cation, setCation] = useState(record.core.ionicLiquid.cation);
  const [anion, setAnion] = useState(record.core.ionicLiquid.anion);
  const [substrate, setSubstrate] = useState(record.core.substrate);
  const [temperature, setTemperature] = useState(record.core.temperature?.raw ?? "");
  const [load, setLoad] = useState(record.core.load?.raw ?? "");
  const [cof, setCof] = useState(record.core.cof === null ? "" : String(record.core.cof));
  const [cofMethod, setCofMethod] = useState(e.cofMethod ?? "");

  // extended
  const [scale, setScale] = useState(e.scale ?? "");
  const [method, setMethod] = useState(e.method ?? "");
  const [probe, setProbe] = useState(e.probe ?? "");
  const [probeType, setProbeType] = useState(e.probeType ?? "");
  const [potential, setPotential] = useState(e.potential?.raw ?? "");
  const [roughness, setRoughness] = useState(e.roughness?.raw ?? "");
  const [surfaceEnergy, setSurfaceEnergy] = useState(e.surface?.surfaceEnergy?.raw ?? "");
  const [surfaceChargeDensity, setSurfaceChargeDensity] = useState(e.surface?.surfaceChargeDensity?.raw ?? "");
  const [contactAngle, setContactAngle] = useState(e.surface?.contactAngle?.raw ?? "");
  const [crystalPlane, setCrystalPlane] = useState(e.surface?.plane ?? "");
  const [materialClass, setMaterialClass] = useState(e.surface?.materialClass ?? "");
  const [additives, setAdditives] = useState(e.additives ?? "");
  const [filmThickness, setFilmThickness] = useState(
    e.filmThickness?.raw ?? (e.filmLayers != null ? `${e.filmLayers} layers` : "")
  );
  const [waterContent, setWaterContent] = useState(e.waterContent ?? "");
  const [concentration, setConcentration] = useState(e.concentration ?? "");
  const [scanRate, setScanRate] = useState(e.afm?.scanRate ?? "");
  const [scanSize, setScanSize] = useState(e.afm?.scanSize ?? "");
  const [velMode, setVelMode] = useState<"derived" | "reported">(
    e.velocitySource === "reported" ? "reported" : "derived"
  );
  const [reportedVelocity, setReportedVelocity] = useState(
    e.velocitySource === "reported" ? e.velocity?.raw ?? "" : ""
  );

  // flexible (outer layer)
  const [flexible, setFlexible] = useState<FlexibleField[]>(record.flexible);

  // per-field provenance
  const [provRows, setProvRows] = useState<ProvRow[]>(provRowsFromRecord(record.provenance));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivation = useMemo(() => deriveSlideVelocity(scanRate, scanSize), [scanRate, scanSize]);
  const canDerive = derivation.ok;
  const effMode = canDerive ? velMode : "reported";

  const loadVoltage = isVoltageLoad(load);
  const tempQ = parseQuantity(temperature, "temperature");
  const loadQ = loadVoltage ? null : parseQuantity(load, "force");
  const potQ = parseQuantity(potential, "potential");
  const roughQ = parseQuantity(roughness, "length");
  const gammaQ = parseQuantity(surfaceEnergy, "surfaceEnergy");
  const sigmaQ = parseQuantity(surfaceChargeDensity, "surfaceChargeDensity");
  const thetaQ = parseQuantity(contactAngle, "angle");
  const filmQ = /layer/i.test(filmThickness) ? null : parseQuantity(filmThickness, "length");

  const missing = useMemo(() => {
    const m: string[] = [];
    if (!cation.trim()) m.push("Cation");
    if (!anion.trim()) m.push("Anion");
    if (!substrate.trim()) m.push("Substrate");
    if (!tempQ || tempQ.value == null) m.push("Temperature");
    if (!loadQ || loadQ.value == null) m.push("Load");
    if (cof.trim() === "" || Number.isNaN(Number(cof))) m.push("COF");
    return m;
  }, [cation, anion, substrate, tempQ, loadQ, cof]);

  const setFlex = (i: number, key: keyof FlexibleField, value: string) =>
    setFlexible((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));

  const save = async () => {
    const fields: ExtractedFields = {
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
      substrate,
      temperature,
      load,
      cof: cof.trim() === "" ? null : Number(cof),
      cofMethod,
      scale: scale === "nano" || scale === "macro" ? scale : undefined,
      method,
      probe,
      probeType,
      velocity: effMode === "reported" ? reportedVelocity : "",
      potential,
      roughness,
      surfaceEnergy,
      surfaceChargeDensity,
      contactAngle,
      crystalPlane,
      materialClass,
      additives,
      filmThickness,
      waterContent,
      concentration,
      afm: { scanRate, scanSize },
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
        "Could not save this record"
      );
      onSaved();
    } catch (requestError) {
      setError(requestErrorMessage(requestError, "Could not save this record. Please try again."));
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
        <Field req label="Anion" value={anion} onChange={setAnion} placeholder="[I]" mono missing={!anion.trim()} />
        <Field req label="Substrate" value={substrate} onChange={setSubstrate} placeholder="Au(111)" missing={!substrate.trim()} />
        <Field req label="Temperature" value={temperature} onChange={setTemperature} placeholder="not stated / 293.15 K / 25 °C"
          std={stdLabel(tempQ)} missing={!tempQ || tempQ.value == null} />
        <Field req label="Load (force)" value={load} onChange={setLoad} placeholder=">5 nN"
          std={loadVoltage ? "⚠ looks like a voltage — will move to flexible" : stdLabel(loadQ)}
          warn={loadVoltage} missing={!loadQ || loadQ.value == null} />
        <Field req label="COF" value={cof} onChange={setCof} placeholder="0.12" mono missing={cof.trim() === "" || Number.isNaN(Number(cof))} />
      </Layer>

      {/* MIDDLE LAYER */}
      <Layer tone="slate" name="Middle layer · extended (optional)">
        <SelectField label="Scale" value={scale} onChange={setScale} options={["", "nano", "macro"]} />
        <Field label="Method" value={method} onChange={setMethod} placeholder="AFM / Tribometer" />
        <Field label="Probe" value={probe} onChange={setProbe} placeholder="Silica" />
        <Field label="Probe type" value={probeType} onChange={setProbeType} placeholder="Colloid probe" />
        <Field label="Potential" value={potential} onChange={setPotential} placeholder="+0.5 V" std={stdLabel(potQ)} />
        <Field label="Roughness" value={roughness} onChange={setRoughness} placeholder="2 nm" std={stdLabel(roughQ)} />
        <Field label="γ_s surface energy" value={surfaceEnergy} onChange={setSurfaceEnergy} placeholder="55 mJ/m²" std={stdLabel(gammaQ)} />
        <Field label="σ_s surface charge" value={surfaceChargeDensity} onChange={setSurfaceChargeDensity} placeholder="-0.02 C/m²" std={stdLabel(sigmaQ)} />
        <Field label="θ_s contact angle" value={contactAngle} onChange={setContactAngle} placeholder="75°" std={stdLabel(thetaQ)} />
        <Field label="Crystal plane" value={crystalPlane} onChange={setCrystalPlane} placeholder="(111) / polycrystalline" />
        <Field label="Material class" value={materialClass} onChange={setMaterialClass} placeholder="metal / carbon / ceramic" />
        <Field label="Additives" value={additives} onChange={setAdditives} placeholder="1 wt% benzotriazole" />
        <Field label="Film thickness" value={filmThickness} onChange={setFilmThickness} placeholder="2.5 nm or 3 layers" std={filmQ ? stdLabel(filmQ) : undefined} />
        <Field label="Water content" value={waterContent} onChange={setWaterContent} placeholder="120 ppm" />
        <Field label="Concentration" value={concentration} onChange={setConcentration} placeholder="x_IL = 0.3 / 10 wt%" />
        <Field label="COF method" value={cofMethod} onChange={setCofMethod} placeholder="Ff/FN slope" />
      </Layer>

      {/* AFM + velocity */}
      <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="label-eyebrow text-violet-500">AFM scan parameters → sliding velocity</span>
          <span className="font-mono text-xs text-violet-600">v = 2 · ḟ · L</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <LabeledInput label="ḟ scan rate" value={scanRate} onChange={setScanRate} placeholder="1 Hz" />
          <LabeledInput label="L scan size" value={scanSize} onChange={setScanSize} placeholder="2 µm" />
        </div>
        {derivation.steps && <div className="mt-2 font-mono text-xs text-violet-600">{derivation.steps}</div>}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-violet-200 pt-3">
          <span className="label-eyebrow">Sliding velocity</span>
          <div className="flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs">
            <ModeButton active={effMode === "derived"} disabled={!canDerive} onClick={() => setVelMode("derived")}>Derived from scan</ModeButton>
            <ModeButton active={effMode === "reported"} onClick={() => setVelMode("reported")}>Reported</ModeButton>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          {effMode === "reported" ? (
            <input value={reportedVelocity} onChange={(ev) => setReportedVelocity(ev.target.value)} placeholder="2 µm/s"
              className="w-40 rounded-lg border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-100" />
          ) : (
            <span className="font-mono text-lg font-bold text-violet-700">{derivation.velocityLabel ?? "—"}</span>
          )}
          <span className="text-xs text-ink-400">{effMode === "derived" ? "auto-derived from scan rate × scan size" : "entered directly from the paper"}</span>
        </div>
      </div>

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
              <input value={f.key} onChange={(ev) => setFlex(i, "key", ev.target.value)} placeholder="key (e.g. humidity)"
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
      <ProvenanceRows rows={provRows} onChange={setProvRows} fields={PROVENANCE_FIELDS} defaultField="cof" />
    </div>
  );
}

/* ---------- helpers ---------- */

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block font-mono text-xs text-violet-600">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" />
    </label>
  );
}

function ModeButton({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`rounded px-2.5 py-1 font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${active ? "bg-violet-600 text-white" : "text-ink-500 hover:text-ink-700"}`}>
      {children}
    </button>
  );
}
