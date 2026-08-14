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
  const resolvedSmiles = smiles?.trim() || inferred?.smiles;
  const hasIonLabel = Boolean(ionLabel?.trim());
  const source = smiles?.trim() ? "record" : inferred?.source ?? (hasIonLabel ? "label" : "missing");
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
    if (!resolvedSmiles || !svgRef.current) {
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
  }, [atomFontSize, atomFontSizeSmall, bondLength, bondThickness, drawHeight, drawPadding, drawWidth, resolvedSmiles]);

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
            <svg
              ref={svgRef}
              width={drawWidth}
              height={drawHeight}
              aria-hidden="true"
              className={ok ? "molecule-canvas relative z-10 block h-auto max-w-full" : "hidden"}
            />
            {!ok && <StructurePlaceholder kind={viewKind} ionLabel={ionLabel} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function StructurePlaceholder({ kind, ionLabel }: { kind: IonKind; ionLabel?: string }) {
  const isCation = kind === "cation";
  const stroke = isCation ? "#0891b2" : "#059669";
  const charge = isCation ? "+" : "-";
  const label = ionLabel?.replace(/^\[/, "").replace(/\]$/, "").slice(0, 10) || "ion";
  return (
    <svg width="112" height="66" viewBox="0 0 112 66" fill="none" className="molecule-placeholder relative z-10 text-ink-300" aria-hidden="true">
      <path
        d="M18 42 L33 24 L51 36 L68 18 L87 32"
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity=".55"
      />
      <g>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 -2;0 0" dur="2.8s" repeatCount="indefinite" />
        <circle cx="18" cy="42" r="4" fill={stroke} opacity=".55" />
        <circle cx="87" cy="32" r="4" fill={stroke} opacity=".35" />
        <circle cx="56" cy="32" r="15" fill="white" stroke={stroke} strokeWidth="1.5" opacity=".88" />
        <text x="56" y="35" textAnchor="middle" className="fill-ink-600 font-mono text-[10px] font-bold">
          {charge}
        </text>
      </g>
      <text x="56" y="60" textAnchor="middle" className="fill-ink-400 font-mono text-[9px] font-semibold">
        {label}
      </text>
    </svg>
  );
}
