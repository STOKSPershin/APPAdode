import type { TopicScore } from "@shared/api/topic-score";

const SCORE_STYLES = [
  { minimum: 85, className: "border-[#d4af37]/35 bg-[#d4af37]/10 text-[#d4af37]" },
  { minimum: 65, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" },
  { minimum: 40, className: "border-yellow-400/30 bg-yellow-400/10 text-yellow-300" },
  { minimum: 0, className: "border-red-500/30 bg-red-500/10 text-red-400" },
] as const;

export default function OpportunityScore({ score }: { score: TopicScore | null }) {
  if (!score) {
    return (
      <span
        className="inline-flex min-w-8 items-center justify-center rounded-md border border-border px-1.5 py-0.5 text-[11px] font-semibold text-text-muted"
        title="Недостаточно данных для оценки"
      >
        —
      </span>
    );
  }

  const style = SCORE_STYLES.find((entry) => score.value >= entry.minimum)!;
  const { breakdown } = score;
  const details = [
    `Оценка: ${score.value}/100${score.preliminary ? " (предварительно)" : ""}`,
    `Продажи: ${breakdown.sales}/20`,
    `AI-продажи: ${breakdown.aiSales}/20`,
    `Проходимость top: ${breakdown.topAccess}/20`,
    `Свежесть: ${breakdown.freshness}/10`,
    `Динамика: ${breakdown.dynamics}/20`,
    `Размер: ${breakdown.size}/10`,
    `Пул: ${score.poolSize} тем`,
    ...score.adjustments,
  ].join("\n");

  return (
    <span
      role="img"
      aria-label={details}
      title={details}
      className={`inline-flex min-w-8 items-center justify-center rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${style.className} ${score.preliminary ? "border-dashed" : ""}`}
    >
      {score.value}
    </span>
  );
}
