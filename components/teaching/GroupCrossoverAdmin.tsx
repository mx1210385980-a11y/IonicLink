"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RequestError, requestErrorMessage, requestJson } from "@/components/request";
import {
  TEACHING_FIELDS,
  type GroupCrossoverDashboard,
  type GroupCrossoverListItem,
  type TeachingFieldKey,
  type TeachingScore,
  type TeachingScores,
  type TeachingTeacherRound,
} from "@/lib/teachingShared";

// Mirrors CheckedRecordOption in lib/teaching/groupGold.ts (server-only module,
// so the shape is duplicated here for the client bundle).
type CheckedRecordOption = {
  recordId: string;
  title: string;
  doi: string;
  journal: string;
  cation: string;
  anion: string;
  substrate: string;
  temperatureRaw: string;
  loadRaw: string;
  cof: number;
};

type ImportResult = {
  added: number;
  updated: number;
  rejected: Array<{ line: number; studentName: string; reason: string }>;
};

const SEQUENCE_LABELS = {
  manual_then_ai: "人工→AI",
  ai_then_manual: "AI→人工",
} as const;

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function parseRosterLines(text: string): Array<{ studentName: string; groupNo: number }> {
  const entries: Array<{ studentName: string; groupNo: number }> = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const commaParts = line.split(/[,，]/).map((part) => part.trim()).filter(Boolean);
    let name = "";
    let groupText = "";
    if (commaParts.length >= 2) {
      name = commaParts.slice(0, -1).join(" ");
      groupText = commaParts[commaParts.length - 1];
    } else {
      const spaceParts = line.split(/\s+/).filter(Boolean);
      if (spaceParts.length >= 2) {
        name = spaceParts.slice(0, -1).join(" ");
        groupText = spaceParts[spaceParts.length - 1];
      }
    }
    const groupNo = Number(groupText);
    if (name && Number.isInteger(groupNo)) entries.push({ studentName: name, groupNo });
  }
  return entries;
}

