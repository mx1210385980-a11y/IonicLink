import { simpleGroupAssignment } from "./simpleShared";
import type { SimpleDashboard, SimplePaperTask, SimpleRow, SimpleStudent } from "./simpleShared";
import { scoreSimpleRows } from "./simpleScoring";

/** Synthetic, read-only teaching data. This module never accesses classroom storage. */
export function simpleExampleDashboard(): SimpleDashboard {
  const experimentId = "example-experiment";
  const createdAt = "2026-09-20T08:00:00.000Z";
  const gold: SimpleRow[] = [
    { cation: "EMIM", anion: "BF4", substrate: "mica", temperature: "25 C", load: "5 nN", cof: "0.10" },
    { cation: "EMIM", anion: "BF4", substrate: "mica", temperature: "25 C", load: "10 nN", cof: "0.12" },
  ];
  const tasks: SimplePaperTask[] = [
    { id: "paper-a", paperNo: 1, experimentId, sourceId: "example-source-a", paperTitle: "Example A — Mica surfaces", fingerprint: "paper-a", gold, version: 1, createdAt },
    { id: "paper-b", paperNo: 2, experimentId, sourceId: "example-source-b", paperTitle: "Example B — Steel surfaces", fingerprint: "paper-b", gold: gold.map(row => ({ ...row, substrate: "steel" })), version: 1, createdAt },
    { id: "paper-c", paperNo: 3, experimentId, sourceId: "example-source-c", paperTitle: "Example C — Silica surfaces", fingerprint: "paper-c", gold: gold.map(row => ({ ...row, substrate: "silica" })), version: 1, createdAt },
    { id: "paper-d", paperNo: 4, experimentId, sourceId: "example-source-d", paperTitle: "Example D — Gold surfaces", fingerprint: "paper-d", gold: gold.map(row => ({ ...row, substrate: "gold" })), version: 1, createdAt },
  ];
  function submission(task: SimplePaperTask, alias: string, groupNo: number, roundNo: number, mode: "ai" | "manual", wrongFields: number, minutes: number): SimpleStudent {
    const rows = task.gold.map(row => ({ ...row }));
    // Deliberate mismatches make the scores independently reproducible: 12 fields total.
    if (wrongFields >= 1) rows[0].cof = "0.90";
    if (wrongFields >= 2) rows[1].cof = "0.91";
    if (wrongFields >= 3) rows[0].load = "500 nN";
    const startedAt = new Date(Date.parse(createdAt) + (roundNo - 1) * 3600_000).toISOString();
    const submittedAt = new Date(Date.parse(startedAt) + minutes * 60_000).toISOString();
    return {
      id: `${alias}-r${roundNo}`, learnerId: `example-${alias}`, groupNo, roundNo, paperNo: task.paperNo, experimentId, taskId: task.id, studentAlias: alias, resumeCode: "example-only", mode, status: "submitted", rows,
      paper: { sourceId: task.sourceId, paperTitle: task.paperTitle, gold: [] }, version: 1,
      startedAt: mode === "ai" ? startedAt : null, extractionAttemptAt: mode === "ai" ? startedAt : null,
      extractedAt: mode === "ai" ? new Date(Date.parse(startedAt) + 60_000).toISOString() : null,
      submittedAt, elapsedSeconds: minutes * 60, error: null, score: scoreSimpleRows(task.gold, rows),
      overrides: {}, reviewNote: "", reviewedAt: null,
    };
  }
  return {
    experiment: { id: experimentId, design: "crossover", name: "Example classroom — Simulated data", sourceId: "", paperTitle: "", gold: [], aiInviteCode: "", manualInviteCode: "", createdAt },
    tasks,
    students: [1, 2, 3, 4].flatMap(groupNo => [1, 2].flatMap(index => [1, 2].map(roundNo => {
      const { paperNo, mode } = simpleGroupAssignment(groupNo, roundNo);
      const wrongFields = mode === "ai" ? (paperNo === 2 && index === 1 ? 0 : index) : paperNo === 1 ? index + 1 : 1;
      const durations = [[6, 8, 18, 22], [8, 10, 24, 30], [7, 9, 20, 24], [9, 11, 26, 30]];
      return submission(tasks[paperNo - 1], `G${groupNo}-0${index}`, groupNo, roundNo, mode, wrongFields, durations[paperNo - 1][(mode === "ai" ? 0 : 2) + index - 1]);
    }))),
  };
}
