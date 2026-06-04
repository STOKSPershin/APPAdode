/**
 * ResultsPlaceholder — Empty state for the results area
 *
 * Shown when no search has been performed yet.
 * Will be replaced by ResultsTable component with actual data.
 */
export default function ResultsPlaceholder() {
  return (
    <div
      className="
        bg-bg-card border border-border border-dashed rounded-2xl
        p-12 flex flex-col items-center justify-center
        animate-fade-in
      "
      style={{ animationDelay: "200ms" }}
    >
      {/* Icon */}
      <div className="w-14 h-14 rounded-2xl bg-accent/8 border border-accent/15 flex items-center justify-center mb-5">
        <svg
          className="w-7 h-7 text-accent/50"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 3v11.25A2.25 2.25 0 0 0 6 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0 1 18 16.5h-2.25m-7.5 0h7.5m-7.5 0-1 3m8.5-3 1 3m0 0 .5 1.5m-.5-1.5h-9.5m0 0-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6"
          />
        </svg>
      </div>

      {/* Text */}
      <h3 className="text-base font-medium text-text-secondary mb-1.5">
        AI Результаты
      </h3>
      <p className="text-sm text-text-muted text-center max-w-sm leading-relaxed">
        Введите тему и нажмите{" "}
        <span className="text-accent font-medium">«Начать поиск»</span>{" "}
        для генерации подтем и анализа спроса на Adobe Stock
      </p>

      {/* Decorative dots */}
      <div className="flex items-center gap-1.5 mt-6">
        <div className="w-1.5 h-1.5 rounded-full bg-accent/20" />
        <div className="w-1.5 h-1.5 rounded-full bg-accent/15" />
        <div className="w-1.5 h-1.5 rounded-full bg-accent/10" />
      </div>
    </div>
  );
}
