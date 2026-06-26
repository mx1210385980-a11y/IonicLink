"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Domain } from "@/lib/domain";
import type { RecordStatus } from "@/lib/schema";
import { type UnitMode } from "@/components/RecordCard";
import { openRecordEvidence, type ConditionItem } from "@/components/recordCardParts";
import { getClientModule } from "@/components/registry.client";
import { FilterBar } from "@/components/FilterBar";
import { applyRecordFilters, EMPTY_FILTERS, hasActiveFilters, type RecordFilters } from "@/components/recordFilters";

type AnyRecord = any;
type DatabasePayload = {
  records: AnyRecord[];
  counts: { official: number; review: number };
  papers?: { title: string; n: number }[];
};

export function recordListUnitsForStatus(status: RecordStatus, selectedUnits: UnitMode): UnitMode {
  return status === "official" ? "std" : selectedUnits;
}

export function shouldShowUnitModeControl(status: RecordStatus): boolean {
  return status === "review";
}

/** Token AND-match over source titles: every word of the query must appear. */
export function filterSources<T extends { title: string }>(papers: T[], query: string): T[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return papers;
  return papers.filter((p) => {
    const t = p.title.toLowerCase();
    return tokens.every((tok) => t.includes(tok));
  });
}

export async function parseDatabaseResponse(res: Response): Promise<DatabasePayload> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const snippet = body.replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(`Database API returned ${res.status}${snippet ? `: ${snippet}` : ""}`);
  }

  try {
    return (await res.json()) as DatabasePayload;
  } catch (error) {
    throw new Error("Database API returned an unreadable JSON payload", { cause: error });
  }
}

/**
 * The domain-generic database view: Official / Review tabs, search, the domain's
 * secondary facet, CSV export, approve/reject, and inline editing. All
 * domain-specific behaviour (which card/editor renders, the facet options, the
 * at-a-glance stats, the approval gate) comes from the client module registry.
 */
