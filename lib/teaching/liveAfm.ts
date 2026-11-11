import type { AfmPhysicalAxes } from "../afm/axisCalibration";

export type LiveAfmCurve = {
  id: string; label: string; page: number | null; figure: string | null;
  imageDataUrl: string; axes: AfmPhysicalAxes | null;
  points: Array<[number, number]>; segmentStarts: number[]; warnings: string[];
};
export type LiveAfmArtifact = {
  schema: "ioniclink.classroom-afm.v1"; sourceName: string;
  createdAt: string; curves: LiveAfmCurve[];
};
