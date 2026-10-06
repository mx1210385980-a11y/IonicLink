import Link from "next/link";
import { notFound } from "next/navigation";
import { listJobs, listRecords, listSourceSummaries } from "@/lib/db";
import { isDomain, type Domain } from "@/lib/domain";
import { getModule } from "@/lib/modules/registry.server";
import { SourceProgressTrack } from "@/components/library/LibraryProgress";
import { SourceThumb } from "@/components/SourceThumb";
import { DeleteLiteratureButton } from "@/components/library/DeleteLiteratureButton";
import { buildLibraryEntries, queryLibrary, libraryPageHref, type LibraryEntry, type LibraryParams, type LibraryRecord } from "@/components/library/libraryQuery";

export const dynamic = "force-dynamic";
const inputClass = "min-w-0 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm text-ink-800";

export default function LibraryPage({ params, searchParams = {} }: { params: { domain: string }; searchParams?: LibraryParams }) {
  if (!isDomain(params.domain)) notFound();
  const domain = params.domain;
  const mod = getModule(domain);
  const sources = listSourceSummaries(domain);
  const records = listRecords(domain);
  const entries = buildLibraryEntries(sources, records, listJobs(domain));
  const query = queryLibrary(entries, searchParams);
  const path = `/${domain}/library`;
  const years = [...new Set(entries.flatMap(entry=>entry.years))].sort((a,b)=>b-a);
  const active = Boolean(query.q || query.year || query.state !== "all" || query.scope !== "all");
  return <div className="min-w-0 space-y-4 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="label-eyebrow">Literature library · {mod.label}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="mt-2 text-sm text-ink-600">{entries.length} literature entries · {records.length} records</p></div>
      <div className="flex flex-wrap gap-2"><Link href={`/${domain}/database`} className="btn">Open database</Link><Link href={`/${domain}/extract`} className="btn btn-primary">Upload documents</Link></div>
    </header>
    <form key={[query.q,query.state,query.scope,query.year,query.sort].join("|")} action={path} method="get" className="space-y-3 rounded-xl border border-ink-200 bg-white p-4" aria-label="Search literature">
      <div className="flex flex-wrap gap-2"><label className="min-w-0 flex-1 basis-64"><span className="sr-only">Search literature</span><input type="search" name="q" defaultValue={query.q} maxLength={300} placeholder="Title, DOI, journal, filename or record ID…" className={`${inputClass} w-full`} /></label><button className="btn btn-primary" type="submit">Search</button>{active && <Link href={path} className="btn">Clear filters</Link>}</div>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-xs text-ink-600">Record status<select name="state" defaultValue={query.state} className={inputClass}><option value="all">All statuses</option><option value="review">Awaiting review</option><option value="mixed">Partially checked</option><option value="checked">All records checked</option><option value="empty">No records</option></select></label>
        <label className="grid gap-1 text-xs text-ink-600">Source<select name="scope" defaultValue={query.scope} className={inputClass}><option value="all">All sources</option><option value="pdf">Indexed PDF</option><option value="unlinked">Without indexed PDF</option></select></label>
        <label className="grid gap-1 text-xs text-ink-600">Publication year<select name="year" defaultValue={query.year} className={inputClass}><option value="">All years</option>{query.year && !years.includes(Number(query.year)) && <option value={query.year}>{query.year}</option>}{years.map(year=><option key={year} value={year}>{year}</option>)}</select></label>
        <label className="grid gap-1 text-xs text-ink-600">Sort by<select name="sort" defaultValue={query.sort} className={inputClass}><option value="newest">Recently added</option><option value="year">Publication year: newest</option><option value="title">Title: A–Z</option><option value="records">Most records</option><option value="review">Most awaiting review</option></select></label>
      </div>
      <p className="text-xs text-ink-500">Apply filters with Search. Missing publication metadata stays visible under All years.</p>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><p role="status">{query.total ? `${(query.page-1)*20+1}–${Math.min(query.page*20, query.total)}` : "0"} of {query.total} matching entries <span className="text-ink-500">· {entries.length} in collection</span></p><span className="text-xs text-ink-500">20 entries per page</span></div>
    <section aria-label="Literature results" className="min-w-0 space-y-3">
      {query.entries.map(entry=><LiteratureRow key={entry.id} domain={domain} entry={entry} headline={record=>mod.recordHeadline(record)} />)}
      {!query.entries.length && <div className="rounded-xl border border-dashed border-ink-200 bg-white px-6 py-12 text-center"><h2 className="font-semibold">{entries.length ? "No literature matches these filters" : "Your literature library is empty"}</h2><p className="mt-2 text-sm text-ink-600">{entries.length ? "Try a broader title, DOI or publication year." : "Upload a PDF to connect a paper with extracted records and evidence."}</p><Link className="btn mt-4" href={entries.length ? path : `/${domain}/extract`}>{entries.length ? "Clear filters" : "Upload documents"}</Link></div>}
    </section>
    {query.pages>1 && <nav aria-label="Literature pagination" className="flex items-center justify-between gap-3 py-2">{query.page>1 ? <Link className="btn" href={libraryPageHref(path,query,query.page-1)}>Previous</Link> : <span className="text-sm text-ink-400">Previous</span>}<span className="text-sm">Page {query.page} of {query.pages}</span>{query.page<query.pages ? <Link className="btn" href={libraryPageHref(path,query,query.page+1)}>Next</Link> : <span className="text-sm text-ink-400">Next</span>}</nav>}
  </div>;
}

