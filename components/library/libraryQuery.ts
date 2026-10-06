import type { DomainRecord } from "@/lib/domain";

export type LibraryRecord = DomainRecord<any, any>;
export interface LibrarySourceSummary { id: string; filename: string; pageCount: number; createdAt: string }
export interface LibrarySource extends LibrarySourceSummary { records: LibraryRecord[]; jobs: number }
export interface LibraryEntry {
  id: string; source?: LibrarySource; sources: LibrarySource[]; title: string; titles: string[];
  journals: string[]; years: number[]; dois: string[]; records: LibraryRecord[]; jobs: number; checked: number; review: number;
}
export type LibraryParams = Record<string, string | string[] | undefined>;
/** Group records by paper title so one entry equals one distinct paper, matching the homepage "Papers" count (listPapers). A paper indexed in several PDFs keeps all its sources. PDFs without any records are not shown here. */
export function buildLibraryEntries(sources: LibrarySourceSummary[], records: LibraryRecord[], jobs: { sourceId?: string }[]): LibraryEntry[] {
  const sourceById = new Map(sources.map(source => [source.id, source]));
  const jobCounts = new Map<string, number>();
  for (const job of jobs) if (job.sourceId) jobCounts.set(job.sourceId, (jobCounts.get(job.sourceId) || 0) + 1);
  const groups = new Map<string, { sources: LibrarySource[]; records: LibraryRecord[] }>();
  for (const record of records) {
    const key = record.paper.title || `unlinked:${record.paper.doi?.trim().toLowerCase() || record.id}`;
    let group = groups.get(key);
    if (!group) { group = { sources: [], records: [] }; groups.set(key, group); }
    group.records.push(record);
    const sourceId = record.sourceId;
    if (sourceId && sourceById.has(sourceId)) {
      let holder = group.sources.find(s => s.id === sourceId);
      if (!holder) { holder = { ...sourceById.get(sourceId)!, records: [], jobs: jobCounts.get(sourceId) || 0 }; group.sources.push(holder); }
      holder.records.push(record);
    }
  }
  return [...groups].map(([id, group]) => {
    const sorted = [...group.sources].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const titles = [...new Set(group.records.map(r => r.paper.title).filter(Boolean))];
    const source = sorted[0];
    return { id, source, sources: sorted, title: titles[0] || source?.filename || "Untitled", titles, records: group.records,
      journals: [...new Set(group.records.map(r => r.paper.journal).filter((v): v is string => Boolean(v)))],
      years: [...new Set(group.records.map(r => r.paper.year).filter((v): v is number => typeof v === "number" && Number.isFinite(v)))].sort((a,b)=>b-a),
      dois: [...new Set(group.records.map(r => r.paper.doi).filter((v): v is string => Boolean(v)))],
      jobs: group.sources.reduce((sum, s) => sum + s.jobs, 0), checked: group.records.filter(r=>r.status === "official").length,
      review: group.records.filter(r=>r.status === "review").length };
  });
}
export function queryLibrary(entries: LibraryEntry[], params: LibraryParams) {
  const single = (key: string) => typeof params[key] === "string" ? params[key] as string : "";
  const q = single("q").trim().slice(0, 300);
  const state = ["review", "checked", "empty", "mixed"].includes(single("state")) ? single("state") : "all";
  const scope = ["pdf", "unlinked"].includes(single("scope")) ? single("scope") : "all";
  const year = /^\d{4}$/.test(single("year")) ? single("year") : "";
  const sort = ["title", "year", "records", "review"].includes(single("sort")) ? single("sort") : "newest";
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter(e => {
    if (scope === "pdf" && !e.source || scope === "unlinked" && e.source) return false;
    if (state === "review" && !e.review || state === "checked" && (!e.checked || e.review) || state === "empty" && e.records.length || state === "mixed" && !(e.checked && e.review)) return false;
    if (year && !e.years.includes(Number(year))) return false;
    const text = [e.title, ...e.titles, e.source?.filename, ...e.journals, ...e.dois, ...e.dois.map(doi=>`https://doi.org/${doi}`), ...e.records.map(r=>r.id)].join(" ").toLowerCase();
    return tokens.every(token=>text.includes(token));
  }).sort((a,b) => {
    const order = sort === "title" ? a.title.localeCompare(b.title) : sort === "year" ? (b.years[0] || 0)-(a.years[0] || 0) : sort === "records" ? b.records.length-a.records.length : sort === "review" ? b.review-a.review : (b.source?.createdAt || "").localeCompare(a.source?.createdAt || "");
    return order || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const requested = Number(single("page"));
  const page = Number.isSafeInteger(requested) ? Math.min(pages, Math.max(1, requested)) : 1;
  return { q, state, scope, year, sort, page, pages, total: filtered.length, entries: filtered.slice((page-1)*20, page*20) };
}
export function libraryPageHref(path: string, query: ReturnType<typeof queryLibrary>, page: number) {
  const params = new URLSearchParams();
  for (const key of ["q", "state", "scope", "year", "sort"] as const) if (query[key]) params.set(key, query[key]);
  params.set("page", String(page));
  return `${path}?${params}`;
}
