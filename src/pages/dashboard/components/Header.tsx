/**
 * Header — Top navigation bar matching StockBooster design
 */
export default function Header() {
  return (
    <header className="w-full bg-bg-secondary/80 backdrop-blur-md border-b border-border sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
        {/* Left — Logo + Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 border border-accent/20">
            <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-semibold text-text-primary tracking-tight">
              Подбор тем
            </h1>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-xs font-medium text-amber-400">
              Adobe Stock
            </span>
          </div>
        </div>

        {/* Right — Branding */}
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted hidden sm:block">
            StockBooster Extension
          </span>
          <div className="w-px h-5 bg-border" />
          <span className="text-xs font-medium text-text-secondary">v1.0.0</span>
        </div>
      </div>
    </header>
  );
}