function LiteratureRow({domain,entry,headline}:{domain:Domain;entry:LibraryEntry;headline:(record:LibraryRecord)=>string}) {
  const {records}=entry;
  const state = !records.length ? "No records" : entry.review ? entry.checked ? "Partially checked" : "Awaiting review" : "All records checked";
  const databaseHref = (title:string,status:"official"|"review")=>`/${domain}/database?${new URLSearchParams({paper:title,status})}`;
  return <article className="min-w-0 rounded-xl border border-ink-200 bg-white p-4" aria-label={entry.title}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-80"><h2 className="break-words text-base font-semibold leading-snug text-ink-900">{entry.title}</h2><p className="mt-1 break-words text-xs text-ink-600">{[entry.journals.join(" / "),entry.years.join(", ")].filter(Boolean).join(" · ") || "Publication metadata not available"}</p>
        {entry.sources.map(s=><p key={s.id} className="mt-1 truncate text-xs text-ink-400" title={s.filename}>{s.filename} · {s.pageCount} pages · Added {s.createdAt.slice(0,10)}</p>)}
        {entry.dois.map(doi=><a key={doi} href={`https://doi.org/${encodeURIComponent(doi)}`} target="_blank" rel="noreferrer" className="mt-1 block break-all text-xs text-brand-700 hover:underline">DOI: {doi}</a>)}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs"><span className={`rounded-full border px-2 py-1 ${entry.review ? "border-amber-200 bg-amber-50 text-amber-800" : "border-ink-200 text-ink-600"}`}>{state}</span>{!entry.sources.length && <span className="chip">No indexed PDF</span>}<span className="font-mono">{records.length} records</span></div>
    </div>
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
      {entry.sources.map(s=><a key={s.id} href={`/api/${domain}/source/${encodeURIComponent(s.id)}/pdf`} target="_blank" rel="noreferrer" className="font-semibold text-brand-700 hover:underline" title={s.filename}>{entry.sources.length>1 ? s.filename : "Open PDF"} ↗</a>)}
      {entry.titles.length===1 && <>{entry.checked>0 && <Link className="font-semibold text-brand-700 hover:underline" href={databaseHref(entry.titles[0],"official")}>Checked records ({entry.checked}) →</Link>}{entry.review>0 && <Link className="font-semibold text-amber-800 hover:underline" href={databaseHref(entry.titles[0],"review")}>Review records ({entry.review}) →</Link>}</>}
    </div>
    <details className="mt-3 border-t border-ink-100 pt-2"><summary className="cursor-pointer text-xs font-semibold text-ink-600">Records & document details</summary>
      <div className="mt-3 min-w-0 space-y-3">
        {entry.sources.map(s=><div key={s.id} className="flex gap-4"><SourceThumb id={s.id} filename={s.filename} domain={domain}/><div className="min-w-0 flex-1"><SourceProgressTrack records={s.records}/></div></div>)}
        {entry.titles.length>1 && <div className="space-y-1 text-xs"><p className="text-amber-800">Multiple paper titles are linked to this document. Open the matching title:</p>{entry.titles.map(title=><div key={title} className="flex flex-wrap gap-2"><span>{title}</span>{records.some(r=>r.paper.title===title && r.status==="official") && <Link className="text-brand-700 underline" href={databaseHref(title,"official")}>Checked records</Link>}{records.some(r=>r.paper.title===title && r.status==="review") && <Link className="text-amber-800 underline" href={databaseHref(title,"review")}>Review records</Link>}</div>)}</div>}
        {!!records.length && <ul className="grid max-h-72 gap-2 overflow-y-auto sm:grid-cols-2">{records.map(record=><li key={record.id} className="min-w-0 rounded border border-ink-100 bg-ink-50 px-3 py-2 text-xs"><Link href={databaseHref(record.paper.title,record.status)} className="flex flex-wrap justify-between gap-2 hover:underline"><span className="font-mono">{record.id} · {record.status==="official" ? "checked" : "review"}</span><span className="font-semibold text-brand-700">{headline(record)}</span></Link><p className="mt-1 truncate" title={`${record.core.ionicLiquid.cation} ${record.core.ionicLiquid.anion}`}>{record.core.ionicLiquid.cation} · {record.core.ionicLiquid.anion}</p></li>)}</ul>}
        {entry.sources.length<=1 ? <div className="flex justify-end border-t border-ink-100 pt-3"><DeleteLiteratureButton domain={domain} label={entry.sources[0]?.filename || entry.title} action={entry.sources[0] ? {kind:"source",sourceId:entry.sources[0].id,jobCount:entry.sources[0].jobs,recordCount:entry.sources[0].records.length} : {kind:"records",recordIds:records.map(r=>r.id)}}/></div>
          : entry.sources.map(s=><div key={s.id} className="flex justify-end border-t border-ink-100 pt-3"><DeleteLiteratureButton domain={domain} label={s.filename} action={{kind:"source",sourceId:s.id,jobCount:s.jobs,recordCount:s.records.length}}/></div>)}
      </div>
    </details>
  </article>;
}
