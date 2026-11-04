/** Placeholder shown while a results list streams in (wrapped in <Suspense> by the listing pages). */
export function ResultsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-64 animate-pulse rounded-2xl bg-muted" />
        ))}
      </div>
      <span className="sr-only">Loading stores…</span>
    </div>
  );
}
