import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import rawConfig from "../../config/teaching/default-experiment.v1.json";
import { TEACHING_FIELDS, type TeachingExperimentConfig } from "../teachingShared";
import { getTeachingDb } from "./store";

export const DEFAULT_EXPERIMENT = rawConfig as unknown as TeachingExperimentConfig;
const DEFAULT_PROJECT_ID = DEFAULT_EXPERIMENT.id;
const DEFAULT_INVITE = "AUTO-CROSSOVER-2026-V1";

export function validateExperimentConfig(config: TeachingExperimentConfig): string[] {
  const errors: string[] = [];
  if (!config.id.trim()) errors.push("experiment id is required");
  if (config.papers.length !== 2) errors.push("exactly two papers are required");
  const keys = TEACHING_FIELDS.map((field) => field.key);
  for (const paper of config.papers) {
    if (!/^https:\/\//.test(paper.sourceUrl)) errors.push(`paper ${paper.code} requires an HTTPS source URL`);
    if (!paper.taskPrompt.trim()) errors.push(`paper ${paper.code} requires a task prompt`);
    for (const key of keys) {
      if (!paper.aiInitial[key]) errors.push(`paper ${paper.code} is missing AI field ${key}`);
      if (!paper.gold[key]) errors.push(`paper ${paper.code} is missing gold field ${key}`);
    }
  }
  return errors;
}

export function defaultExperimentChecksum(): string {
  return createHash("sha256").update(JSON.stringify(DEFAULT_EXPERIMENT)).digest("hex");
}

interface StoredDefaultProject {
  name: string;
  domain: string;
  inviteCode: string;
  status: string;
  fieldsJson: string;
  experimentKind: string;
  configVersion: string | null;
  configChecksum: string | null;
  isDefault: number;
}

interface StoredDefaultPaper {
  id: string;
  paperNo: string;
  title: string;
  doi: string | null;
  journal: string | null;
  sourceUrl: string | null;
  sourceRecordId: string | null;
  aiSnapshotJson: string;
  aiModel: string | null;
  aiExtractedAt: string | null;
  taskPrompt: string;
  goldSnapshotJson: string;
  scoringRulesJson: string;
  configVersion: string | null;
}

export function hasCurrentDefaultTeachingExperiment(store?: Database.Database): boolean {
  const target = store ?? getTeachingDb();
  const project = target
    .prepare(
      `SELECT name, domain, invite_code AS inviteCode, status, fields_json AS fieldsJson,
              experiment_kind AS experimentKind, config_version AS configVersion,
              config_checksum AS configChecksum, is_default AS isDefault
       FROM teaching_projects WHERE id = ?`
    )
    .get(DEFAULT_PROJECT_ID) as StoredDefaultProject | undefined;
  if (
    !project ||
    project.name !== DEFAULT_EXPERIMENT.name ||
    project.domain !== "tribology" ||
    project.inviteCode !== DEFAULT_INVITE ||
    project.status !== "open" ||
    project.fieldsJson !== JSON.stringify(DEFAULT_EXPERIMENT.fields) ||
    project.experimentKind !== "crossover" ||
    project.configVersion !== DEFAULT_EXPERIMENT.version ||
    project.configChecksum !== defaultExperimentChecksum() ||
    project.isDefault !== 1
  ) {
    return false;
  }

  const papers = target
    .prepare(
      `SELECT id, paper_no AS paperNo, title, doi, journal, source_url AS sourceUrl,
              source_record_id AS sourceRecordId, ai_snapshot_json AS aiSnapshotJson,
              ai_model AS aiModel, ai_extracted_at AS aiExtractedAt,
              task_prompt AS taskPrompt, gold_snapshot_json AS goldSnapshotJson,
              scoring_rules_json AS scoringRulesJson, config_version AS configVersion
       FROM teaching_papers WHERE project_id = ? ORDER BY paper_no ASC, id ASC`
    )
    .all(DEFAULT_PROJECT_ID) as StoredDefaultPaper[];
  if (papers.length !== DEFAULT_EXPERIMENT.papers.length) return false;

  return DEFAULT_EXPERIMENT.papers.every((expectedPaper) => {
    const paper = papers.find((candidate) => candidate.id === expectedPaper.id);
    const goldValues = Object.fromEntries(
      Object.entries(expectedPaper.gold).map(([key, rule]) => [key, rule.value])
    );
    return (
      paper !== undefined &&
      paper.paperNo === expectedPaper.code &&
      paper.title === expectedPaper.title &&
      paper.doi === expectedPaper.doi &&
      paper.journal === expectedPaper.journal &&
      paper.sourceUrl === expectedPaper.sourceUrl &&
      paper.sourceRecordId === null &&
      paper.aiSnapshotJson === JSON.stringify(expectedPaper.aiInitial) &&
      paper.aiModel === expectedPaper.aiModel &&
      paper.aiExtractedAt === null &&
      paper.taskPrompt === expectedPaper.taskPrompt &&
      paper.goldSnapshotJson === JSON.stringify(goldValues) &&
      paper.scoringRulesJson === JSON.stringify(expectedPaper.gold) &&
      paper.configVersion === DEFAULT_EXPERIMENT.version
    );
  });
}

export function ensureDefaultTeachingExperiment(store?: Database.Database): void {
  const validationErrors = validateExperimentConfig(DEFAULT_EXPERIMENT);
  if (validationErrors.length) {
    throw new Error(`Invalid default teaching experiment config:\n${validationErrors.join("\n")}`);
  }
  const checksum = defaultExperimentChecksum();
  const target = store ?? getTeachingDb();
  const createdAt = new Date().toISOString();

  target.transaction(() => {
    const existing = target
      .prepare("SELECT config_checksum FROM teaching_projects WHERE id = ?")
      .get(DEFAULT_PROJECT_ID) as { config_checksum: string | null } | undefined;
    if (existing?.config_checksum !== checksum) {
      const participantCount = Number(
        target
          .prepare("SELECT COUNT(*) FROM teaching_participants WHERE project_id = ?")
          .pluck()
          .get(DEFAULT_PROJECT_ID)
      );
      if (participantCount > 0) {
        throw new Error("Default teaching experiment checksum drift detected after participation began.");
      }
    }

    const expectedPaperIds = DEFAULT_EXPERIMENT.papers.map((paper) => paper.id);
    const expectedPaperPlaceholders = expectedPaperIds.map(() => "?").join(", ");
    const unexpectedPapers = target
      .prepare(
        `SELECT p.id,
                EXISTS(
                  SELECT 1 FROM teaching_participants pt WHERE pt.assigned_paper_id = p.id
                ) AS hasParticipant,
                EXISTS(
                  SELECT 1 FROM teaching_submissions s WHERE s.paper_id = p.id
                ) AS hasSubmission
         FROM teaching_papers p
         WHERE p.project_id = ? AND p.id NOT IN (${expectedPaperPlaceholders})`
      )
      .all(DEFAULT_PROJECT_ID, ...expectedPaperIds) as Array<{
      id: string;
      hasParticipant: number;
      hasSubmission: number;
    }>;
    const linkedUnexpectedPaper = unexpectedPapers.find(
      (paper) => paper.hasParticipant === 1 || paper.hasSubmission === 1
    );
    if (linkedUnexpectedPaper) {
      throw new Error(
        `Default teaching experiment has an unexpected paper linked to participant data: ${linkedUnexpectedPaper.id}`
      );
    }
    const deleteUnexpectedPaper = target.prepare(
      "DELETE FROM teaching_papers WHERE id = ? AND project_id = ?"
    );
    for (const paper of unexpectedPapers) {
      deleteUnexpectedPaper.run(paper.id, DEFAULT_PROJECT_ID);
    }

    target
      .prepare(
        `INSERT INTO teaching_projects
         (id, name, domain, invite_code, status, fields_json, created_at,
          experiment_kind, config_version, config_checksum, is_default)
         VALUES (?, ?, 'tribology', ?, 'open', ?, ?, 'crossover', ?, ?, 1)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           domain = excluded.domain,
           invite_code = excluded.invite_code,
           status = excluded.status,
           fields_json = excluded.fields_json,
           experiment_kind = excluded.experiment_kind,
           config_version = excluded.config_version,
           config_checksum = excluded.config_checksum,
           is_default = excluded.is_default`
      )
      .run(
        DEFAULT_PROJECT_ID,
        DEFAULT_EXPERIMENT.name,
        DEFAULT_INVITE,
        JSON.stringify(DEFAULT_EXPERIMENT.fields),
        createdAt,
        DEFAULT_EXPERIMENT.version,
        checksum
      );

    const upsertPaper = target.prepare(
      `INSERT INTO teaching_papers
       (id, project_id, paper_no, title, doi, journal, source_url, source_record_id,
        ai_snapshot_json, ai_model, ai_extracted_at, created_at, task_prompt,
        gold_snapshot_json, scoring_rules_json, config_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         project_id = excluded.project_id,
         paper_no = excluded.paper_no,
         title = excluded.title,
         doi = excluded.doi,
         journal = excluded.journal,
         source_url = excluded.source_url,
         source_record_id = excluded.source_record_id,
         ai_snapshot_json = excluded.ai_snapshot_json,
         ai_model = excluded.ai_model,
         ai_extracted_at = excluded.ai_extracted_at,
         task_prompt = excluded.task_prompt,
         gold_snapshot_json = excluded.gold_snapshot_json,
         scoring_rules_json = excluded.scoring_rules_json,
         config_version = excluded.config_version`
    );

    for (const paper of DEFAULT_EXPERIMENT.papers) {
      const goldValues = Object.fromEntries(
        Object.entries(paper.gold).map(([key, rule]) => [key, rule.value])
      );
      upsertPaper.run(
        paper.id,
        DEFAULT_PROJECT_ID,
        paper.code,
        paper.title,
        paper.doi,
        paper.journal,
        paper.sourceUrl,
        JSON.stringify(paper.aiInitial),
        paper.aiModel,
        createdAt,
        paper.taskPrompt,
        JSON.stringify(goldValues),
        JSON.stringify(paper.gold),
        DEFAULT_EXPERIMENT.version
      );
    }
  })();
}
