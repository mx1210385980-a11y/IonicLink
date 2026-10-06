export default function DomainLoading() {
  return (
    <main
      data-testid="domain-route-loading"
      aria-busy="true"
      aria-label="Loading workspace"
      className="mx-auto w-full max-w-6xl px-4 pb-12 pt-6 sm:px-6 lg:px-8"
    >
      <div className="animate-pulse overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-ink-100 px-5 py-4">
          <span className="h-9 w-9 rounded-lg bg-brand-100" />
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-ink-100" />
            <div className="h-3 w-64 max-w-full rounded bg-ink-50" />
          </div>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div className="h-40 rounded-xl bg-ink-50" />
          <div className="h-40 rounded-xl bg-ink-50" />
        </div>
      </div>
      <p className="sr-only">Loading the selected IonicLink workspace.</p>
    </main>
  );
}