export function DatabaseView({ domain }: { domain: Domain }) {
  const mod = getClientModule(domain);
  const Card = mod.Card;
  const Editor = mod.Editor;

  const [status, setStatus] = useState<RecordStatus>("official");
  const [facet, setFacet] = useState<string>("all");
  const [paper, setPaper] = useState<string>("all");
  const [papers, setPapers] = useState<{ title: string; n: number }[]>([]);
  const [search, setSearch] = useState("");
  const [groupByPaper, setGroupByPaper] = useState(true);
  const [units, setUnits] = useState<UnitMode>("raw");
  const [records, setRecords] = useState<AnyRecord[]>([]);
  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [counts, setCounts] = useState({ official: 0, review: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusReady, setStatusReady] = useState(false);

  const queryParams = useCallback(() => {
    const params = new URLSearchParams({ status });
    if (facet !== "all") params.set("facet", facet);
    if (paper !== "all") params.set("paper", paper);
    if (search.trim()) params.set("search", search.trim());
    return params;
  }, [status, facet, paper, search]);

  const load = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/${domain}/records?${queryParams()}`);
      const data = await parseDatabaseResponse(res);
      const sources: { title: string; n: number }[] = data.papers ?? [];
      setRecords(data.records);
      setCounts(data.counts);
      setPapers(sources);
      // The focused source vanished from this queue (tab switch, or its last
      // record was approved/rejected) — fall back to the full list.
      if (paper !== "all" && !sources.some((p) => p.title === paper)) setPaper("all");
      setSelected(new Set());
    } catch (error) {
      console.error(error);
      setRecords([]);
      setPapers([]);
      setSelected(new Set());
      setNotice("Could not load database records. Refresh once; in local dev, keep the frontend on port 3000 and restart it if the API keeps returning 404.");
    } finally {
      setLoading(false);
    }
  }, [domain, queryParams, paper]);

  useEffect(() => {
    if (!statusReady) return;
    load();
  }, [load, statusReady]);

  useEffect(() => {
    const statusParam = new URLSearchParams(window.location.search).get("status");
    if (statusParam === "official" || statusParam === "review") setStatus(statusParam);
    setStatusReady(true);
  }, []);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  /** Select/deselect a whole source's records at once (group-header checkbox). */
  const toggleGroup = (recs: AnyRecord[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = recs.every((r) => next.has(r.id));
      for (const r of recs) allIn ? next.delete(r.id) : next.add(r.id);
      return next;
    });

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    await fetch(`/api/${domain}/records/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    load();
  };

  const approve = async (id: string) => {
    setNotice(null);
    const res = await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "official" }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setNotice(d.error || "Could not approve this record.");
      return;
    }
    load();
  };

  const reject = async (id: string) => {
    await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`, { method: "DELETE" });
    load();
  };

  /** Selected review records that pass the domain's core-completeness gate. */
  const readySelected = useMemo(
    () => records.filter((r) => selected.has(r.id) && mod.coreCompleteness(r).complete),
    [records, selected, mod]
  );

  const approveSelected = async () => {
    if (readySelected.length === 0) return;
    setNotice(null);
    let ok = 0;
    let failed = 0;
    for (const r of readySelected) {
      const res = await fetch(`/api/${domain}/records/${encodeURIComponent(r.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "official" }),
      });
      if (res.ok) ok++;
      else failed++;
    }
    const skipped = selected.size - readySelected.length;
    const parts = [`Approved ${ok} record${ok === 1 ? "" : "s"}`];
    if (skipped > 0) parts.push(`${skipped} skipped (incomplete core fields)`);
    if (failed > 0) parts.push(`${failed} failed`);
    setNotice(parts.join(" · "));
    load();
  };

  const exportHref = useMemo(() => `/api/${domain}/export?${queryParams()}`, [domain, queryParams]);
  // Variable filters apply instantly client-side over the loaded record list.
  const visible = useMemo(() => applyRecordFilters(domain, records, filters), [domain, records, filters]);
  const filtered = hasActiveFilters(filters);
  const groups = useMemo(() => groupRecords(visible, groupByPaper), [visible, groupByPaper]);
  const stats = useMemo(() => mod.listStats(visible), [mod, visible]);
  const sourceCount = useMemo(() => new Set(visible.map((r) => r.paper?.title)).size, [visible]);

  // Hidden records must never ride along in bulk actions — prune the selection
  // whenever a filter removes them from view.
  useEffect(() => {
    setSelected((prev) => {
      const visibleIds = new Set(visible.map((r) => r.id));
      const next = new Set([...prev].filter((id) => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);
  const recordUnits = recordListUnitsForStatus(status, units);
  const conditionItemsOf = useCallback((r: AnyRecord) => mod.conditionItems(r, recordUnits), [mod, recordUnits]);
  const systemFacetsOf = useCallback((r: AnyRecord) => mod.systemFacets(r, recordUnits), [mod, recordUnits]);

  return (
    <div data-testid="database-workbench-shell" className="panel overflow-hidden rounded-[8px] shadow-sm">
      {/* ── header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 px-4 py-3">
        <div className="flex items-center gap-3">
          <DbIcon />
          <div className="leading-tight">
            <h1 className="text-lg font-semibold tracking-tight text-ink-900">Database</h1>
            <span className="font-mono text-[11px] text-ink-700">{mod.tagline}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a href={exportHref} className="btn">
            <DownloadIcon /> Export CSV
          </a>
          <Link
            href={`/${domain}`}
            aria-label="Close database"
            className="grid h-9 w-9 place-items-center rounded-[8px] border border-ink-200 text-ink-400 transition hover:border-ink-300 hover:text-ink-700"
          >
            ✕
          </Link>
        </div>
      </div>

      {/* ── tabs + at-a-glance stats ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200/70 bg-ink-50/40 px-4 py-2.5">
        <div className="flex rounded-[8px] border border-ink-200 bg-white p-0.5 text-sm">
          <Tab active={status === "official"} onClick={() => setStatus("official")}>
            Official Database <Badge active={status === "official"}>{counts.official}</Badge>
          </Tab>
          <Tab active={status === "review"} onClick={() => setStatus("review")}>
            Review Queue <Badge active={status === "review"} tone="amber">{counts.review}</Badge>
          </Tab>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      </div>

      {/* ── toolbar ── */}
      <div data-testid="database-command-bar" className="flex flex-wrap items-center gap-2 border-b border-ink-200/70 px-4 py-2.5">
        <div className="relative w-full sm:w-auto">
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search paper, cation, anion…"
            className="w-full min-w-0 rounded-[8px] border border-ink-200 bg-white py-1.5 pl-9 pr-3 text-xs outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100 sm:w-64"
          />
        </div>
        <SourceFilter paper={paper} papers={papers} onChange={setPaper} />
        <Segmented value={facet} onChange={setFacet} options={mod.facet.options} />
        <button
          onClick={() => setGroupByPaper((g) => !g)}
          className={`inline-flex items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-xs font-semibold tracking-wide transition-all ${
            groupByPaper
              ? "border-brand-200 bg-brand-50/60 text-brand-700"
              : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50 hover:text-brand-700"
          }`}
        >
          <BookIcon /> Group by paper
        </button>
        {shouldShowUnitModeControl(status) && (
          <Segmented
            value={units}
            onChange={(v) => setUnits(v as UnitMode)}
            options={[
              { value: "raw", label: "As reported" },
              { value: "std", label: "Standardized" },
            ]}
          />
        )}
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="font-mono text-ink-700">{selected.size} selected</span>
            {status === "review" && (
              <button
                onClick={approveSelected}
                disabled={readySelected.length === 0}
                title={
                  readySelected.length === 0
                    ? "None of the selected records have complete core fields"
                    : "Approve every selected record whose core fields are complete"
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckIcon /> Approve ready ({readySelected.length})
              </button>
            )}
            <button
              onClick={deleteSelected}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 font-medium text-rose-600 transition hover:bg-rose-50"
            >
              <TrashIcon /> {status === "review" ? "Reject" : "Delete"}
            </button>
          </div>
        )}
      </div>

      {/* ── variable filters ── */}
      {!loading && records.length > 0 && (
        <FilterBar domain={domain} records={records} filters={filters} shown={visible.length} onChange={setFilters} />
      )}

      {/* ── context caption ── */}
      <p className="border-b border-ink-100 px-4 py-2 text-xs leading-relaxed text-ink-700">
        {status === "official"
          ? "Approved library records only — review candidates are kept separate until vetted."
          : "AI-extracted candidates awaiting approval. A record needs all base-layer (core) fields before it can be approved into the database."}
        {paper !== "all" && (
          <>
            {" "}
            Showing one source: <span className="font-medium text-ink-600">{paper}</span>.
          </>
        )}
      </p>

      {notice && (
        <div className="mx-4 mt-3 flex items-center justify-between rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700">✕</button>
        </div>
      )}

      {/* ── records ── */}
      <div className="space-y-5 p-4">
        {loading ? (
          <div className="space-y-3">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : visible.length === 0 ? (
          <Empty>
            {records.length > 0 && filtered ? (
              <span className="inline-flex flex-col items-center gap-2">
                <span>No records match the variable filters.</span>
                <button
                  onClick={() => setFilters(EMPTY_FILTERS)}
                  className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                >
                  Reset filters
                </button>
              </span>
            ) : paper !== "all" || facet !== "all" || search.trim() ? (
              "No records match the current filters."
            ) : status === "review" ? (
              "Review queue is empty. Head to Extract to pull candidates from a paper."
            ) : (
              "No official records yet. Approve candidates from the Review Queue."
            )}
          </Empty>
        ) : (
          groups.map((group, gi) => (
            <section
              key={group.key}
              className="animate-[row-rise_460ms_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${Math.min(gi, 8) * 55}ms` }}
            >
              {groupByPaper && (
                <div className="mb-3 flex items-end justify-between gap-3 border-b border-ink-100 pb-2">
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    <input
                      type="checkbox"
                      checked={group.records.every((r) => selected.has(r.id))}
                      onChange={() => toggleGroup(group.records)}
                      className="h-4 w-4 translate-y-0.5 cursor-pointer rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                      aria-label={`Select all records from ${group.title}`}
                      title="Select every record from this source"
                    />
                    <BookIcon className="shrink-0 translate-y-0.5 text-brand-600" />
                    <h2 className="min-w-0 truncate font-serif text-[16px] font-semibold leading-snug text-ink-900" title={group.title}>{group.title}</h2>
                    {group.meta && (
                      <span
                        className="hidden min-w-0 max-w-[22rem] shrink truncate rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline"
                        title={group.meta}
                      >
                        {group.meta}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {paper === "all" && (
                      <button
                        onClick={() => setPaper(group.key)}
                        title="Show only this source's records"
                        className="inline-flex items-center gap-1 rounded-md border border-ink-200 bg-white px-2 py-1 text-[10px] font-semibold tracking-wide text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                      >
                        <FunnelIcon /> Focus
                      </button>
                    )}
                    <span className="font-mono text-[11px] text-ink-400">
                      {group.records.length} record{group.records.length > 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              )}
              {(groupByPaper
                ? splitBySystem(group.records, systemFacetsOf)
                : [{ key: "all", facets: [], records: group.records } as SystemSubgroup]
              ).map((subgroup) => (
                <div key={subgroup.key} className="mb-5 last:mb-0">
                  {subgroup.facets.length > 0 && (
                    <SystemSubgroupHeader subgroup={subgroup} selected={selected} onToggle={toggleGroup} domain={domain} />
                  )}
                  {groupByPaper && subgroup.records.length > 1 && (
                    <GroupConditionsStrip
                      records={subgroup.records}
                      itemsOf={conditionItemsOf}
                      domain={domain}
                      omitLabels={subgroup.facets.length > 0 ? new Set(subgroup.facets.map((f) => f.item.label)) : undefined}
                    />
                  )}
                  <div className="space-y-3">
                    {subgroup.records.map((rec) =>
                  editingId === rec.id ? (
                    <Editor
                      key={rec.id}
                      record={rec}
                      domain={domain}
                      onSaved={() => {
                        setEditingId(null);
                        load();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <Card
                      key={rec.id}
                      record={rec}
                      domain={domain}
                      units={recordUnits}
                      selected={selected.has(rec.id)}
                      onToggle={toggle}
                      actions={
                        <>
                          <button
                            onClick={() => setEditingId(rec.id)}
                            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                          >
                            Edit
                          </button>
                          {status === "review" && (
                            <>
                              <button
                                onClick={() => approve(rec.id)}
                                disabled={!mod.coreCompleteness(rec).complete}
                                title={
                                  mod.coreCompleteness(rec).complete
                                    ? "Approve into the official database"
                                    : `Complete core fields first: ${mod.coreCompleteness(rec).missing.join(", ")}`
                                }
                                className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => reject(rec.id)}
                                className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-rose-200 hover:text-rose-600"
                              >
                                Reject
                              </button>
                            </>
                          )}
                        </>
                      }
                    />
                  )
                )}
                  </div>
                </div>
              ))}
            </section>
          ))
        )}
      </div>

      {/* ── footer ── */}
      <div className="flex items-center justify-between border-t border-ink-200/70 bg-ink-50/30 px-5 py-3 font-mono text-[11px] text-ink-400">
        <span>
          {visible.length === 0 ? "0" : `1–${visible.length}`} of {visible.length} record
          {visible.length === 1 ? "" : "s"}
          {filtered && ` · filtered from ${records.length}`}
        </span>
        <span>
          {sourceCount} source{sourceCount === 1 ? "" : "s"}
          {paper !== "all" && ` · filtered from ${papers.length}`}
        </span>
      </div>
    </div>
  );
}

interface Group {
  key: string;
  title: string;
  meta?: string;
  records: AnyRecord[];
}

/** A condition every record of the group reports with the same value. */
export interface SharedGroupCondition {
  item: ConditionItem;
  /** The record whose provenance backs this value — extractors cite a constant condition once per sweep. */
  recordId: string;
  sourceId?: string;
  /** How many of the group's records state the value (may be < total). */
  coverage: number;
  total: number;
}

/** A condition that differs across the group — the sweep axis worth comparing. */
export interface VaryingGroupCondition {
  label: string;
  /** Distinct values in first-encounter order. */
  values: string[];
}

/**
 * Collective-review analysis for one source's records: conditions SHARED by
 * the sweep are shown once at group level, carrying the group's single
 * evidence link (so a data point reviewed below it never loses the connection),
 * while VARYING conditions are surfaced as the variables that distinguish the
 * records.
 */
export function analyzeGroupConditions(
  records: AnyRecord[],
  itemsOf: (record: AnyRecord) => ConditionItem[]
): { shared: SharedGroupCondition[]; varying: VaryingGroupCondition[] } {
  if (records.length < 2) return { shared: [], varying: [] };
  interface Acc {
    values: string[];
    first: ConditionItem;
    withProv?: { item: ConditionItem; recordId: string; sourceId?: string };
    coverage: number;
  }
  const order: string[] = [];
  const byLabel = new Map<string, Acc>();
  for (const r of records) {
    for (const item of itemsOf(r)) {
      let acc = byLabel.get(item.label);
      if (!acc) {
        acc = { values: [], first: item, coverage: 0 };
        byLabel.set(item.label, acc);
        order.push(item.label);
      }
      acc.coverage++;
      if (!acc.values.includes(item.value)) acc.values.push(item.value);
      if (!acc.withProv && item.prov) acc.withProv = { item, recordId: r.id, sourceId: r.sourceId };
    }
  }
  const shared: SharedGroupCondition[] = [];
  const varying: VaryingGroupCondition[] = [];
  for (const label of order) {
    const acc = byLabel.get(label)!;
    if (acc.values.length === 1 && acc.coverage >= 2) {
      shared.push({
        item: acc.withProv?.item ?? acc.first,
        recordId: acc.withProv?.recordId ?? records[0].id,
        sourceId: acc.withProv?.sourceId ?? records[0].sourceId,
        coverage: acc.coverage,
        total: records.length,
      });
    } else if (acc.values.length > 1) {
      varying.push({ label, values: acc.values });
    }
  }
  return { shared, varying };
}

/** One distinct measurement system within a paper (e.g. one substrate, one anion). */
export interface SystemSubgroup {
  key: string;
  /**
   * The facets that distinguish this sub-group from its siblings — only facets
   * whose value differs between sub-groups, each carrying the provenance of a
   * record inside this sub-group that cites it.
   */
  facets: { item: ConditionItem; recordId: string; sourceId?: string }[];
  records: AnyRecord[];
}

/**
 * Split a paper's records into one sub-group per distinct SYSTEM (the identity
 * facets: ionic liquid + surface/species). A paper comparing two substrates or
 * three anions reviews as separate systems, each with its own shared-conditions
 * strip; a paper sweeping an operating condition stays one group. With a single
 * system the one sub-group has no distinguishing facets and renders headerless.
 */
export function splitBySystem(records: AnyRecord[], facetsOf: (record: AnyRecord) => ConditionItem[]): SystemSubgroup[] {
  interface Bucket {
    key: string;
    records: AnyRecord[];
    byLabel: Map<string, { item: ConditionItem; recordId: string; sourceId?: string }>;
    labels: string[];
  }
  const order: string[] = [];
  const buckets = new Map<string, Bucket>();
  for (const r of records) {
    const facets = facetsOf(r);
    const key = facets.map((f) => `${f.label}:${f.value}`).join(" | ") || "—";
    let b = buckets.get(key);
    if (!b) {
      b = { key, records: [], byLabel: new Map(), labels: [] };
      buckets.set(key, b);
      order.push(key);
    }
    b.records.push(r);
    for (const f of facets) {
      const seen = b.byLabel.get(f.label);
      if (!seen) {
        b.byLabel.set(f.label, { item: f, recordId: r.id, sourceId: r.sourceId });
        b.labels.push(f.label);
      } else if (!seen.item.prov && f.prov) {
        // prefer the sub-group record that actually cites this facet
        b.byLabel.set(f.label, { item: f, recordId: r.id, sourceId: r.sourceId });
      }
    }
  }
  const all = order.map((k) => buckets.get(k)!);
  if (all.length <= 1) return all.map((b) => ({ key: b.key, facets: [], records: b.records }));

  // Only facets whose value differs between sub-groups belong in the headers.
  const differing = new Set<string>();
  const labels = [...new Set(all.flatMap((b) => b.labels))];
  for (const label of labels) {
    const values = new Set(all.map((b) => b.byLabel.get(label)?.item.value ?? "∅"));
    if (values.size > 1) differing.add(label);
  }
  return all.map((b) => ({
    key: b.key,
    facets: b.labels.filter((l) => differing.has(l)).map((l) => b.byLabel.get(l)!),
    records: b.records,
  }));
}

function EvidenceInline({
  label,
  value,
  title,
  prov,
  sourceId,
  recordId,
  field,
  domain,
  after,
  labelClassName = "text-ink-600",
  valueClassName = "font-semibold text-ink-800",
}: {
  label: string;
  value: string;
  title?: string;
  prov?: ConditionItem["prov"];
  sourceId?: string;
  recordId?: string;
  field: string;
  domain: Domain;
  after?: React.ReactNode;
  labelClassName?: string;
  valueClassName?: string;
}) {
  const content = (
    <>
      <span className={`text-[9px] font-semibold uppercase tracking-eyebrow ${labelClassName}`}>{label}</span>
      <span className={`font-mono text-xs ${valueClassName}`}>{value}</span>
      {after}
    </>
  );
  if (!prov) {
    return (
      <span className="inline-flex items-baseline gap-1.5" title={title}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid="evidence-click-target"
      className="inline-flex items-baseline gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-white/70 hover:ring-1 hover:ring-brand-100 focus:outline-none focus:ring-2 focus:ring-brand-200"
      title={`${title ?? value} · evidence available`}
      aria-label={`Open evidence for ${field}`}
      onClick={() => openRecordEvidence({ sourceId, recordId, field, value, prov, domain })}
    >
      {content}
    </button>
  );
}

/** Header for one system sub-group: the distinguishing facets, each with its evidence link. */
function SystemSubgroupHeader({
  subgroup,
  selected,
  onToggle,
  domain,
}: {
  subgroup: SystemSubgroup;
  selected: Set<string>;
  onToggle: (records: AnyRecord[]) => void;
  domain: Domain;
}) {
  const facetSummary = subgroup.facets.map((f) => f.item.value).join(" · ");
  return (
    <div
      data-testid="system-subgroup"
      className="mb-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 rounded-lg border-l-2 border-brand-400 bg-brand-50/50 px-3 py-1.5"
    >
      <input
        type="checkbox"
        checked={subgroup.records.every((r) => selected.has(r.id))}
        onChange={() => onToggle(subgroup.records)}
        className="h-3.5 w-3.5 cursor-pointer rounded border-ink-300 text-brand-600 focus:ring-brand-500"
        aria-label={`Select all ${facetSummary} records`}
        title="Select every record of this system"
      />
      {subgroup.facets.map((f) => (
        <EvidenceInline
          key={f.item.label}
          label={f.item.label}
          value={f.item.value}
          title={f.item.title}
          prov={f.item.prov}
          sourceId={f.sourceId}
          recordId={f.recordId}
          field={f.item.field ?? f.item.label}
          domain={domain}
          labelClassName="text-brand-700/70"
          valueClassName="font-bold text-ink-900"
        />
      ))}
      <span className="ml-auto font-mono text-[10px] text-ink-400">
        {subgroup.records.length} record{subgroup.records.length > 1 ? "s" : ""}
      </span>
    </div>
  );
}

/** How many distinct values of a sweep axis are listed before collapsing to a count. */
const VARYING_VALUES_SHOWN = 4;

function GroupConditionsStrip({
  records,
  itemsOf,
  domain,
  omitLabels,
}: {
  records: AnyRecord[];
  itemsOf: (record: AnyRecord) => ConditionItem[];
  domain: Domain;
  /** Labels already shown in the sub-group header — no need to repeat them. */
  omitLabels?: Set<string>;
}) {
  const analyzed = useMemo(() => analyzeGroupConditions(records, itemsOf), [records, itemsOf]);
  const shared = omitLabels ? analyzed.shared.filter((s) => !omitLabels.has(s.item.label)) : analyzed.shared;
  const varying = omitLabels ? analyzed.varying.filter((v) => !omitLabels.has(v.label)) : analyzed.varying;
  if (shared.length === 0 && varying.length === 0) return null;
  return (
    <div data-testid="group-conditions" className="mb-3 rounded-xl border border-ink-200/60 bg-ink-50/40 px-3.5 py-2">
      {shared.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="label-eyebrow shrink-0 text-[9px] leading-5 text-ink-600">Shared conditions</span>
          {shared.map((s) => (
            <EvidenceInline
              key={s.item.label}
              label={s.item.label}
              value={s.item.value}
              title={s.item.title}
              prov={s.item.prov}
              sourceId={s.sourceId}
              recordId={s.recordId}
              field={s.item.field ?? s.item.label}
              domain={domain}
              after={
                s.coverage < s.total ? (
                  <span
                    className="font-mono text-[9px] font-semibold text-amber-600"
                    title={`Stated on ${s.coverage} of the group's ${s.total} records`}
                  >
                    {s.coverage}/{s.total}
                  </span>
                ) : null
              }
            />
          ))}
        </div>
      )}
      {varying.length > 0 && (
        <div
          className={`flex flex-wrap items-baseline gap-x-4 gap-y-1 ${
            shared.length > 0 ? "mt-1.5 border-t border-ink-100 pt-1.5" : ""
          }`}
        >
          <span className="label-eyebrow shrink-0 text-[9px] leading-5 text-violet-700">Varies</span>
          {varying.map((v) => (
            <span key={v.label} className="inline-flex items-baseline gap-1.5">
              <span className="text-[9px] font-semibold uppercase tracking-eyebrow text-violet-700">{v.label}</span>
              <span className="font-mono text-xs text-ink-700" title={v.values.join(" · ")}>
                {v.values.length <= VARYING_VALUES_SHOWN ? v.values.join(" · ") : `${v.values.length} values`}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function groupRecords(records: AnyRecord[], byPaper: boolean): Group[] {
  if (!byPaper) return [{ key: "all", title: "All records", records }];
  const map = new Map<string, Group>();
  for (const r of records) {
    const key = r.paper.title;
    if (!map.has(key)) {
      const meta = [r.paper.journal, r.paper.year].filter(Boolean).join(" · ");
      map.set(key, { key, title: r.paper.title, meta: meta || undefined, records: [] });
    }
    map.get(key)!.records.push(r);
  }
  return [...map.values()];
}

/* ---------- small presentational helpers ---------- */

/**
 * Searchable source filter: a compact trigger plus a popover with type-ahead
 * filtering and a scrollable list — a flat <select> stops scaling once the
 * library holds more than a screenful of papers.
 */
function SourceFilter({
  paper,
  papers,
  onChange,
}: {
  paper: string;
  papers: { title: string; n: number }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const active = paper !== "all";
  const matches = useMemo(() => filterSources(papers, query), [papers, query]);
  const items = useMemo(
    () => [{ title: "all", label: "All sources", n: papers.length }, ...matches.map((p) => ({ title: p.title, label: p.title, n: p.n }))],
    [papers.length, matches]
  );
  const selectedCount = active ? papers.find((p) => p.title === paper)?.n : papers.length;

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[data-highlighted="true"]')?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  const choose = (title: string) => {
    onChange(title);
    setOpen(false);
  };

  const openPopover = () => {
    setQuery("");
    setHighlight(0);
    setOpen((o) => !o);
  };

  const onKeyDown = (ev: React.KeyboardEvent) => {
    if (ev.key === "Escape") return setOpen(false);
    if (ev.key === "ArrowDown") {
      ev.preventDefault();
      setHighlight((h) => Math.min(h + 1, items.length - 1));
    } else if (ev.key === "ArrowUp") {
      ev.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (ev.key === "Enter") {
      ev.preventDefault();
      if (items[highlight]) choose(items[highlight].title);
    }
  };

  return (
    <div ref={rootRef} data-testid="source-filter" className="relative">
      <div
        className={`flex items-center gap-1.5 rounded-lg border bg-white py-1 pl-2.5 pr-1.5 text-xs shadow-sm transition ${
          active ? "border-brand-300 ring-2 ring-brand-100" : "border-ink-200"
        }`}
      >
        <button
          type="button"
          onClick={openPopover}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label="Filter by source"
          title={active ? paper : "Show records from one source only"}
          className="flex min-w-0 items-center gap-1.5 py-0.5 font-semibold text-ink-700 outline-none"
        >
          <BookIcon className={`shrink-0 ${active ? "text-brand-600" : "text-ink-400"}`} />
          <span className="max-w-[11rem] truncate">{active ? paper : "All sources"}</span>
          <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-ink-500">
            {selectedCount ?? 0}
          </span>
          <ChevronIcon open={open} />
        </button>
        {active && (
          <button
            onClick={() => onChange("all")}
            aria-label="Clear source filter"
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div
          data-testid="source-filter-popover"
          className="absolute left-0 top-full z-30 mt-1.5 w-[26rem] max-w-[88vw] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.16)]"
        >
          {papers.length > 6 && (
            <div className="relative border-b border-ink-100 p-2">
              <SearchIcon />
              <input
                autoFocus
                value={query}
                onChange={(ev) => {
                  setQuery(ev.target.value);
                  setHighlight(0);
                }}
                onKeyDown={onKeyDown}
                placeholder="Filter sources…"
                aria-label="Filter source list"
                className="w-full rounded-lg border border-ink-200 bg-ink-50/50 py-1.5 pl-9 pr-3 text-xs outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100"
              />
            </div>
          )}
          <ul ref={listRef} role="listbox" aria-label="Sources" className="max-h-72 overflow-y-auto p-1.5">
            {items.map((item, i) => {
              const isSelected = paper === item.title;
              return (
                <li key={item.title}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-highlighted={i === highlight || undefined}
                    onClick={() => choose(item.title)}
                    onMouseEnter={() => setHighlight(i)}
                    title={item.label}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      i === highlight ? "bg-brand-50/70" : ""
                    } ${isSelected ? "font-semibold text-brand-700" : "font-medium text-ink-700"}`}
                  >
                    <span className="grid w-3.5 shrink-0 place-items-center text-brand-600">{isSelected && <CheckIcon />}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold leading-none text-ink-500">
                      {item.n}
                    </span>
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-xs text-ink-400">No source matches “{query}”</li>
            )}
          </ul>
          <div className="border-t border-ink-100 bg-ink-50/40 px-3 py-1.5 font-mono text-[10px] font-medium text-ink-400">
            {query ? `${matches.length} of ${papers.length} sources` : `${papers.length} sources`}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-ink-200/60 bg-white px-2.5 py-1.5 transition hover:border-ink-300">
      <div>
        <div className="label-eyebrow text-[9px] leading-none text-ink-400">{label}</div>
        <div className="mt-1 font-mono text-[13px] font-bold tabular-nums text-ink-900 leading-none">{value}</div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-[7px] px-3 py-1.5 text-xs font-semibold tracking-wide transition-all ${
        active ? "bg-ink-900 text-white shadow-sm" : "text-ink-700 hover:bg-ink-100 hover:text-brand-700"
      }`}
    >
      {children}
    </button>
  );
}

function Badge({ children, tone = "brand", active }: { children: React.ReactNode; tone?: "brand" | "amber"; active?: boolean }) {
  const cls = active
    ? "bg-white/20 text-white"
    : tone === "amber"
      ? "bg-amber-100 text-amber-700"
      : "bg-brand-100 text-brand-700";
  return <span className={`rounded-full px-1.5 py-0.5 font-mono text-[9px] font-black tabular-nums leading-none ${cls}`}>{children}</span>;
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; dot?: string }[];
}) {
  return (
    <div className="flex rounded-lg border border-ink-200 bg-white p-1 text-xs shadow-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-semibold transition-all ${
            value === o.value ? "bg-ink-900 text-white shadow-sm" : "text-ink-700 hover:bg-ink-50 hover:text-brand-700"
          }`}
        >
          {o.dot && <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-ink-200 bg-ink-50/30 py-16 text-sm text-ink-700 shadow-inner">
      <div className="flex flex-col items-center gap-3">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-300">
          <circle cx="12" cy="12" r="10" />
          <path d="M8 12h8" />
        </svg>
        <span className="text-center font-medium max-w-xs leading-relaxed">{children}</span>
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-1 gap-4 rounded-xl border border-ink-100 bg-white p-4 xl:grid-cols-[3rem_1fr_1fr_1.2fr]">
      <div className="hidden h-8 w-8 rounded bg-ink-100 xl:block" />
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-ink-100" />
        <div className="h-5 w-24 rounded bg-ink-100" />
        <div className="h-10 rounded bg-ink-100/70" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-16 rounded bg-ink-100" />
        <div className="h-5 w-28 rounded bg-ink-100" />
        <div className="h-5 w-20 rounded bg-ink-100" />
      </div>
      <div className="space-y-2">
        <div className="h-16 rounded-xl bg-ink-200/60" />
        <div className="h-10 rounded bg-ink-100/70" />
      </div>
    </div>
  );
}

function DbIcon() {
  return (
    <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-sm">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <ellipse cx="12" cy="6" rx="7" ry="3" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 6v12c0 1.66 3.13 3 7 3s7-1.34 7-3V6" stroke="currentColor" strokeWidth="1.6" />
        <path d="M5 12c0 1.66 3.13 3 7 3s7-1.34 7-3" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    </span>
  );
}
function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function FunnelIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
      <path d="M3 5h18l-7 8v6l-4-2v-4L3 5z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 13a1 1 0 001 1h6a1 1 0 001-1l1-13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className={`shrink-0 text-ink-400 transition-transform ${open ? "rotate-180" : ""}`}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function BookIcon({ className = "text-brand-600" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className={className}>
      <path d="M4 5a2 2 0 0 1 2-2h6v16H6a2 2 0 0 0-2 2V5z" stroke="currentColor" strokeWidth="1.5" />
      <path d="M20 5a2 2 0 0 0-2-2h-6v16h6a2 2 0 0 1 2 2V5z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
