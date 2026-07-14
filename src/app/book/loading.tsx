export default function BookLoading() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-amber-50/40 to-white">
      {/* Header skeleton — mirrors book page structure */}
      <header className="sticky top-0 z-40 border-b border-amber-100/60 bg-white/80 backdrop-blur-md px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-amber-100 animate-pulse" />
          <div className="h-5 w-24 rounded bg-amber-100 animate-pulse" />
        </div>
      </header>

      {/* Step indicator skeleton */}
      <nav className="flex items-center justify-center gap-2 px-4 py-3 overflow-x-auto" aria-label="訂位步驟">
        {["分店", "日期", "包廂", "時段", "資料"].map((step, i) => (
          <div key={step} className="flex items-center gap-2">
            <div className={`h-8 w-14 rounded-full animate-pulse ${i === 0 ? "bg-amber-200" : "bg-amber-50"}`} />
            {i < 4 && <div className="h-px w-4 bg-amber-100" />}
          </div>
        ))}
      </nav>

      {/* Content skeleton — card list */}
      <section className="px-4 py-6">
        <div className="h-5 w-20 rounded bg-amber-100 animate-pulse mb-4" />
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-amber-100/60 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 rounded-xl bg-amber-100 animate-pulse" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 rounded bg-amber-100 animate-pulse" />
                  <div className="h-3 w-48 rounded bg-amber-50 animate-pulse" />
                </div>
                <div className="h-8 w-16 rounded-lg bg-amber-100 animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Sr-only loading announcement */}
      <div role="status" className="sr-only">載入訂位頁面中…</div>
    </main>
  );
}
