"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { resolveIonStructure, type IonKind } from "@/lib/ionStructures";

/**
 * Renders a SMILES string as a 2D structure using smiles-drawer (canvas), with
 * a curated ion-name fallback for common ionic-liquid cations and anions.
 */
export function MoleculeView({
  smiles,
  ionLabel,
  kind,
  label,
  width = 160,
  height = 80,
}: {
  smiles?: string;
  ionLabel?: string;
  kind?: IonKind;
  label: string;
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [ok, setOk] = useState(false);
  const inferred = resolveIonStructure(ionLabel, kind);
  // A curated/pattern-resolved identity is authoritative. Extracted SMILES are
  // used only when the label is not in the verified catalog.
  const resolvedSmiles = inferred?.smiles || smiles?.trim();
  const monatomic = parseMonatomicIon(resolvedSmiles);
  const monatomicAtom = monatomic?.atom;
  const monatomicCharge = monatomic?.charge;
  const hasIonLabel = Boolean(ionLabel?.trim());
  const source = inferred?.source ?? (smiles?.trim() ? "record" : hasIonLabel ? "unresolved" : "missing");
  const displayName = inferred?.name ?? ionLabel?.trim() ?? "Unknown ion";
  const viewKind = kind ?? "cation";
  const isCation = viewKind === "cation";
  const drawWidth = isCation ? width : Math.max(width, 320);
  const drawHeight = isCation ? height : Math.max(height, 116);
  const drawPadding = isCation ? 10 : 6;
  const bondThickness = isCation ? 1.7 : 2.2;
  const atomFontSize = isCation ? 11 : 14;
  const atomFontSizeSmall = isCation ? 3 : 4.2;
  const bondLength = isCation ? 30 : 34;

  useEffect(() => {
    let cancelled = false;
    if (!resolvedSmiles || monatomicAtom || !svgRef.current) {
      setOk(false);
      return;
    }
    setOk(false);
    (async () => {
      try {
        const { default: SmilesDrawer } = await import("smiles-drawer");
        if (!SmilesDrawer?.SvgDrawer) {
          setOk(false);
          return;
        }
        const svg = svgRef.current;
        if (!svg) return;
        svg.innerHTML = "";
        svg.setAttribute("width", `${drawWidth}`);
        svg.setAttribute("height", `${drawHeight}`);
        svg.style.width = `${drawWidth}px`;
        svg.style.height = `${drawHeight}px`;
        const drawer = new SmilesDrawer.SvgDrawer({
          width: drawWidth,
          height: drawHeight,
          bondThickness,
          bondLength,
          fontSizeLarge: atomFontSize,
          fontSizeSmall: atomFontSizeSmall,
          padding: drawPadding,
          compactDrawing: false,
          themes: {
            light: {
              FOREGROUND: "#111827",
              BACKGROUND: "#ffffff",
              C: "#111827",
              O: "#ef4444",
              N: "#2563eb",
              F: "#059669",
              CL: "#0f766e",
              BR: "#c2410c",
              I: "#7c3aed",
              P: "#dc2626",
              S: "#f59e0b",
              B: "#d97706",
              SI: "#d97706",
              H: "#64748b",
            },
          },
        });
        SmilesDrawer.parse(
          resolvedSmiles,
          (tree: unknown) => {
            if (cancelled || !svgRef.current) return;
            drawer.draw(tree, svgRef.current, "light", null, false);
            setOk(true);
          },
          () => setOk(false)
        );
      } catch {
        if (!cancelled) setOk(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [atomFontSize, atomFontSizeSmall, bondLength, bondThickness, drawHeight, drawPadding, drawWidth, monatomicAtom, monatomicCharge, resolvedSmiles]);

  return (
    <div
      data-testid={`molecule-view-${viewKind}`}
      data-smiles={resolvedSmiles ?? ""}
      data-ion-source={source}
      style={{ "--molecule-view-height": `${drawHeight}px` } as CSSProperties}
      className={`relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border px-2 py-1.5 ${
        isCation
          ? "border-cyan-100 bg-gradient-to-b from-cyan-50/70 to-white"
          : "border-emerald-100 bg-gradient-to-b from-emerald-50/70 to-white"
      }`}
      title={inferred ? `${label}: ${inferred.name}` : `${label}: ${ionLabel ?? "unknown ion"}`}
    >
      <div className="relative z-10 min-h-8 min-w-0">
        <span
          data-testid={`molecule-name-${viewKind}`}
          className={`block break-words text-[10px] font-semibold leading-snug ${isCation ? "text-cyan-800" : "text-emerald-800"}`}
        >
          {displayName}
        </span>
      </div>
      <div className={`molecule-field molecule-field-${viewKind}`}>
        <div data-testid={`molecule-spin-stage-${viewKind}`} className="molecule-spin-stage">
          <div className={`molecule-spin molecule-spin-${viewKind}`}>
            {monatomic ? (
              <MonatomicIon atom={monatomic.atom} charge={monatomic.charge} kind={viewKind} />
            ) : (
              <>
                <svg
                  ref={svgRef}
                  width={drawWidth}
                  height={drawHeight}
                  aria-hidden="true"
                  className={ok ? "molecule-canvas relative z-10 block h-auto max-w-full" : "hidden"}
                />
                {!ok && <StructurePlaceholder kind={viewKind} ionLabel={ionLabel} hasSmiles={Boolean(resolvedSmiles)} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function parseMonatomicIon(smiles: string | undefined): { atom: string; charge: string } | null {
  const match = smiles?.match(/^\[([A-Z][a-z]?)([+-])\]$/);
  if (!match) return null;
  return { atom: match[1], charge: match[2] === "+" ? "+" : "−" };
}

function MonatomicIon({ atom, charge, kind }: { atom: string; charge: string; kind: IonKind }) {
  const isCation = kind === "cation";
  const stroke = isCation ? "#0891b2" : "#059669";
  return (
    <div data-testid={`monatomic-ion-${kind}`} className="relative z-10 grid h-[66px] w-[112px] place-items-center" aria-label={`${atom}${charge} ion`}>
      <div className="relative grid h-12 w-12 place-items-center rounded-full border-2 bg-white font-serif text-2xl font-semibold" style={{ borderColor: stroke, color: stroke }}>
        {atom}
        <sup className="absolute -right-2 -top-2 text-sm font-bold">{charge}</sup>
      </div>
    </div>
  );
}

function StructurePlaceholder({ kind, ionLabel, hasSmiles }: { kind: IonKind; ionLabel?: string; hasSmiles: boolean }) {
  const isCation = kind === "cation";
  const stroke = isCation ? "#0891b2" : "#059669";
  const label = ionLabel?.trim() || "Unknown ion";
  return (
    <div
      data-testid={`unverified-structure-${kind}`}
      className="relative z-10 flex h-[66px] w-[132px] flex-col items-center justify-center rounded-lg border border-dashed bg-white/80 px-2 text-center"
      style={{ borderColor: `${stroke}66` }}
      title={`${label}: ${hasSmiles ? "SMILES could not be rendered" : "no verified SMILES"}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: stroke }}>Structure not verified</span>
      <span className="mt-1 line-clamp-2 max-w-full break-all font-mono text-[9px] text-ink-500">{label}</span>
    </div>
  );
}
