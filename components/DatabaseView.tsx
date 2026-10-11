"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Domain } from "@/lib/domain";
import type { RecordStatus } from "@/lib/schema";
import { type UnitMode } from "@/components/RecordCard";
import { openRecordEvidence, type ConditionItem } from "@/components/recordCardParts";
import type { ClientModule } from "@/components/registry.client";
import { FilterBar } from "@/components/FilterBar";
import { applyRecordFilters, EMPTY_FILTERS, hasActiveFilters, type RecordFilters } from "@/components/recordFilters";
import { StructureSearchDialog } from "@/components/StructureSearchDialog";
import { ReviewWorkbench } from "@/components/database/ReviewWorkbench";
import type { DatabaseInitialData, DatabasePayload } from "@/lib/databasePayload";
import { AnalysisToolbar } from "@/components/database/AnalysisToolbar";
import { AnalysisFilters } from "@/components/database/AnalysisFilters";
import { DatabaseTable } from "@/components/database/DatabaseTable";
import RecordComparison from "@/components/database/RecordComparison";
import DatabaseQuality from "@/components/database/DatabaseQuality";
import { RecordDetailPanel } from "@/components/database/RecordDetailPanel";
import { getAnalysisFields, sortAnalysisRecords } from "@/components/database/analysisFields";
import { applyAnalysisFilters, buildAnalysisUrl, defaultAnalysisState, downloadAnalysisSnapshot, hasAnalysisFilters, readDatabaseLocation, type AnalysisState } from "@/components/database/analysisState";
import type { AnalysisRecord } from "@/components/database/analysisTypes";
import {
  STRUCTURE_MODE_PARAM,
  STRUCTURE_SMILES_PARAM,
  STRUCTURE_TARGET_PARAM,
  structureTargetLabel,
  type StructureSearchValue,
} from "@/lib/structureSearch";

type AnyRecord = any;

const DatabaseScatterPlot = dynamic(() => import("@/components/database/DatabaseScatterPlot").then((module) => module.DatabaseScatterPlot), {
  loading: () => <div role="status" className="p-8 text-sm text-ink-500">Loading plot…</div>,
});

export const SEARCH_DEBOUNCE_MS = 300;
export const VISIBLE_BATCH_SIZE = 50;

export function buildDatabaseQuery({
  status,
  facet,
  paper,
  search,
  structure,
}: {
  status: RecordStatus;
  facet: string;
  paper: string;
  search: string;
  structure?: StructureSearchValue | null;
}): string {
  const params = new URLSearchParams({ status });
  if (facet !== "all") params.set("facet", facet);
  if (paper !== "all") params.set("paper", paper);
  if (search.trim()) params.set("search", search.trim());
  if (structure?.smiles.trim()) {
    params.set(STRUCTURE_SMILES_PARAM, structure.smiles.trim());
    params.set(STRUCTURE_TARGET_PARAM, structure.target);
    params.set(STRUCTURE_MODE_PARAM, structure.mode);
  }
  return params.toString();
}

export function takeVisibleRecords<T>(records: T[], limit: number): T[] {
  return records.slice(0, Math.max(0, limit));
}

export function isLoadedQueryReady(
  loadedQuery: string | null,
  currentQuery: string,
  searchInput: string,
  committedSearch: string
): boolean {
  return loadedQuery === currentQuery && searchInput.trim() === committedSearch;
}

export function selectedDisplayedRecords<T extends { id: string }>(
  displayedRecords: T[],
  selected: ReadonlySet<string>
): T[] {
  return displayedRecords.filter((record) => selected.has(record.id));
}

export function pruneSelectionToDisplayed<T extends { id: string }>(
  selected: ReadonlySet<string>,
  displayedRecords: T[]
): Set<string> {
  const displayedIds = new Set(displayedRecords.map((record) => record.id));
  return new Set([...selected].filter((id) => displayedIds.has(id)));
}

export function databaseStatusUrl(href: string, status: RecordStatus): string {
  const url = new URL(href);
  url.searchParams.set("status", status);
  return `${url.pathname}${url.search}${url.hash}`;
}

export async function requireOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const message = typeof payload?.error === "string" && payload.error.trim() ? payload.error : fallback;
  throw new Error(message);
}

export function recordListUnitsForStatus(status: RecordStatus, selectedUnits: UnitMode): UnitMode {
  return status === "official" ? "std" : selectedUnits;
}

export function shouldShowUnitModeControl(status: RecordStatus): boolean {
  return status === "review";
}

export function defaultUnitModeForDomain(domain: Domain): UnitMode {
  return domain === "conductivity" ? "std" : "raw";
}

