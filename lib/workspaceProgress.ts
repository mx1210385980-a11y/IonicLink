import type { Domain } from "./domain";
import { buildDataset } from "./predict/dataset";
import { CALIBRATION_GATE } from "./predict/engine";
import type { BatchJob } from "./schema";

type CountByStatus = { official: number; review: number };
type JobSnapshot = Pick<BatchJob, "status" | "recordCount">;

export interface WorkspaceProgress {
  domain: Domain;
  sourceCount: number;
  recordCount: number;
  counts: CountByStatus;
  review: {
    ready: number;
    incomplete: number;
    mockLocked: number;
  };
  jobs: {
    total: number;
    queued: number;
    extracting: number;
    done: number;
    error: number;
    committed: number;
    doneCandidates: number;
  };
  design: {
    usable: number;
    gate: number;
    gap: number;
    ready: boolean;
  };
}

export interface NextAction {
  key: "errors" | "active" | "done" | "ready-review" | "incomplete-review" | "mock-locked" | "calibration" | "design-ready";
  eyebrow: string;
  title: string;
  body: string;
  href: string;
  tone: "brand" | "amber" | "rose" | "violet";
}

export function deriveWorkspaceProgress({
  domain,
  records,
  counts,
  jobs,
  sourceCount,
  coreCompleteness,
}: {
  domain: Domain;
  records: any[];
  counts: CountByStatus;
  jobs: JobSnapshot[];
  sourceCount: number;
  coreCompleteness: (record: any) => { complete: boolean; missing: string[] };
}): WorkspaceProgress {
  const review = { ready: 0, incomplete: 0, mockLocked: 0 };
  for (const record of records) {
    if (record.status !== "review") continue;
    if (record.extraction?.source === "mock") review.mockLocked += 1;
    else if (coreCompleteness(record).complete) review.ready += 1;
    else review.incomplete += 1;
  }

  const jobBuckets = {
    total: jobs.length,
    queued: 0,
    extracting: 0,
    done: 0,
    error: 0,
    committed: 0,
    doneCandidates: 0,
  };
  for (const job of jobs) {
    jobBuckets[job.status] += 1;
    if (job.status === "done") jobBuckets.doneCandidates += job.recordCount;
  }

  const dataset = buildDataset(domain, records, {
    includeReview: domain !== "tribology",
    nanoOnly: domain === "tribology",
  });
  const usable = dataset.points.length;

  return {
    domain,
    sourceCount,
    recordCount: records.length,
    counts,
    review,
    jobs: jobBuckets,
    design: {
      usable,
      gate: CALIBRATION_GATE,
      gap: Math.max(0, CALIBRATION_GATE - usable),
      ready: usable >= CALIBRATION_GATE,
    },
  };
}

export function chooseNextAction(progress: WorkspaceProgress): NextAction {
  const { domain, jobs, review, design } = progress;
  if (jobs.error > 0) {
    return {
      key: "errors",
      eyebrow: "Extraction blocked",
      title: `Resolve ${jobs.error} failed job${jobs.error === 1 ? "" : "s"}`,
      body: "Open the extraction queue to read each failure reason before continuing.",
      href: `/${domain}/extract`,
      tone: "rose",
    };
  }
  if (jobs.queued + jobs.extracting > 0) {
    return {
      key: "active",
      eyebrow: "Extraction active",
      title: `${jobs.queued + jobs.extracting} job${jobs.queued + jobs.extracting === 1 ? " is" : "s are"} in progress`,
      body: `${jobs.queued} queued · ${jobs.extracting} extracting. Open the queue to monitor their actual states.`,
      href: `/${domain}/extract`,
      tone: "amber",
    };
  }
  if (jobs.done > 0) {
    return {
      key: "done",
      eyebrow: "Candidates ready",
      title: `Review ${jobs.doneCandidates} extracted candidate${jobs.doneCandidates === 1 ? "" : "s"}`,
      body: `${jobs.done} finished job${jobs.done === 1 ? " is" : "s are"} waiting for candidate selection and commit.`,
      href: `/${domain}/extract`,
      tone: "brand",
    };
  }
  if (review.ready > 0) {
    return {
      key: "ready-review",
      eyebrow: "Human review",
      title: `Approve ${review.ready} ready record${review.ready === 1 ? "" : "s"}`,
      body: "These non-mock records have complete core fields and can move into Checked now.",
      href: `/${domain}/database?status=review`,
      tone: "brand",
    };
  }
  if (review.incomplete > 0) {
    return {
      key: "incomplete-review",
      eyebrow: "Review blocked",
      title: `Complete ${review.incomplete} review record${review.incomplete === 1 ? "" : "s"}`,
      body: "These non-mock records are missing required core fields; edit them before approval.",
      href: `/${domain}/database?status=review`,
      tone: "amber",
    };
  }
  if (review.mockLocked > 0) {
    return {
      key: "mock-locked",
      eyebrow: "Publication locked",
      title: `Replace ${review.mockLocked} mock-only record${review.mockLocked === 1 ? "" : "s"}`,
      body: "Mock candidates stay review-only. Re-extract the source with a live provider before publishing.",
      href: `/${domain}/extract`,
      tone: "amber",
    };
  }
  if (!design.ready) {
    const noData = progress.recordCount === 0;
    return {
      key: "calibration",
      eyebrow: noData ? "No curated evidence yet" : "Design evidence gap",
      title: noData ? "Start extraction" : `Add ${design.gap} model-usable point${design.gap === 1 ? "" : "s"}`,
      body: noData
        ? `Design has ${design.usable} / ${design.gate} usable points. Add a paper and curate the first evidence point.`
        : `Design has ${design.usable} / ${design.gate} usable points. Model scope and exclusions can make this differ from the raw Checked count.`,
      href: `/${domain}/extract`,
      tone: "violet",
    };
  }
  return {
    key: "design-ready",
    eyebrow: "Calibration gate met",
    title: "Open Design Studio",
    body: `${design.usable} usable points meet the ${design.gate}-point gate; atlas coloring and candidate ranking are available.`,
    href: `/${domain}/design`,
    tone: "violet",
  };
}
