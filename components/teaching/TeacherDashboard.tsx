"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  TeachingDashboardRow,
  TeachingScore,
  TeachingScores,
} from "@/lib/teachingShared";
import { TEACHING_FIELDS } from "@/lib/teachingShared";
import { requestErrorMessage, requestJson, RequestError } from "@/components/request";

type Dashboard = {
  configured: boolean;
  projects: Array<{ id: string; name: string; inviteCode: string; status: string; paperCount: number }>;
  selectedProjectId: string | null;
  papers: Array<{ id: string; paperNo: string; title: string; doi: string; journal: string }>;
  rows: TeachingDashboardRow[];
  summary: { submitted: number; total: number; pending: number; averageElapsedSeconds: number | null };
  officialRecords: Array<{
    id: string;
    title: string;
    doi: string;
    journal: string;
  }>;
};

export function TeacherDashboard({ initial }: { initial: Dashboard }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [paperFilter, setPaperFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<TeachingDashboardRow | null>(null);

  const load = async (projectId = data.selectedProjectId) => {
    const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
    const next = await requestJson<Dashboard>(
      `/api/teaching/admin${query}`,
      undefined,
      "刷新教师后台失败"
    );
    setData(next);
    if (selected) setSelected(next.rows.find((row) => row.submissionId === selected.submissionId) ?? null);
  };

  const mutate = async (payload: Record<string, unknown>, label: string) => {
    setBusy(label);
    setError("");
    try {
      await requestJson(
        "/api/teaching/admin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
        `${label}失败`
      );
      await load(payload.projectId as string | undefined);
      return true;
    } catch (cause) {
      setError(requestErrorMessage(cause, `${label}失败。`));
      return false;
    } finally {
      setBusy("");
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await mutate(
      {
        action: "create-project",
        name: form.get("name"),
        inviteCode: form.get("inviteCode"),
      },
      "新建项目"
    );
    if (ok) {
      formElement.reset();
      formElement.closest("details")?.removeAttribute("open");
    }
  };

  const addPaper = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const ok = await mutate(
      {
        action: "add-paper",
        projectId: data.selectedProjectId,
        recordId: form.get("recordId"),
        paperNo: form.get("paperNo"),
        sourceUrl: form.get("sourceUrl"),
      },
      "配置文献"
    );
    if (ok) {
      formElement.reset();
      formElement.closest("details")?.removeAttribute("open");
    }
  };

  const filteredRows = useMemo(
    () =>
      data.rows.filter(
        (row) =>
          (!groupFilter || row.groupCode === groupFilter) &&
          (!paperFilter || row.paperNo === paperFilter) &&
          (!statusFilter || row.status === statusFilter)
      ),
    [data.rows, groupFilter, paperFilter, statusFilter]
  );
  const groups = useMemo(
    () => [...new Set(data.rows.map((row) => row.groupCode))].sort(),
    [data.rows]
  );
  const availablePapers = useMemo(() => {
    const seen = new Set<string>();
    return data.officialRecords.filter((record) => {
      const key = (record.doi || record.title).trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [data.officialRecords]);

  return (
    <main className="mx-auto w-full max-w-[96rem] px-4 pb-12 pt-5 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink-950">AI 与人工提取对比</h1>
          <p className="mt-1 text-sm text-ink-600">查看学生填写结果，并与平台提取结果进行对比。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/api/teaching/admin/export${data.selectedProjectId ? `?project=${encodeURIComponent(data.selectedProjectId)}` : ""}`}
            className="btn"
          >
            导出 CSV
          </a>
          <button
            type="button"
            className="btn"
            onClick={async () => {
              await fetch("/api/teaching/session", { method: "DELETE" });
              window.location.assign("/teaching");
            }}
          >
            退出
          </button>
        </div>
      </header>

      <section className="mt-5 flex flex-wrap items-center gap-3 border-y border-ink-200 bg-white/70 px-3 py-3">
        <label className="flex min-w-[18rem] flex-1 items-center gap-3">
          <span className="shrink-0 text-xs font-semibold text-ink-600">课改项目</span>
          <select
            value={data.selectedProjectId ?? ""}
            onChange={(event) => void load(event.target.value)}
            className="min-h-10 min-w-0 flex-1 rounded-[8px] border border-ink-200 bg-white px-3 text-sm font-semibold text-ink-950 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          >
            {data.projects.length ? null : <option value="">尚未创建项目</option>}
            {data.projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · 邀请码 {project.inviteCode}
              </option>
            ))}
          </select>
        </label>

        <details className="relative">
          <summary className="btn cursor-pointer list-none">新建项目</summary>
          <form onSubmit={createProject} className="absolute right-0 z-20 mt-2 w-80 space-y-3 rounded-[10px] border border-ink-200 bg-white p-4 shadow-panel">
            <AdminField label="项目名称" name="name" placeholder="例如：纳米摩擦数据提取 · 2026 春" />
            <AdminField label="学生邀请码" name="inviteCode" placeholder="例如：TRIBO2026" />
            <button disabled={Boolean(busy)} className="btn-primary w-full justify-center" type="submit">创建项目</button>
          </form>
        </details>

        <details className="relative">
          <summary className={`btn list-none ${data.selectedProjectId ? "cursor-pointer" : "pointer-events-none opacity-50"}`}>
            配置文献{data.papers.length ? `（${data.papers.length}）` : ""}
          </summary>
          <form
            onSubmit={addPaper}
            className="fixed left-4 right-4 top-24 z-20 max-h-[calc(100vh-7rem)] space-y-3 overflow-y-auto rounded-[10px] border border-ink-200 bg-white p-4 shadow-panel sm:absolute sm:left-auto sm:right-0 sm:top-auto sm:mt-2 sm:max-h-none sm:w-[26rem] sm:overflow-visible"
          >
            <div>
              <h2 className="text-sm font-semibold text-ink-950">配置学生要填写的文献</h2>
              <p className="mt-1 text-xs leading-5 text-ink-500">设置编号并选择文献，然后添加到当前项目。</p>
            </div>
            {data.papers.length ? (
              <div className="rounded-[8px] border border-brand-100 bg-brand-50/60 p-3">
                <strong className="text-xs font-semibold text-brand-900">已配置 {data.papers.length} 篇文献</strong>
                <ul className="mt-2 max-h-24 space-y-1 overflow-y-auto text-xs text-ink-700">
                  {data.papers.map((paper) => (
                    <li key={paper.id} className="truncate" title={paper.title}>
                      <span className="font-mono font-semibold text-brand-800">{paper.paperNo}</span>
                      <span> · {paper.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <AdminField label="文献编号" name="paperNo" placeholder="例如：03" />
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-ink-700">选择文献</span>
              <select required name="recordId" className="min-h-11 w-full rounded-[8px] border border-ink-200 bg-white px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100">
                <option value="">请选择一篇文献</option>
                {availablePapers.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.title}{record.journal ? ` · ${record.journal}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <AdminField label="文献链接（选填）" name="sourceUrl" placeholder="https://doi.org/…" required={false} />
            <button disabled={Boolean(busy)} className="btn-primary w-full justify-center" type="submit">添加到项目</button>
          </form>
        </details>
      </section>

      <section className="mt-4 grid divide-y divide-ink-200 border-y border-ink-200 bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Summary label="已提交" value={`${data.summary.submitted} / ${data.summary.total}`} />
        <Summary label="待审核" value={String(data.summary.pending)} tone="amber" />
        <Summary label="平均人工用时" value={formatDuration(data.summary.averageElapsedSeconds)} />
      </section>

      {error ? <div className="mt-4"><RequestError>{error}</RequestError></div> : null}

      <section className="mt-5 overflow-hidden rounded-[10px] border border-ink-200 bg-white shadow-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-ink-200 px-3 py-3">
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="filter-select" aria-label="按组别筛选">
            <option value="">全部组别</option>
            {groups.map((group) => <option key={group}>{group}</option>)}
          </select>
          <select value={paperFilter} onChange={(event) => setPaperFilter(event.target.value)} className="filter-select" aria-label="按文献筛选">
            <option value="">全部文献</option>
            {data.papers.map((paper) => <option key={paper.id} value={paper.paperNo}>文献 {paper.paperNo}</option>)}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="filter-select" aria-label="按状态筛选">
            <option value="">全部状态</option>
            <option value="draft">填写中</option>
            <option value="pending">待审核</option>
            <option value="reviewed">已完成</option>
          </select>
          <span className="ml-auto text-xs text-ink-500">{filteredRows.length} 条记录</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[72rem] border-collapse text-left text-xs">
            <thead className="bg-ink-50 text-[10px] font-semibold uppercase tracking-wider text-ink-600">
              <tr>
                {["组别", "文献编号", "DOI / 链接", "应填", "人工耗时", "人工已填", "人工正确", "人工覆盖率", "人工准确率", "AI 已填", "AI 正确", "AI 覆盖率", "AI 准确率", "状态", ""].map((label) => (
                  <th key={label} className="whitespace-nowrap border-b border-ink-200 px-3 py-3">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {filteredRows.map((row) => (
                <tr key={row.submissionId} className="hover:bg-brand-50/35">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-3 font-semibold text-ink-950">{row.groupCode}</td>
                  <td className="whitespace-nowrap px-3 py-3">文献 {row.paperNo}</td>
                  <td className="max-w-52 truncate px-3 py-3 font-mono text-[11px]" title={row.doi || row.title}>{row.doi || row.title}</td>
                  <td className="px-3 py-3 font-mono">{row.metrics.expected}</td>
                  <td className="whitespace-nowrap px-3 py-3 font-mono">{formatDuration(row.elapsedSeconds)}</td>
                  <MetricCell value={row.metrics.humanFilled} />
                  <MetricCell value={row.metrics.humanCorrect} />
                  <MetricCell value={percent(row.metrics.humanCoverage)} />
                  <MetricCell value={percent(row.metrics.humanAccuracy)} />
                  <MetricCell value={row.metrics.aiFilled} />
                  <MetricCell value={row.metrics.aiCorrect} />
                  <MetricCell value={percent(row.metrics.aiCoverage)} />
                  <MetricCell value={percent(row.metrics.aiAccuracy)} />
                  <td className="whitespace-nowrap px-3 py-3"><Status status={row.status} /></td>
                  <td className="px-3 py-3">
                    <button type="button" disabled={!row.submittedAt} onClick={() => setSelected(row)} className="text-xs font-semibold text-brand-700 hover:underline disabled:text-ink-300 disabled:no-underline">审核</button>
                  </td>
                </tr>
              ))}
              {!filteredRows.length ? (
                <tr><td colSpan={15} className="px-4 py-14 text-center text-sm text-ink-500">当前筛选条件下还没有学生提交。</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {selected ? (
        <ReviewDrawer
          row={selected}
          busy={busy === "保存审核"}
          onClose={() => setSelected(null)}
          onSave={async (humanScores, aiScores) => {
            const ok = await mutate(
              { action: "review", submissionId: selected.submissionId, humanScores, aiScores },
              "保存审核"
            );
            if (ok) setSelected(null);
          }}
        />
      ) : null}
    </main>
  );
}

function ReviewDrawer({
  row,
  busy,
  onClose,
  onSave,
}: {
  row: TeachingDashboardRow;
  busy: boolean;
  onClose: () => void;
  onSave: (human: TeachingScores, ai: TeachingScores) => Promise<void>;
}) {
  const [human, setHuman] = useState<TeachingScores>(row.humanScores);
  const [ai, setAi] = useState<TeachingScores>(row.aiScores);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/20" role="dialog" aria-modal="true" aria-label="逐字段审核">
      <div aria-hidden className="min-w-0 flex-1 cursor-default" onClick={onClose} />
      <aside className="h-full w-full max-w-2xl overflow-y-auto border-l border-ink-200 bg-white shadow-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-ink-200 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-ink-950">逐字段审核</h2>
            <p className="mt-1 text-xs text-ink-600">{row.groupCode} · 文献 {row.paperNo} · {row.studentAlias}</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="btn min-h-9 px-3 py-1.5">关闭</button>
        </header>
        <div className="px-5 py-5">
          <div className="grid grid-cols-[6rem_1fr_1fr] gap-3 border-b border-ink-200 pb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            <span>字段</span><span>人工 / 判定</span><span>AI / 判定</span>
          </div>
          <div className="divide-y divide-ink-100">
            {TEACHING_FIELDS.map((field) => (
              <div key={field.key} className="grid grid-cols-[6rem_1fr_1fr] gap-3 py-4">
                <strong className="text-xs text-ink-950">{field.label}</strong>
                <ReviewValue
                  value={row.answers[field.key]?.value ?? ""}
                  score={human[field.key] ?? "pending"}
                  name={`human-${field.key}`}
                  onChange={(score) => setHuman((current) => ({ ...current, [field.key]: score }))}
                />
                <ReviewValue
                  value={row.aiSnapshot[field.key] ?? ""}
                  score={ai[field.key] ?? "pending"}
                  name={`ai-${field.key}`}
                  onChange={(score) => setAi((current) => ({ ...current, [field.key]: score }))}
                />
              </div>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void onSave(human, ai)} className="btn-primary mt-6 w-full justify-center">
            {busy ? "正在保存…" : "保存审核"}
          </button>
        </div>
      </aside>
    </div>
  );
}

function ReviewValue({
  value,
  score,
  name,
  onChange,
}: {
  value: string;
  score: TeachingScore;
  name: string;
  onChange: (score: TeachingScore) => void;
}) {
  return (
    <div>
      <div className="min-h-9 break-words rounded-[7px] bg-ink-50 px-2.5 py-2 font-mono text-[11px] text-ink-900">{value || "—"}</div>
      <div className="mt-2 flex flex-wrap gap-1" role="radiogroup" aria-label={`${name} 判定`}>
        {([
          ["correct", "正确"],
          ["incorrect", "错误"],
          ["pending", "待定"],
        ] as const).map(([value, label]) => (
          <label key={value} className={`cursor-pointer rounded-[6px] border px-2 py-1 text-[10px] font-semibold ${
            score === value
              ? value === "correct"
                ? "border-brand-300 bg-brand-50 text-brand-800"
                : value === "incorrect"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-amber-300 bg-amber-50 text-amber-800"
              : "border-ink-200 text-ink-500"
          }`}>
            <input className="sr-only" type="radio" name={name} value={value} checked={score === value} onChange={() => onChange(value)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function AdminField({ label, name, placeholder, required = true }: { label: string; name: string; placeholder: string; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-ink-700">{label}</span>
      <input required={required} name={name} placeholder={placeholder} className="min-h-11 w-full rounded-[8px] border border-ink-200 px-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" />
    </label>
  );
}

function Summary({ label, value, tone = "brand" }: { label: string; value: string; tone?: "brand" | "amber" }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 sm:block">
      <span className="text-xs font-semibold text-ink-600">{label}</span>
      <strong className={`font-mono text-xl ${tone === "amber" ? "text-amber-700" : "text-brand-800"}`}>{value}</strong>
    </div>
  );
}

function MetricCell({ value }: { value: string | number }) {
  return <td className="whitespace-nowrap px-3 py-3 font-mono text-ink-800">{value}</td>;
}

function Status({ status }: { status: TeachingDashboardRow["status"] }) {
  const content =
    status === "reviewed"
      ? ["已完成", "border-brand-200 bg-brand-50 text-brand-800"]
      : status === "pending"
        ? ["待审核", "border-amber-200 bg-amber-50 text-amber-800"]
        : ["填写中", "border-ink-200 bg-ink-50 text-ink-600"];
  return <span className={`inline-flex rounded-[6px] border px-2 py-1 text-[10px] font-semibold ${content[1]}`}>{content[0]}</span>;
}

function percent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