export function isMockExtractionRecord(record: { extraction?: { source?: string } }): boolean {
  return record.extraction?.source === "mock";
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
    let apiError: string | null = null;
    try {
      const payload = JSON.parse(body) as { error?: unknown };
      if (typeof payload.error === "string" && payload.error.trim()) apiError = payload.error;
    } catch {}
    if (apiError) throw new Error(apiError);
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
export function DatabaseView({
  domain,
  clientModule: mod,
  initialData,
}: {
  domain: Domain;
  clientModule: ClientModule;
  initialData?: DatabaseInitialData;
}) {
  const Card = mod.Card;
  const Editor = mod.Editor;
  const analysisFields = useMemo(() => getAnalysisFields(domain), [domain]);
  const [analysis, setAnalysis] = useState<AnalysisState>(() => defaultAnalysisState(domain));
  const [locationReady, setLocationReady] = useState(false);
  const [comparisonRecords, setComparisonRecords] = useState<AnalysisRecord[]>([]);
  const [detailRecord, setDetailRecord] = useState<AnalysisRecord | null>(null);
  const compareIds = useMemo(() => new Set(comparisonRecords.map((record) => record.id)), [comparisonRecords]);
  const plotIds = useMemo(() => new Set(analysis.plotIds ?? []), [analysis.plotIds]);

  const [status, setStatus] = useState<RecordStatus>(initialData?.status ?? "official");
  const [facet, setFacet] = useState<string>("all");
  const [paper, setPaper] = useState<string>("all");
  const [papers, setPapers] = useState<{ title: string; n: number }[]>(initialData?.papers ?? []);
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [structureSearch, setStructureSearch] = useState<StructureSearchValue | null>(null);
  const [structureDialogOpen, setStructureDialogOpen] = useState(false);
  const [groupByPaper, setGroupByPaper] = useState(true);
  const [showConditionsOverview, setShowConditionsOverview] = useState(false);
  const [units, setUnits] = useState<UnitMode>(() => defaultUnitModeForDomain(domain));
  const [records, setRecords] = useState<AnyRecord[]>(initialData?.records ?? []);
  const [filters, setFilters] = useState<RecordFilters>(EMPTY_FILTERS);
  const [counts, setCounts] = useState(initialData?.counts ?? { official: 0, review: 0 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [refreshing, setRefreshing] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(VISIBLE_BATCH_SIZE);
  const [statusReady, setStatusReady] = useState(Boolean(initialData));
  const [loadedQuery, setLoadedQuery] = useState<string | null>(initialData?.queryKey ?? null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  const hasLoadedRef = useRef(Boolean(initialData));
  const searchTimeoutRef = useRef<number | null>(null);

  const query = useMemo(
    () => buildDatabaseQuery({ status, facet, paper, search: committedSearch, structure: structureSearch }),
    [status, facet, paper, committedSearch, structureSearch]
  );
  const queryKey = `${domain}?${query}`;
  const queryReady = locationReady && statusReady && isLoadedQueryReady(loadedQuery, queryKey, search, committedSearch);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!hasLoadedRef.current) setLoading(true);
    setRefreshing(true);
    try {
      const res = await fetch(`/api/${domain}/records?${query}`, { signal: controller.signal });
      const data = await parseDatabaseResponse(res);
      if (controller.signal.aborted) return;
      const sources: { title: string; n: number }[] = data.papers ?? [];
      setRecords(data.records);
      setVisibleLimit(VISIBLE_BATCH_SIZE);
      setCounts(data.counts);
      setPapers(sources);
      hasLoadedRef.current = true;
      setLoadedQuery(queryKey);
      // The focused source vanished from this queue (tab switch, or its last
      // record was approved/rejected) — fall back to the full list.
      if (paper !== "all" && !sources.some((p) => p.title === paper)) setPaper("all");
      setSelected(new Set());
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      setNotice("Could not load database records. Refresh once; in local dev, keep the frontend on port 3000 and restart it if the API keeps returning 404.");
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [domain, query, queryKey, paper]);

  useEffect(() => {
    if (!locationReady || !statusReady || loadedQuery === queryKey) return;
    load();
  }, [load, loadedQuery, queryKey, refreshVersion, statusReady, locationReady]);

  const restoreLocation = useCallback((searchParams: string) => {
    const restored = readDatabaseLocation(searchParams, domain);
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = null;
    setStatus(restored.status);
    setFacet(mod.facet.options.some((option) => option.value === restored.facet) ? restored.facet : "all");
    setPaper(restored.paper); setSearch(restored.search); setCommittedSearch(restored.search);
    setStructureSearch(restored.structure); setFilters(restored.filters); setAnalysis(restored.analysis);
    setGroupByPaper(restored.analysis.groupByPaper); setShowConditionsOverview(restored.analysis.conditionsOverview);
    setSelected(new Set()); setEditingId(null); setDetailRecord(null); setVisibleLimit(VISIBLE_BATCH_SIZE);
    setStatusReady(true);
    setLocationReady(true);
  }, [domain, mod.facet.options]);

  useEffect(() => {
    const restore = () => restoreLocation(window.location.search);
    restore();
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [restoreLocation]);

  const locationState = useMemo(() => ({
    status, facet, paper, search: committedSearch, structure: structureSearch, filters,
    analysis: { ...analysis, groupByPaper, conditionsOverview: showConditionsOverview },
  }), [status, facet, paper, committedSearch, structureSearch, filters, analysis, groupByPaper, showConditionsOverview]);
  const viewUrl = useMemo(() => buildAnalysisUrl(`http://localhost/${domain}/database`, locationState), [domain, locationState]);
  useEffect(() => {
    if (!locationReady) return;
    const next = buildAnalysisUrl(window.location.href, locationState);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== next) window.history.replaceState(window.history.state, "", next);
  }, [locationReady, locationState]);

  useEffect(() => {
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = window.setTimeout(() => {
      searchTimeoutRef.current = null;
      setCommittedSearch(search.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = null;
    };
  }, [search]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const commitPendingSearch = useCallback(() => {
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = null;
    setCommittedSearch(search.trim());
  }, [search]);

  const invalidateQueryInteractions = useCallback(() => {
    setSelected((previous) => previous.size === 0 ? previous : new Set());
    setEditingId(null);
    setDetailRecord(null);
    setAnalysis((previous) => previous.plotIds === null ? previous : { ...previous, plotIds: null });
  }, []);

  const changeStatus = useCallback((next: RecordStatus) => {
    invalidateQueryInteractions();
    commitPendingSearch();
    window.history.replaceState(window.history.state, "", databaseStatusUrl(window.location.href, next));
    setStatus(next);
  }, [commitPendingSearch, invalidateQueryInteractions]);

  const changeFacet = useCallback((next: string) => {
    invalidateQueryInteractions();
    commitPendingSearch();
    setFacet(next);
  }, [commitPendingSearch, invalidateQueryInteractions]);

  const changePaper = useCallback((next: string) => {
    invalidateQueryInteractions();
    commitPendingSearch();
    setPaper(next);
  }, [commitPendingSearch, invalidateQueryInteractions]);

  const changeSearch = useCallback((next: string) => {
    invalidateQueryInteractions();
    setSearch(next);
  }, [invalidateQueryInteractions]);

  const applyStructureSearch = useCallback((next: StructureSearchValue) => {
    invalidateQueryInteractions();
    commitPendingSearch();
    setStructureSearch(next);
    setStructureDialogOpen(false);
  }, [commitPendingSearch, invalidateQueryInteractions]);

  const clearStructureSearch = useCallback(() => {
    invalidateQueryInteractions();
    commitPendingSearch();
    setStructureSearch(null);
  }, [commitPendingSearch, invalidateQueryInteractions]);

  const toggle = (id: string) => {
    if (!queryReady) return;
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  /** Select/deselect the currently displayed records in one group. */
  const toggleGroup = (recs: AnyRecord[]) => {
    if (!queryReady) return;
    setSelected((prev) => {
      const next = new Set(prev);
      const allIn = recs.every((r) => next.has(r.id));
      for (const r of recs) allIn ? next.delete(r.id) : next.add(r.id);
      return next;
    });
  };

  const refreshCurrentQuery = useCallback(() => {
    setLoadedQuery(null);
    setRefreshVersion((version) => version + 1);
  }, []);

  const deleteSelected = async () => {
    if (!queryReady || selectedRecords.length === 0 || mutationBusy) return;
    const ids = selectedRecords.map((record) => record.id);
    setMutationBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${domain}/records/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      await requireOk(response, "Could not delete the selected records.");
      const deletedIds = new Set(ids);
      setComparisonRecords((previous) => previous.filter((record) => !deletedIds.has(record.id)));
      setDetailRecord((previous) => previous && deletedIds.has(previous.id) ? null : previous);
      setNotice(`${status === "review" ? "Rejected" : "Deleted"} ${ids.length} record${ids.length === 1 ? "" : "s"}.`);
      refreshCurrentQuery();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not delete the selected records.");
    } finally {
      setMutationBusy(false);
    }
  };

  const approve = async (id: string) => {
    if (!queryReady || mutationBusy) return;
    setMutationBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "official" }),
      });
      await requireOk(response, "Could not approve this record.");
      setNotice("Record approved.");
      refreshCurrentQuery();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not approve this record.");
    } finally {
      setMutationBusy(false);
    }
  };

  const quickEdit = async (id: string, field: string, value: string): Promise<boolean> => {
    if (!queryReady || mutationBusy) return false;
    setMutationBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setField: { field, value } }),
      });
      await requireOk(response, "Could not save this field.");
      setNotice(`${field} updated.`);
      refreshCurrentQuery();
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this field.");
      return false;
    } finally {
      setMutationBusy(false);
    }
  };

  const reject = async (id: string) => {
    if (!queryReady || mutationBusy) return;
    setMutationBusy(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`, { method: "DELETE" });
      await requireOk(response, "Could not reject this record.");
      setComparisonRecords((previous) => previous.filter((record) => record.id !== id));
      setNotice("Record rejected.");
      refreshCurrentQuery();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not reject this record.");
    } finally {
      setMutationBusy(false);
    }
  };

  const approveSelected = async () => {
    if (!queryReady || readySelected.length === 0 || mutationBusy) return;
    setMutationBusy(true);
    setNotice(null);
    try {
      const results = await Promise.allSettled(
        readySelected.map((record) =>
          fetch(`/api/${domain}/records/${encodeURIComponent(record.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "official" }),
          })
        )
      );
      const ok = results.filter((result) => result.status === "fulfilled" && result.value.ok).length;
      const failed = results.length - ok;
      const parts = [`Approved ${ok} record${ok === 1 ? "" : "s"}`];
      if (mockSelectedCount > 0) parts.push(`${mockSelectedCount} skipped (mock demo)`);
      if (incompleteSelectedCount > 0) parts.push(`${incompleteSelectedCount} skipped (incomplete core fields)`);
      if (failed > 0) parts.push(`${failed} failed`);
      setNotice(parts.join(" · "));
      refreshCurrentQuery();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not approve the selected records.");
    } finally {
      setMutationBusy(false);
    }
  };

  const variableFiltered = hasActiveFilters(filters) || (status === "official" && hasAnalysisFilters(analysis));
  const propertyFiltered = useMemo(
    () => applyRecordFilters(domain, records, filters),
    [domain, records, filters]
  );
  const qualityRecords = useMemo(() => applyAnalysisFilters(propertyFiltered, analysisFields, { ...analysis, evidence: "all" }), [propertyFiltered, analysisFields, analysis]);
  const analysisRecords = useMemo(() => status === "official" ? applyAnalysisFilters(propertyFiltered, analysisFields, analysis) : propertyFiltered, [propertyFiltered, analysisFields, analysis, status]);
  const visible = useMemo(() => {
    if (status === "review") return propertyFiltered;
    const selectedRecords = analysis.plotIds === null ? analysisRecords : analysisRecords.filter((record) => plotIds.has(record.id));
    return sortAnalysisRecords(selectedRecords, analysisFields, analysis.sort);
  }, [status, propertyFiltered, analysisRecords, analysis.plotIds, analysis.sort, analysisFields, plotIds]);
  const anyFilters = variableFiltered || paper !== "all" || facet !== "all" || Boolean(search.trim()) || Boolean(structureSearch);
  const clearAllFilters = () => {
    invalidateQueryInteractions();
    if (searchTimeoutRef.current != null) window.clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = null;
    setSearch(""); setCommittedSearch(""); setPaper("all"); setFacet("all");
    setStructureSearch(null); setFilters(EMPTY_FILTERS); setVisibleLimit(VISIBLE_BATCH_SIZE);
    setAnalysis((previous) => ({ ...previous, constraints: [], evidence: "all", method: "", context: "", plotIds: null }));
  };
  const filtered = variableFiltered;
  const displayedRecords = useMemo(
    () => status === "review" ? visible : takeVisibleRecords(visible, visibleLimit),
    [status, visible, visibleLimit]
  );
  const groups = useMemo(() => groupRecords(displayedRecords, groupByPaper), [displayedRecords, groupByPaper]);
  const stats = useMemo(() => mod.listStats(visible), [mod, visible]);
  const sourceCount = useMemo(() => new Set(visible.map((r) => r.paper?.title)).size, [visible]);
  const selectedRecords = useMemo(
    () => selectedDisplayedRecords(displayedRecords, selected),
    [displayedRecords, selected]
  );
  const mockSelectedCount = useMemo(
    () => selectedRecords.filter(isMockExtractionRecord).length,
    [selectedRecords]
  );
  const incompleteSelectedCount = useMemo(
    () => selectedRecords.filter((r) => !isMockExtractionRecord(r) && !mod.coreCompleteness(r).complete).length,
    [selectedRecords, mod]
  );
  const readySelected = useMemo(
    () => selectedRecords.filter((r) => !isMockExtractionRecord(r) && mod.coreCompleteness(r).complete),
    [selectedRecords, mod]
  );

  const changeFilters = useCallback((next: RecordFilters) => {
    setFilters(next);
    setVisibleLimit(VISIBLE_BATCH_SIZE);
    setAnalysis((previous) => ({ ...previous, plotIds: null }));
  }, []);

  const changeAnalysis = useCallback((next: AnalysisState) => {
    setAnalysis(next); setVisibleLimit(VISIBLE_BATCH_SIZE);
  }, []);
  const toggleCompare = useCallback((record: AnalysisRecord) => {
    if (!queryReady) return;
    if (!compareIds.has(record.id) && comparisonRecords.length >= 6) {
      setNotice("Compare up to 6 records. Remove one to add another."); return;
    }
    setComparisonRecords((previous) => previous.some((item) => item.id === record.id) ? previous.filter((item) => item.id !== record.id) : [...previous, record]);
  }, [queryReady, compareIds, comparisonRecords.length]);
  const closeDetail = useCallback(() => { setDetailRecord(null); setEditingId(null); }, []);
  const refreshAnalysisRecord = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/${domain}/records/${encodeURIComponent(id)}`);
      if (response.status === 404) {
        setComparisonRecords((previous) => previous.filter((record) => record.id !== id));
        setDetailRecord((previous) => previous?.id === id ? null : previous);
        return;
      }
      await requireOk(response, "Could not refresh this record.");
      const data = await response.json() as { record: AnalysisRecord };
      setComparisonRecords((previous) => previous.map((record) => record.id === id ? data.record : record));
      setDetailRecord((previous) => previous?.id === id ? data.record : previous);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not refresh this record."); }
  }, [domain]);
  const openDetail = useCallback((record: AnalysisRecord) => {
    if (!queryReady) return;
    setDetailRecord(record); setEditingId(null);
  }, [queryReady]);
  // Retain the comparison basket across filters, refreshing records whenever
  // their current query supplies newer data. It is separate from bulk actions.
  useEffect(() => {
    if (!queryReady) return;
    const byId = new Map(records.map((record) => [record.id, record]));
    setComparisonRecords((previous) => {
      const next = previous.map((record) => byId.get(record.id) ?? record);
      return next.every((record, index) => record === previous[index]) ? previous : next;
    });
    setDetailRecord((previous) => previous && byId.has(previous.id) ? byId.get(previous.id)! : previous);
  }, [records, queryReady]);

  const exportVisible = async () => {
    if (!queryReady || visible.length === 0 || exporting) return;
    setExporting(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/${domain}/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: visible.map((record) => record.id) }),
      });
      await requireOk(response, "Could not export the visible records.");
      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? `ioniclink-${domain}-${status}.csv`;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setNotice(`Exported ${visible.length} visible record${visible.length === 1 ? "" : "s"}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not export the visible records.");
    } finally {
      setExporting(false);
    }
  };

  // Bulk actions apply only to cards currently rendered by this pagination slice.
  useEffect(() => {
    setSelected((prev) => {
      if (!queryReady) return prev.size === 0 ? prev : new Set();
      const next = pruneSelectionToDisplayed(prev, displayedRecords);
      return next.size === prev.size ? prev : next;
    });
    if (!queryReady) setEditingId(null);
  }, [displayedRecords, queryReady]);
  const recordUnits = status === "official" ? analysis.units : recordListUnitsForStatus(status, units);
  const conditionItemsOf = useCallback((r: AnyRecord) => {
    const items = [...mod.systemFacets(r, recordUnits), ...mod.conditionItems(r, recordUnits)];
    return items.filter((item, index) => items.findIndex((other) => other.label === item.label) === index);
  }, [mod, recordUnits]);

  return (
    <div
      data-testid="database-workbench-shell"
      aria-busy={refreshing}
      className="panel overflow-hidden"
    >
      {/* ── header ── */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 px-5 py-4">
        <div className="flex items-center gap-3">
          <DbIcon />
          <div className="leading-tight">
            <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Database</h1>

          </div>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-2 sm:flex sm:w-auto">
          <Link href={`/${domain}/library`} className="btn min-w-0 justify-center whitespace-nowrap px-2 sm:px-3" title="Manage source documents and all linked records">
            <span className="sm:hidden">Documents</span>
            <span className="hidden sm:inline">Manage documents</span>
          </Link>
          <button
            type="button"
            onClick={exportVisible}
            disabled={!queryReady || visible.length === 0 || exporting}
            title={!queryReady ? "Wait for the current database query to finish loading" : undefined}
            className="btn min-w-0 justify-center whitespace-nowrap px-2 disabled:cursor-not-allowed disabled:opacity-40 sm:px-3"
          >
            <DownloadIcon />
            <span className="sm:hidden">{exporting ? "Exporting…" : `Export ${visible.length}`}</span>
            <span className="hidden sm:inline">{exporting ? "Exporting…" : `Export visible (${visible.length})`}</span>
          </button>
          <Link
            href={`/${domain}`}
            aria-label="Close database"
            className="grid h-11 w-11 place-items-center rounded-[2px] border border-ink-300 text-lg text-ink-600 transition hover:border-ink-950 hover:text-ink-950"
          >
            ✕
          </Link>
        </div>
      </div>

      {/* ── tabs + at-a-glance stats ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-200 bg-ink-50 px-5 py-3">
        <div className="flex border border-ink-300 bg-white text-sm">
          <Tab active={status === "official"} onClick={() => changeStatus("official")}>
            Checked Database <Badge active={status === "official"}>{counts.official}</Badge>
          </Tab>
          <Tab active={status === "review"} onClick={() => changeStatus("review")}>
            Review Queue <Badge active={status === "review"} tone="amber">{counts.review}</Badge>
          </Tab>
        </div>
        <div className="flex flex-wrap items-stretch gap-0 border border-ink-200 bg-white">
          {stats.slice(0, 2).map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
          {stats.length > 2 && <details className="relative px-3 py-2"><summary className="cursor-pointer text-sm font-semibold text-ink-800">Statistics</summary><div className="absolute right-0 top-full z-30 flex border border-ink-200 bg-white p-2 shadow-lg">{stats.slice(2).map((s) => <Stat key={s.label} label={s.label} value={s.value} />)}</div></details>}
        </div>
      </div>

      {/* ── toolbar ── */}
      <div data-testid="database-command-bar" className="flex flex-wrap items-center gap-2.5 border-b border-ink-200 bg-white px-5 py-3">
        <div className="relative w-full sm:w-auto">
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => changeSearch(e.target.value)}
            placeholder="Search paper, cation, anion…"
            className="min-h-11 w-full min-w-0 rounded-[2px] border border-ink-300 bg-white py-2.5 pl-10 pr-3 text-base outline-none transition placeholder:text-ink-400 focus:border-brand-700 focus:ring-2 focus:ring-brand-100 sm:w-80"
          />
        </div>
        <button
          type="button"
          onClick={() => setStructureDialogOpen(true)}
          className={`inline-flex min-h-11 items-center gap-2 rounded-[2px] border px-4 py-2.5 text-sm font-semibold transition ${
            structureSearch
              ? "border-brand-300 bg-brand-50 text-brand-700"
              : "border-ink-200 bg-white text-ink-700 hover:border-brand-300 hover:text-brand-700"
          }`}
        >
          <StructureIcon /> Chemical Structure Search
        </button>
        {structureSearch ? (
          <button
            type="button"
            onClick={clearStructureSearch}
            title="Clear structure filter"
            className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[13px] font-semibold text-brand-700"
          >
            {structureTargetLabel(structureSearch.target)} · Exact match <span aria-hidden>×</span>
          </button>
        ) : null}
        {refreshing && !loading && (
          <span aria-live="polite" className="font-mono text-xs text-ink-400">
            Refreshing…
          </span>
        )}
        {status === "official" && <SourceFilter paper={paper} papers={papers} onChange={changePaper} />}
        <Segmented value={facet} onChange={changeFacet} options={mod.facet.options} />
        {status === "official" && analysis.view === "cards" && (
          <button
            onClick={() => {
              if (groupByPaper) setShowConditionsOverview(false);
              setGroupByPaper((g) => !g);
            }}
            className={`inline-flex items-center gap-1.5 rounded-[8px] border px-3 py-2 text-sm font-semibold tracking-wide transition-all ${
              groupByPaper
                ? "border-brand-200 bg-brand-50/60 text-brand-700"
                : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50 hover:text-brand-700"
            }`}
          >
            <BookIcon /> Group by paper
          </button>
        )}
        {status === "official" && analysis.view === "cards" && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-semibold text-ink-800">
            <input
              type="checkbox"
              checked={showConditionsOverview}
              onChange={(event) => {
                setShowConditionsOverview(event.target.checked);
                if (event.target.checked) setGroupByPaper(true);
              }}
              className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            Conditions overview
          </label>
        )}
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
        {queryReady && selectedRecords.length > 0 && (
          <div className="ml-auto flex items-center gap-2 text-sm">
            <span className="font-mono text-ink-700">{selectedRecords.length} selected</span>
            {status === "review" && (
              <button
                onClick={approveSelected}
                disabled={readySelected.length === 0 || mutationBusy}
                title={
                  readySelected.length === 0
                    ? mockSelectedCount > 0
                      ? "Mock demo records stay in Review and cannot be published"
                      : "None of the selected records have complete core fields"
                    : "Approve every selected non-mock record whose core fields are complete"
                }
                className="inline-flex min-h-11 items-center gap-1.5 rounded-[2px] bg-brand-700 px-4 py-2.5 font-semibold text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <CheckIcon /> Approve ready ({readySelected.length})
              </button>
            )}
            <button
              onClick={deleteSelected}
              disabled={mutationBusy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-[2px] border border-rose-300 bg-white px-4 py-2.5 font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <TrashIcon /> {status === "review" ? "Reject" : "Delete"}
            </button>
          </div>
        )}
      </div>

      {status === "official" && <>
        <AnalysisToolbar domain={domain} state={analysis} onChange={changeAnalysis} viewUrl={viewUrl}
          onRestore={(url) => restoreLocation(new URL(url, window.location.origin).search)}
          onSnapshot={() => { downloadAnalysisSnapshot(domain, visible, locationState); setNotice(`Saved ${visible.length} records with conditions, provenance and view settings.`); }}
          disabled={!queryReady} />
      </>}

      {/* ── variable filters ── */}
      {!loading && records.length > 0 && (
        <FilterBar showSummary={false} domain={domain} records={records} filters={filters} shown={visible.length} onChange={changeFilters} />
      )}
      {status === "official" && <AnalysisFilters records={records} fields={analysisFields} state={analysis} onChange={changeAnalysis} />}

      {anyFilters && <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-2 text-sm">
        <span aria-live="polite">{queryReady ? `${visible.length} of ${counts[status]} records` : "Updating results…"}</span>
        <button type="button" onClick={clearAllFilters} className="rounded px-2 py-1 font-semibold text-brand-800 hover:bg-brand-50">Clear filters</button>
      </div>}

      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="mx-4 mt-3 flex items-center justify-between rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"
        >
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-amber-500 hover:text-amber-700">✕</button>
        </div>
      )}

      {status === "official" && !loading && <div className="space-y-3 border-b border-ink-100 p-4">
        <DatabaseQuality domain={domain} records={qualityRecords} fields={analysisFields} evidenceFilter={analysis.evidence}
          onEvidenceFilterChange={(evidence) => changeAnalysis({ ...analysis, evidence, plotIds: null })} />
        {comparisonRecords.length > 0 && <RecordComparison domain={domain} records={comparisonRecords} fields={analysisFields} units={analysis.units}
          onRemove={(id) => setComparisonRecords((previous) => previous.filter((record) => record.id !== id))}
          onClear={() => setComparisonRecords([])} onOpenRecord={openDetail} />}
      </div>}

      {status === "official" && !loading && analysis.view === "plot" && <div className="border-b border-ink-200 p-4">
        <DatabaseScatterPlot records={analysisRecords} fields={analysisFields} config={analysis.plot}
          onConfigChange={(plot) => changeAnalysis({ ...analysis, plot, plotIds: null })}
          selectedIds={plotIds} onSelectRecords={(ids) => changeAnalysis({ ...analysis, plotIds: ids })}
          onOpenRecord={openDetail} onToggleCompare={toggleCompare} compareIds={compareIds} disabled={!queryReady} />
      </div>}
      {status === "official" && !loading && analysis.plotIds !== null && <p role="status" className="border-b border-ink-200 px-4 py-3 text-sm text-brand-800">Plot selection: {visible.length} matching records. The table and exports use this selection.
          <button type="button" onClick={() => changeAnalysis({ ...analysis, plotIds: null })} className="ml-3 underline">Clear plot selection</button>
      </p>}

      {/* ── records ── */}
      <div className={status === "review" && !loading && visible.length > 0 ? "" : "space-y-5 p-4"}>
        {loading ? (
          <div className="space-y-3">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : visible.length === 0 ? (
          <Empty>
            {records.length > 0 && variableFiltered ? (
              <span className="inline-flex flex-col items-center gap-2">
                <span>No records match the variable filters.</span>
                <button
                  onClick={clearAllFilters}
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
              "No checked records yet. Approve candidates from the Review Queue."
            )}
          </Empty>
        ) : status === "review" ? (
          <ReviewWorkbench
            domain={domain}
            records={displayedRecords}
            units={recordUnits}
            clientModule={mod}
            queryReady={queryReady}
            mutationBusy={mutationBusy}
            selected={selected}
            editingId={editingId}
            onToggle={toggle}
            onEdit={setEditingId}
            onQuickEdit={quickEdit}
            onApprove={approve}
            onReject={reject}
            editor={editingId ? (() => {
              const record = displayedRecords.find((candidate) => candidate.id === editingId);
              return record ? (
                <Editor
                  record={record}
                  domain={domain}
                  onSaved={() => {
                    setEditingId(null);
                    refreshCurrentQuery();
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : null;
            })() : null}
          />
        ) : analysis.view !== "cards" ? (
          <>
            <DatabaseTable domain={domain} records={displayedRecords} fields={analysisFields} columns={analysis.columns}
              onColumnsChange={(columns) => changeAnalysis({ ...analysis, columns })} sort={analysis.sort}
              onSortChange={(sort) => changeAnalysis({ ...analysis, sort })} units={analysis.units} density={analysis.density}
              compareIds={compareIds} onToggleCompare={toggleCompare} onOpenRecord={openDetail} disabled={!queryReady} />
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-500">
              <span>{displayedRecords.length} shown · {visible.length} matching records</span>
              {displayedRecords.length < visible.length && <button type="button" className="btn" onClick={() => setVisibleLimit((limit) => limit + VISIBLE_BATCH_SIZE)}>Load more ({visible.length - displayedRecords.length} remaining)</button>}
            </div>
          </>
        ) : (
          <>
            {groups.map((group, gi) => (
            <section
              key={group.key}
              className="animate-[row-rise_460ms_cubic-bezier(0.22,1,0.36,1)_both]"
              style={{ animationDelay: `${Math.min(gi, 8) * 55}ms` }}
            >
              {groupByPaper && (
                <div className="mb-3 flex items-end justify-between gap-3 border-b border-ink-100 pb-2">
                  <div className="flex min-w-0 items-baseline gap-2.5">
                    {queryReady && (
                      <input
                        type="checkbox"
                        checked={group.records.every((r) => selected.has(r.id))}
                        onChange={() => toggleGroup(group.records)}
                        className="h-4 w-4 translate-y-0.5 cursor-pointer rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                        aria-label={`Select displayed records from ${group.title}`}
                        title="Select the currently displayed records from this source"
                      />
                    )}
                    <BookIcon className="shrink-0 translate-y-0.5 text-brand-600" />
                    <PaperTitle title={group.title} />
                    {group.meta && (
                      <span
                        className="hidden min-w-0 max-w-[22rem] shrink truncate rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-500 sm:inline"
                        title={group.meta}
                      >
                        {group.meta}
                      </span>
                    )}
                  </div>

                </div>
              )}
              <div className="mb-5 last:mb-0">
                  {groupByPaper && showConditionsOverview && group.records.length > 1 && (
                    <GroupConditionsStrip
                      records={group.records}
                      itemsOf={conditionItemsOf}
                      domain={domain}
                    />
                  )}
                  <div className="space-y-3">
                    {group.records.map((rec) =>
                  queryReady && editingId === rec.id ? (
                    <Editor
                      key={rec.id}
                      record={rec}
                      domain={domain}
                      onSaved={() => {
                        setEditingId(null);
                        void refreshAnalysisRecord(rec.id);
                        refreshCurrentQuery();
                      }}
                      onCancel={() => setEditingId(null)}
                    />
                  ) : (
                    <Card
                      compact
                      key={rec.id}
                      record={rec}
                      comparisonRecords={domain === "conductivity" ? group.records : undefined}
                      domain={domain}
                      units={recordUnits}
                      selected={queryReady && selected.has(rec.id)}
                      onToggle={queryReady ? toggle : undefined}
                      actions={
                        queryReady ? <>
                          <button type="button" onClick={() => toggleCompare(rec)} aria-pressed={compareIds.has(rec.id)} className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-800">{compareIds.has(rec.id) ? "In comparison" : "Compare"}</button>
                          <button
                            onClick={() => setEditingId(rec.id)}
                            disabled={mutationBusy}
                            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Edit
                          </button>
                        </> : undefined
                      }
                    />
                  )
                )}
                  </div>
                </div>
            </section>
            ))}
            {displayedRecords.length < visible.length && (
              <div className="flex justify-center pt-1">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((limit) => limit + VISIBLE_BATCH_SIZE)}
                  className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-xs font-semibold text-ink-700 transition hover:border-brand-300 hover:text-brand-700"
                >
                  Load more ({visible.length - displayedRecords.length} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── footer ── */}
      <div className="flex items-center justify-between border-t border-ink-200 bg-ink-50 px-5 py-3 font-mono text-sm text-ink-600">
        <span>
          {displayedRecords.length === 0 ? "0" : `1–${displayedRecords.length}`} of {visible.length} record
          {visible.length === 1 ? "" : "s"}
          {filtered && ` · filtered from ${records.length}`}
        </span>
        <span>
          {sourceCount} source{sourceCount === 1 ? "" : "s"}
          {paper !== "all" && ` · filtered from ${papers.length}`}
        </span>
      </div>
      <StructureSearchDialog
        open={structureDialogOpen}
        value={structureSearch}
        onApply={applyStructureSearch}
        onClose={() => setStructureDialogOpen(false)}
      />
      {detailRecord && status === "official" && <RecordDetailPanel recordId={detailRecord.id} onClose={closeDetail}>
        {editingId === detailRecord.id ? <Editor record={detailRecord} domain={domain} onSaved={() => { setEditingId(null); void refreshAnalysisRecord(detailRecord.id); refreshCurrentQuery(); }} onCancel={() => setEditingId(null)} /> :
          <Card record={detailRecord} domain={domain} units={analysis.units} actions={<>
            <button type="button" className="btn" onClick={() => toggleCompare(detailRecord)} disabled={!queryReady}>{compareIds.has(detailRecord.id) ? "Remove from comparison" : "Add to comparison"}</button>
            <button type="button" className="btn" onClick={() => setEditingId(detailRecord.id)} disabled={!queryReady || mutationBusy}>Edit</button>
          </>} />}
      </RecordDetailPanel>}
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

/** Shared context and a record-aligned comparison of changing conditions. */
export function GroupConditionsStrip({
  records,
  itemsOf,
  domain,
  omitLabels,
}: {
  records: AnyRecord[];
  itemsOf: (record: AnyRecord) => ConditionItem[];
  domain: Domain;
  omitLabels?: Set<string>;
}) {
  const analyzed = useMemo(() => analyzeGroupConditions(records, itemsOf), [records, itemsOf]);
  const shared = analyzed.shared.filter((s) => !omitLabels?.has(s.item.label));
  const varying = analyzed.varying.filter((v) => !omitLabels?.has(v.label));
  const sideBySide = varying.length > 0 && varying.length <= 2 && shared.length > 0;
  if (shared.length === 0 && varying.length === 0) return null;

  const valueOf = (item: ConditionItem, recordId?: string, sourceId?: string) => {
    const prov = item.prov;
    const value = <span className="whitespace-pre-wrap break-words">{item.value.replaceAll(" · ", ", ")}</span>;
    return prov ? (
      <button
        type="button"
        data-testid="evidence-click-target"
        className="rounded text-left underline decoration-brand-300 underline-offset-4 hover:decoration-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        aria-label={`Open evidence for ${item.field ?? item.label} in ${recordId}`}
        title={item.title ?? "View source evidence"}
        onClick={() => openRecordEvidence({ sourceId, recordId, field: item.field ?? item.label, value: item.value, prov, domain })}
      >{value}</button>
    ) : <span title={item.title}>{value}</span>;
  };

  return (
    <div data-testid="group-conditions" className={`mb-5 overflow-hidden rounded-xl border border-ink-200 bg-white ${sideBySide ? "xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : ""}`}>
      {varying.length > 0 && (
        <section aria-label="Conditions that vary by record" className="p-4 sm:p-5">
          <h3 className="mb-3 text-lg font-bold text-ink-950">Varies by record</h3>
          <div className="max-h-72 overflow-auto rounded-lg border border-ink-200" tabIndex={0} role="region" aria-label="Variable conditions comparison">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Changing operating conditions for each record</caption>
              <thead className="sticky top-0 z-10 bg-violet-50">
                <tr>
                  <th scope="col" className="px-4 py-3">Record</th>
                  {varying.map((v) => <th scope="col" key={v.label} className="px-4 py-3"><span className="font-bold text-violet-800">{v.label}</span></th>)}
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const items = itemsOf(record);
                  return (
                    <tr key={record.id} className="border-t border-ink-100 hover:bg-violet-50/40">
                      <th scope="row" className="whitespace-nowrap px-4 py-3 font-mono text-sm font-semibold text-ink-800">{record.id}</th>
                      {varying.map((v) => {
                        const item = items.find((candidate) => candidate.label === v.label);
                        return <td key={v.label} className="min-w-36 px-4 py-3 font-mono text-lg font-bold text-violet-900">{item ? valueOf(item, record.id, record.sourceId) : <span className="font-sans text-sm font-medium text-ink-700">Not reported</span>}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {shared.length > 0 && (
        <section aria-label="Shared conditions" className={`p-4 sm:p-5 ${varying.length ? "border-t border-ink-200" : ""} ${sideBySide ? "xl:border-l xl:border-t-0" : ""}`}>
          <h3 className="mb-4 text-lg font-bold text-ink-950">Shared conditions</h3>
          <dl className={`grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 ${sideBySide ? "" : "xl:grid-cols-4"}`}>
            {shared.map((s) => (
              <div key={s.item.label} className="min-w-0">
                <dt className="mb-1 text-sm font-medium text-ink-700">{s.item.label}</dt>
                <dd className="font-mono text-base font-semibold text-ink-950">{valueOf(s.item, s.recordId, s.sourceId)}</dd>
                {s.coverage < s.total && <dd className="mt-1 text-sm font-medium text-amber-800">Reported in {s.coverage} of {s.total} records</dd>}
              </div>
            ))}
          </dl>
        </section>
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

export function PaperTitle({ title }: { title: string }) {
  const [expanded, setExpanded] = useState(false);
  return <h2 className="min-w-0 font-serif text-base font-semibold leading-snug text-ink-900"><button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} paper title: ${title}`} onClick={() => setExpanded(!expanded)} className={`rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${expanded ? "break-words" : "line-clamp-2"}`}>{title}</button></h2>;
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
        className={`flex items-center gap-1.5 rounded-lg border bg-white py-2 pl-3 pr-2 text-sm shadow-sm transition ${
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
          <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-xs font-semibold leading-none text-ink-500">
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
                className="w-full rounded-lg border border-ink-200 bg-ink-50/50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-brand-300 focus:bg-white focus:ring-2 focus:ring-brand-100"
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
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition ${
                      i === highlight ? "bg-brand-50/70" : ""
                    } ${isSelected ? "font-semibold text-brand-700" : "font-medium text-ink-700"}`}
                  >
                    <span className="grid w-3.5 shrink-0 place-items-center text-brand-600">{isSelected && <CheckIcon />}</span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    <span className="shrink-0 rounded-full border border-ink-100 bg-ink-50 px-1.5 py-0.5 font-mono text-xs font-semibold leading-none text-ink-500">
                      {item.n}
                    </span>
                  </button>
                </li>
              );
            })}
            {matches.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-400">No source matches “{query}”</li>
            )}
          </ul>
          <div className="border-t border-ink-100 bg-ink-50/40 px-3 py-2 font-mono text-xs font-medium text-ink-400">
            {query ? `${matches.length} of ${papers.length} sources` : `${papers.length} sources`}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-24 items-center gap-2 border-l border-ink-200 bg-white px-3 py-2 first:border-l-0">
      <div>
        <div className="text-xs font-semibold uppercase leading-none tracking-[0.08em] text-ink-600">{label}</div>
        <div className="mt-2 font-mono text-base font-bold leading-none tabular-nums text-ink-950">{value}</div>
      </div>
    </div>
  );
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-11 items-center gap-2 border-r border-ink-300 px-4 py-2.5 text-sm font-semibold transition last:border-r-0 ${
        active ? "bg-ink-950 text-white" : "text-ink-800 hover:bg-ink-100 hover:text-brand-800"
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
  return <span className={`rounded-[2px] px-2 py-0.5 font-mono text-xs font-bold leading-none tabular-nums ${cls}`}>{children}</span>;
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
    <div className="flex rounded-[2px] border border-ink-300 bg-white p-0.5 text-sm">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`inline-flex min-h-10 items-center gap-1.5 rounded-[1px] px-3.5 py-2 font-semibold transition ${
            value === o.value ? "bg-ink-950 text-white" : "text-ink-800 hover:bg-ink-100 hover:text-brand-800"
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
    <span className="grid h-11 w-11 place-items-center rounded-[2px] bg-brand-700 text-white">
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
function StructureIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="m8 4 4-2 4 2v5l-4 2-4-2V4Zm0 5-4 2v5l4 2 4-2v-5M16 9l4 2v5l-4 2-4-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
