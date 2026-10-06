import type { ConductivityCurveKeyPoint, ConductivityPerformanceFigure, ConductivityPerformancePanel } from "./schema";

const MEANINGS: Record<string, string> = {
  conductivity: "Ionic conductivity at the reported temperature and composition; comparisons must retain temperature, water content, and concentration.",
  chargeTransferResistance: "Interfacial charge-transfer resistance reported by the paper, not the highest point of a Nyquist curve; valid only for the listed electrodes and conditions.",
  electrochemicalWindow: "Electrochemical stability window reported by the paper; a CV scan range is not a substitute for the stability window.",
  capacitance: "Charge-storage response; retain measurement frequency and area- or mass-normalization basis.",
  viscosity: "Resistance to flow under the reported conditions; a transport-related property distinct from conductivity.",
  electricField: "Electric-field magnitude at the stated position or condition; not interchangeable with applied electrode potential.",
};

const LEGACY_LABELS: Record<string, string> = {
  "扫描速率": "Scan rate",
  "电位扫描范围": "Potential scan range",
  "循环对比": "Cycle comparison",
  "首圈电流升高": "First-cycle current rise",
  "高频实轴截距 · ESR": "High-frequency real-axis intercept · ESR",
};

const LEGACY_INTERPRETATIONS: Record<string, string> = {
  "文献报告的电化学稳定窗口；CV 的扫描范围不能替代稳定窗口。":
    "Electrochemical stability window reported by the paper; the CV scan range is not a substitute for the stability window.",
  "扫描速率影响电流响应；比较 CV 峰电流或起始电位时需保留此条件。":
    "Scan rate affects the current response and must be retained when comparing CV peak currents or onset potentials.",
  "这是实验施加的扫描区间，不是电化学稳定窗口。":
    "This is the applied experimental scan range, not the electrochemical stability window.",
  "对比所列循环次数的电流响应，避免把不同循环的读数混用。":
    "Compare the current response at the listed cycle numbers; readings from different cycles must not be mixed.",
  "首圈高电流随后降低；论文解释为稳定界面膜形成，并非稳定窗口的判定阈值。":
    "The first-cycle current subsequently decreases; the paper attributes this to formation of a stable interphase, not to a stability-window threshold.",
  "论文描述的首圈高电流区间，不等同于稳定窗口阈值。":
    "The paper's first-cycle high-current region is not equivalent to a stability-window threshold.",
  "文献报告的界面电荷转移阻力，不是 Nyquist 曲线的最高点；仅适用于所列电极与条件。":
    "Interfacial charge-transfer resistance reported by the paper, not the highest point of the Nyquist curve; valid only for the listed electrodes and conditions.",
  "文献将高频实轴截距归为等效串联电阻，报告其不随电极电势变化；不要与 Rct 混用。":
    "The paper assigns the high-frequency real-axis intercept to equivalent series resistance and reports it as potential-independent; it must not be confused with Rct.",
  "该温度与组成下的离子电导率；比较时需同时保留温度、含水量与浓度。":
    "Ionic conductivity at the stated temperature and composition; comparisons must also retain water content and concentration.",
  "电荷存储响应；需同时保留测量频率和面积或质量归一化方式。":
    "Charge-storage response; retain measurement frequency and the area- or mass-normalization basis.",
  "所述位置或条件下的电场强度；不等同于外加电极电势。":
    "Electric-field magnitude at the stated position or condition; it is not interchangeable with applied electrode potential.",
};

export function pointDisplayLabel(point: ConductivityCurveKeyPoint): string {
  return LEGACY_LABELS[point.label] ?? point.label;
}

export function pointInterpretation(point: ConductivityCurveKeyPoint): string | undefined {
  const interpretation = point.interpretation?.trim();
  return (interpretation ? LEGACY_INTERPRETATIONS[interpretation] ?? interpretation : undefined) || MEANINGS[point.field ?? ""];
}

/** Parent points describe the record; other-panel or other-series readings do not become this trace's points. */
export function visibleCurveKeyPoints(figure: ConductivityPerformanceFigure, panel?: ConductivityPerformancePanel | null) {
  const parent = panel?.keyPoints?.length ? [] : (figure.keyPoints ?? []).filter(p=>!panel||!p.panelLabel||p.panelLabel.toUpperCase()===panel.label.toUpperCase());
  const points = [...parent, ...(panel?.keyPoints ?? [])];
  const seen = new Set<string>();
  return points.filter((p) => {
    const key=[p.field,p.label,p.value,p.seriesLabel,p.x,p.y,p.slope].join("|");
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}
