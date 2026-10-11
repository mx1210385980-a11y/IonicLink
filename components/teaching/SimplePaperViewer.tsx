"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { requestJson } from "@/components/request";

export function SimplePaperViewer() {
  const [pages, setPages] = useState<Array<{ page: number; text: string }>>([]);
  const [page, setPage] = useState(1); const [text, setText] = useState(false); const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    void requestJson<{ pages: Array<{ page: number; text: string }> }>("/api/teaching/lab/paper?format=text", undefined, "Could not load source")
      .then((value) => { if (active) setPages(value.pages); }).catch((cause) => { if (active) setError(cause.message); });
    return () => { active = false; };
  }, []);
  function turn(next: number) { setPage(next); setLoading(true); setError(""); }
  return <section aria-label="Teaching paper source" className="min-w-0 overflow-hidden rounded-lg border border-ink-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-200 px-3 py-2 text-xs">
      <div className="flex items-center gap-2"><button className="btn px-2" disabled={page <= 1} onClick={() => turn(page - 1)}>Previous page</button>
        <span className="tabular-nums">{page} / {pages.length || "…"}</span><button className="btn px-2" disabled={page >= pages.length} onClick={() => turn(page + 1)}>Next page</button></div>
      <button className="text-brand-700" onClick={() => setText(!text)}>{text ? "View page" : "View text"}</button>
    </div>
    <div className="h-[65vh] min-h-96 overflow-auto bg-ink-50 p-2">
      {error && <p role="alert" className="p-3 text-xs text-amber-700">{error}, Use Open PDF above to read the source.</p>}
      {text ? <div className="whitespace-pre-wrap break-words bg-white p-4 text-sm leading-7">{pages.find((item) => item.page === page)?.text || "Loading source text…"}</div>
        : <>{loading && <p className="p-3 text-xs text-ink-500">Loading page {page} …</p>}
          <Image key={page} src={`/api/teaching/lab/paper?format=page&page=${page}`} alt={`PaperNo. ${page} page`} width={900} height={1200} unoptimized
            className="h-auto w-full bg-white" onLoad={() => setLoading(false)} onError={() => { setLoading(false); setError("Could not load page image"); }} /></>}
    </div>
  </section>;
}