export function GroupCrossoverAdmin() {
  const [experiments, setExperiments] = useState<GroupCrossoverListItem[]>([]);
  const [records, setRecords] = useState<CheckedRecordOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [dashboard, setDashboard] = useState<GroupCrossoverDashboard | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // create form
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [groupCount, setGroupCount] = useState("10");
  const [picked, setPicked] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  // roster import
  const [rosterText, setRosterText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // review
  const [reviewParticipantId, setReviewParticipantId] = useState<string | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, TeachingScores>>({});
  const [savingReview, setSavingReview] = useState(false);

  const loadList = useCallback(async () => {
    const result = await requestJson<{ experiments: GroupCrossoverListItem[] }>(
      "/api/teaching/admin/group?action=list",
      { cache: "no-store" },
      "加载分组实验列表失败"
    );
    setExperiments(result.experiments);
    return result.experiments;
  }, []);

  const loadDashboard = useCallback(async (projectId: string) => {
    const result = await requestJson<GroupCrossoverDashboard>(
      `/api/teaching/admin/group?action=dashboard&projectId=${encodeURIComponent(projectId)}`,
      { cache: "no-store" },
      "加载分组实验看板失败"
    );
    setDashboard(result);
  }, []);

  useEffect(() => {
    loadList()
      .then((list) => {
        if (list.length > 0) {
          setSelectedId(list[0].id);
          return loadDashboard(list[0].id);
        }
      })
      .catch((cause) => setError(requestErrorMessage(cause, "加载分组实验失败。")));
    requestJson<{ records: CheckedRecordOption[] }>(
      "/api/teaching/admin/group?action=checkedRecords",
      { cache: "no-store" },
      "加载文献池失败"
    )
      .then((result) => setRecords(result.records))
      .catch((cause) => setError(requestErrorMessage(cause, "加载文献池失败。")));
  }, [loadList, loadDashboard]);

  const selectExperiment = (projectId: string) => {
    setSelectedId(projectId);
    setReviewParticipantId(null);
    setImportResult(null);
    setError("");
    loadDashboard(projectId).catch((cause) =>
      setError(requestErrorMessage(cause, "加载分组实验看板失败。"))
    );
  };

  const expectedCount = Number(groupCount);

  const togglePick = (recordId: string) => {
    setPicked((current) =>
      current.includes(recordId)
        ? current.filter((id) => id !== recordId)
        : [...current, recordId]
    );
  };

  const createExperiment = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{ projectId: string }>(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "create",
            name,
            inviteCode,
            groupCount: expectedCount,
            recordIds: picked,
          }),
        },
        "创建分组实验失败"
      );
      setNotice("实验创建成功，请继续导入学生名单。");
      setName("");
      setInviteCode("");
      setPicked([]);
      await loadList();
      selectExperiment(result.projectId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "创建分组实验失败。"));
    } finally {
      setCreating(false);
    }
  };

  const importRoster = async () => {
    if (importing || !selectedId) return;
    const entries = parseRosterLines(rosterText);
    if (entries.length === 0) {
      setError("未解析到有效名单行，请使用“姓名,组号”逐行填写。");
      return;
    }
    setImporting(true);
    setError("");
    try {
      const result = await requestJson<ImportResult>(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "importRoster", projectId: selectedId, entries }),
        },
        "导入名单失败"
      );
      setImportResult(result);
      setRosterText("");
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "导入名单失败。"));
    } finally {
      setImporting(false);
    }
  };

  const removeRosterEntry = async (rosterId: string) => {
    setError("");
    try {
      await requestJson(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "deleteRosterEntry", projectId: selectedId, rosterId }),
        },
        "删除名单行失败"
      );
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "删除名单行失败。"));
    }
  };

  const reviewParticipant = useMemo(
    () => dashboard?.participants.find((row) => row.participantId === reviewParticipantId) ?? null,
    [dashboard, reviewParticipantId]
  );

  const reviewRounds = useMemo(() => {
    if (!reviewParticipant) return [];
    return [reviewParticipant.manual, reviewParticipant.aiAssisted].filter(
      (round): round is TeachingTeacherRound => round !== null
    );
  }, [reviewParticipant]);

  const openReview = (participantId: string) => {
    setReviewParticipantId(participantId);
    const participant = dashboard?.participants.find((row) => row.participantId === participantId);
    const drafts: Record<string, TeachingScores> = {};
    for (const round of [participant?.manual, participant?.aiAssisted]) {
      if (!round) continue;
      const scores: TeachingScores = {};
      for (const field of TEACHING_FIELDS) {
        scores[field.key] = round.review?.finalValueScores[field.key] ?? "pending";
      }
      drafts[round.submissionId] = scores;
    }
    setReviewDrafts(drafts);
  };

  const setReviewScore = (submissionId: string, field: TeachingFieldKey, score: TeachingScore) => {
    setReviewDrafts((current) => ({
      ...current,
      [submissionId]: { ...current[submissionId], [field]: score },
    }));
  };

  const saveReview = async (submissionId: string) => {
    if (savingReview) return;
    setSavingReview(true);
    setError("");
    try {
      await requestJson(
        "/api/teaching/admin/group",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "review",
            submissionId,
            humanScores: reviewDrafts[submissionId] ?? {},
          }),
        },
        "保存复核失败"
      );
      setNotice("复核已保存，统计以复核分数为准。");
      await loadDashboard(selectedId);
    } catch (cause) {
      setError(requestErrorMessage(cause, "保存复核失败。"));
    } finally {
      setSavingReview(false);
    }
  };

  const summary = dashboard?.summary ?? null;

  return (
    <section lang="zh-CN" aria-labelledby="group-crossover-title" className="mt-10 border-t border-ink-200 pt-8">
      <p className="label-eyebrow text-brand-700">Group crossover</p>
      <h2 id="group-crossover-title" className="mt-2 text-2xl font-semibold tracking-tight text-ink-950">
        分组交叉实验
      </h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-600">
        学生按名单落入预分配小组；相邻两小组配成大组，组内交换文献并翻转提取方式（奇数组先 AI 后人工，偶数组先人工后 AI）。
      </p>

      {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}
      {notice ? (
        <p className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {notice}
        </p>
      ) : null}

      {/* 创建实验 */}
      <div className="mt-6 rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
        <h3 className="text-lg font-semibold text-ink-950">创建实验</h3>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">实验名称</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder="例如：2026 春季摩擦学实验"
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">实验代码（学生凭此加入）</span>
            <input
              type="text"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              maxLength={40}
              placeholder="至少 4 位，如 TRIBO-2026"
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-ink-800">小组数（偶数，2–40）</span>
            <input
              type="number"
              value={groupCount}
              onChange={(event) => setGroupCount(event.target.value)}
              min={2}
              max={40}
              step={2}
              className="min-h-10 w-full rounded-[8px] border border-ink-300 px-3 text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
          </label>
        </div>
        <p className="mt-4 text-xs leading-5 text-ink-600">
          从已通过审核的记录中勾选 <strong className="text-ink-900">{Number.isFinite(expectedCount) ? expectedCount : "N"}</strong> 条
          （已选 <strong className={picked.length === expectedCount ? "text-emerald-700" : "text-brand-700"}>{picked.length}</strong> 条）。
          勾选顺序即分配顺序：第 1 条分给第 1 组，第 2 条分给第 2 组，依此类推。注意：一条记录代表一个工况条件点，同一篇论文可能有多条记录。
        </p>
        <div className="mt-3 max-h-72 overflow-y-auto rounded-[8px] border border-ink-200">
          {records.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-500">暂无可用的已审核记录。</p>
          ) : (
            <ul className="divide-y divide-ink-100">
              {records.map((record) => {
                const order = picked.indexOf(record.recordId);
                return (
                  <li key={record.recordId}>
                    <label className="flex cursor-pointer items-start gap-3 px-4 py-2.5 hover:bg-ink-50">
                      <input
                        type="checkbox"
                        checked={order >= 0}
                        onChange={() => togglePick(record.recordId)}
                        className="mt-1"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink-900">
                          {order >= 0 && (
                            <span className="mr-2 rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-brand-800">
                              第 {order + 1} 组
                            </span>
                          )}
                          {record.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-500">
                          {record.cation} / {record.anion} · {record.substrate} · {record.temperatureRaw} · {record.loadRaw} · COF {record.cof}
                          {record.journal ? ` · ${record.journal}` : ""}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <button
          type="button"
          onClick={() => void createExperiment()}
          disabled={creating || picked.length !== expectedCount || !name.trim() || inviteCode.trim().length < 4}
          className="btn-primary mt-4 min-h-10 px-5"
        >
          {creating ? "创建中…" : "创建实验"}
        </button>
      </div>

      {/* 实验列表 */}
      {experiments.length > 0 && (
        <div className="mt-6 rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
          <h3 className="text-lg font-semibold text-ink-950">已有实验</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs text-ink-500">
                  <th className="py-2 pr-4 font-medium">名称</th>
                  <th className="py-2 pr-4 font-medium">实验代码</th>
                  <th className="py-2 pr-4 font-medium">组数</th>
                  <th className="py-2 pr-4 font-medium">名单</th>
                  <th className="py-2 pr-4 font-medium">已加入</th>
                  <th className="py-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {experiments.map((experiment) => (
                  <tr key={experiment.id} className={experiment.id === selectedId ? "bg-brand-50/60" : ""}>
                    <td className="py-2.5 pr-4 font-medium text-ink-900">{experiment.name}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs">{experiment.inviteCode}</td>
                    <td className="py-2.5 pr-4">{experiment.groupCount}</td>
                    <td className="py-2.5 pr-4">{experiment.rosterCount}</td>
                    <td className="py-2.5 pr-4">{experiment.participantCount}</td>
                    <td className="py-2.5">
                      <button
                        type="button"
                        onClick={() => selectExperiment(experiment.id)}
                        className="btn min-h-8 px-3 text-xs"
                      >
                        {experiment.id === selectedId ? "当前" : "查看"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dashboard && (
        <>
          {/* 名单导入 */}
          <div className="mt-6 rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
            <h3 className="text-lg font-semibold text-ink-950">
              学生名单 <span className="ml-2 text-sm font-normal text-ink-500">{dashboard.experiment.name}（代码 {dashboard.experiment.inviteCode}）</span>
            </h3>
            <p className="mt-1 text-xs leading-5 text-ink-600">
              逐行填写“姓名/学号,组号”（逗号或空白分隔均可），组号范围 1–{dashboard.experiment.groupCount}。已加入实验的学生行不可修改或删除。
            </p>
            <textarea
              value={rosterText}
              onChange={(event) => setRosterText(event.target.value)}
              rows={5}
              placeholder={"张三,1\n李四,1\n王五,2"}
              className="mt-3 w-full rounded-[8px] border border-ink-300 px-3 py-2 font-mono text-sm outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-100"
            />
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={() => void importRoster()}
                disabled={importing || rosterText.trim().length === 0}
                className="btn-primary min-h-10 px-5"
              >
                {importing ? "导入中…" : "导入名单"}
              </button>
              {importResult && (
                <p className="text-sm text-ink-700">
                  新增 {importResult.added} · 更新 {importResult.updated} · 拒绝 {importResult.rejected.length}
                </p>
              )}
            </div>
            {importResult && importResult.rejected.length > 0 && (
              <ul className="mt-3 space-y-1 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
                {importResult.rejected.map((item) => (
                  <li key={item.line}>
                    第 {item.line} 行「{item.studentName || "（空）"}」：{item.reason}
                  </li>
                ))}
              </ul>
            )}
            {dashboard.roster.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-[8px] border border-ink-200">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-ink-50">
                    <tr className="border-b border-ink-200 text-xs text-ink-500">
                      <th className="px-3 py-2 font-medium">姓名/学号</th>
                      <th className="px-3 py-2 font-medium">组号</th>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {dashboard.roster.map((entry) => (
                      <tr key={entry.id}>
                        <td className="px-3 py-2 text-ink-900">{entry.studentName}</td>
                        <td className="px-3 py-2">第 {entry.groupNo} 组</td>
                        <td className="px-3 py-2">
                          {entry.claimed ? (
                            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800">已加入</span>
                          ) : (
                            <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-600">未加入</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {!entry.claimed && (
                            <button
                              type="button"
                              onClick={() => void removeRosterEntry(entry.id)}
                              className="text-xs text-red-600 hover:underline"
                            >
                              删除
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* 看板 */}
          <div className="mt-6 rounded-[12px] border border-ink-200 bg-white p-5 shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-lg font-semibold text-ink-950">实验看板</h3>
              <div className="flex gap-2">
                <a
                  href={`/api/teaching/admin/group/export?projectId=${encodeURIComponent(selectedId)}`}
                  className="btn min-h-9 px-3 text-xs"
                >
                  导出 CSV
                </a>
                <a
                  href={`/api/teaching/admin/group/export?projectId=${encodeURIComponent(selectedId)}&anonymize=1`}
                  className="btn min-h-9 px-3 text-xs"
                >
                  匿名导出
                </a>
                <button
                  type="button"
                  onClick={() => void loadDashboard(selectedId)}
                  className="btn min-h-9 px-3 text-xs"
                >
                  刷新
                </button>
              </div>
            </div>

            {summary && (
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <StatCard label="已加入 / 完成" value={`${summary.completion.total} / ${summary.completion.completed}`} />
                <StatCard label="可配对分析" value={String(summary.completion.paired)} />
                <StatCard label="人工中位准确率" value={percent(summary.manual.medianAccuracy)} />
                <StatCard label="AI 辅助中位准确率" value={percent(summary.aiAssisted.medianAccuracy)} />
              </div>
            )}

            {/* 小组进度 */}
            <h4 className="mt-6 text-sm font-semibold text-ink-900">小组进度</h4>
            <div className="mt-2 overflow-x-auto rounded-[8px] border border-ink-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">组号</th>
                    <th className="px-3 py-2 font-medium">大组</th>
                    <th className="px-3 py-2 font-medium">提取顺序</th>
                    <th className="px-3 py-2 font-medium">分配文献</th>
                    <th className="px-3 py-2 font-medium">名单 / 加入 / 完成</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {dashboard.groupProgress.map((group) => (
                    <tr key={group.groupNo}>
                      <td className="px-3 py-2 font-medium text-ink-900">第 {group.groupNo} 组</td>
                      <td className="px-3 py-2">第 {Math.ceil(group.groupNo / 2)} 大组</td>
                      <td className="px-3 py-2 text-xs">
                        {group.groupNo % 2 === 1 ? "AI → 人工" : "人工 → AI"}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-xs" title={group.paperTitle}>
                        {group.paperTitle}
                      </td>
                      <td className="px-3 py-2">
                        {group.rosterSize} / {group.joined} / {group.completed}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 按组诊断 */}
            <h4 className="mt-6 text-sm font-semibold text-ink-900">按组诊断（复核分数优先生效）</h4>
            <div className="mt-2 overflow-x-auto rounded-[8px] border border-ink-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">组号</th>
                    <th className="px-3 py-2 font-medium">完成 / 配对</th>
                    <th className="px-3 py-2 font-medium">人工中位准确率</th>
                    <th className="px-3 py-2 font-medium">AI 中位准确率</th>
                    <th className="px-3 py-2 font-medium">人工中位活跃时间</th>
                    <th className="px-3 py-2 font-medium">AI 中位活跃时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {Object.entries(dashboard.diagnostics.byGroup)
                    .sort(([a], [b]) => Number(a) - Number(b))
                    .map(([groupNo, diag]) => (
                      <tr key={groupNo}>
                        <td className="px-3 py-2 font-medium text-ink-900">第 {groupNo} 组</td>
                        <td className="px-3 py-2">{diag.completed} / {diag.paired}</td>
                        <td className="px-3 py-2">{percent(diag.manual.medianAccuracy)}</td>
                        <td className="px-3 py-2">{percent(diag.aiAssisted.medianAccuracy)}</td>
                        <td className="px-3 py-2">
                          {diag.manual.medianActiveSeconds === null ? "—" : `${Math.round(diag.manual.medianActiveSeconds)}s`}
                        </td>
                        <td className="px-3 py-2">
                          {diag.aiAssisted.medianActiveSeconds === null ? "—" : `${Math.round(diag.aiAssisted.medianActiveSeconds)}s`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>

            {/* 学生列表 + 复核 */}
            <h4 className="mt-6 text-sm font-semibold text-ink-900">学生结果与复核</h4>
            <div className="mt-2 overflow-x-auto rounded-[8px] border border-ink-200">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-ink-200 bg-ink-50 text-xs text-ink-500">
                    <th className="px-3 py-2 font-medium">学生</th>
                    <th className="px-3 py-2 font-medium">顺序</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">人工（文献 / 正确数）</th>
                    <th className="px-3 py-2 font-medium">AI（文献 / 正确数）</th>
                    <th className="px-3 py-2 font-medium">复核</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {dashboard.participants.map((participant) => (
                    <tr key={participant.participantId}>
                      <td className="px-3 py-2 font-medium text-ink-900">{participant.studentAlias}</td>
                      <td className="px-3 py-2 text-xs">{SEQUENCE_LABELS[participant.sequence]}</td>
                      <td className="px-3 py-2 text-xs">
                        {participant.quality.completion === "completed" ? "已完成" : "进行中"}
                        {participant.quality.excluded && <span className="ml-1 text-red-600">已排除</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {participant.manual
                          ? `${participant.manual.paperCode} / ${participant.manual.score.valueCorrect}/6`
                          : "—"}
                        {participant.manual?.review && <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] text-brand-800">已复核</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {participant.aiAssisted
                          ? `${participant.aiAssisted.paperCode} / ${participant.aiAssisted.score.valueCorrect}/6`
                          : "—"}
                        {participant.aiAssisted?.review && <span className="ml-1 rounded bg-brand-100 px-1 text-[10px] text-brand-800">已复核</span>}
                      </td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => openReview(participant.participantId)}
                          className="btn min-h-8 px-3 text-xs"
                        >
                          复核改分
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {reviewParticipant && (
              <div className="mt-4 rounded-[8px] border border-brand-200 bg-brand-50/40 p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-ink-950">
                    复核：{reviewParticipant.studentAlias}
                  </h4>
                  <button
                    type="button"
                    onClick={() => setReviewParticipantId(null)}
                    className="text-xs text-ink-500 hover:underline"
                  >
                    收起
                  </button>
                </div>
                <p className="mt-1 text-xs text-ink-600">
                  “待定”表示维持自动评分；改为“正确/错误”后以复核结果重新统计。
                </p>
                {reviewRounds.map((round) => (
                  <div key={round.submissionId} className="mt-4 rounded-[8px] border border-ink-200 bg-white p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink-900">
                        {round.mode === "manual" ? "人工轮" : "AI 辅助轮"} · 文献 {round.paperCode} · 自动 {round.score.valueCorrect}/6
                        {round.review && (
                          <span className="ml-2 rounded bg-brand-100 px-1.5 py-0.5 text-[10px] text-brand-800">
                            已复核 {new Date(round.review.reviewedAt).toLocaleString("zh-CN")}
                          </span>
                        )}
                      </p>
                      <button
                        type="button"
                        onClick={() => void saveReview(round.submissionId)}
                        disabled={savingReview}
                        className="btn-primary min-h-9 px-4 text-xs"
                      >
                        {savingReview ? "保存中…" : "保存本轮复核"}
                      </button>
                    </div>
                    <div className="mt-3 space-y-2">
                      {TEACHING_FIELDS.map((field) => {
                        const auto = round.score.values[field.key];
                        const answer = round.finalAnswers[field.key];
                        const draft = reviewDrafts[round.submissionId]?.[field.key] ?? "pending";
                        return (
                          <div
                            key={field.key}
                            className="flex flex-wrap items-center gap-3 rounded-[6px] border border-ink-100 px-3 py-2"
                          >
                            <span className="w-24 text-xs font-semibold text-ink-800">{field.label}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-ink-600" title={answer?.value ?? ""}>
                              {answer?.value || <em className="text-ink-400">未填写</em>}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                auto?.correct
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              自动：{auto?.correct ? "对" : "错"}
                            </span>
                            <span className="flex rounded-[6px] border border-ink-200 bg-ink-50 p-0.5" role="group" aria-label={`${field.label} 复核`}>
                              {(
                                [
                                  ["correct", "正确"],
                                  ["incorrect", "错误"],
                                  ["pending", "待定"],
                                ] as Array<[TeachingScore, string]>
                              ).map(([score, label]) => (
                                <button
                                  key={score}
                                  type="button"
                                  aria-pressed={draft === score}
                                  onClick={() => setReviewScore(round.submissionId, field.key, score)}
                                  className={`min-h-7 rounded-[5px] px-2.5 text-xs transition ${
                                    draft === score
                                      ? score === "correct"
                                        ? "bg-emerald-600 text-white"
                                        : score === "incorrect"
                                          ? "bg-red-600 text-white"
                                          : "bg-white text-ink-900 shadow-sm"
                                      : "text-ink-500 hover:text-ink-900"
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-ink-200 bg-ink-50 px-4 py-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink-950">{value}</p>
    </div>
  );
}
