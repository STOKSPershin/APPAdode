import type { MarketActivity } from "@shared/types";

interface ActivityCellProps {
  activity?: MarketActivity;
  className?: string;
}

const quintileDot: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "bg-error shadow-[0_0_8px_rgba(239,68,68,0.45)]",
  2: "bg-orange-400 shadow-[0_0_8px_rgba(251,146,60,0.4)]",
  3: "bg-warning shadow-[0_0_8px_rgba(245,158,11,0.4)]",
  4: "bg-success shadow-[0_0_8px_rgba(34,197,94,0.4)]",
  5: "bg-amber-300 shadow-[0_0_10px_rgba(252,211,77,0.55)]",
};

function percent(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
}

function percentileLabel(activity: MarketActivity): string {
  if (activity.percentile === null || activity.quintile === null) {
    return `Локальный пул: ${activity.poolSize}/5 тем`;
  }
  if (activity.quintile === 5) return `P${activity.percentile} · top 20% пула`;
  if (activity.quintile === 1) return `P${activity.percentile} · нижние 20%`;
  return `P${activity.percentile} · квинтиль ${activity.quintile}/5`;
}

export default function ActivityCell({ activity, className = "" }: ActivityCellProps) {
  if (!activity || activity.status === "collecting") {
    return (
      <td className={`border-b border-border/50 px-3 py-3 align-top min-w-56 ${className}`}>
        <p className="text-sm font-semibold text-text-secondary">Накапливаем 30 дней</p>
        <p className="mt-1 text-[11px] leading-snug text-text-muted">
          {activity?.reason ?? "Нужны два месячных снимка"}
        </p>
      </td>
    );
  }

  if (activity.status === "invalid" || !activity.overall) {
    return (
      <td className={`border-b border-border/50 px-3 py-3 align-top min-w-56 ${className}`}>
        <p className="text-sm font-semibold text-text-muted">Неизвестно</p>
        <p className="mt-1 text-[11px] leading-snug text-text-muted">{activity.reason}</p>
      </td>
    );
  }

  const dotClass = activity.quintile === null ? "bg-text-muted" : quintileDot[activity.quintile];
  return (
    <td
      className={`border-b border-border/50 px-3 py-3 align-top min-w-56 ${className}`}
      title="Proxy первой продажи: прирост total − undiscovered. Главное число — нижняя 95% граница Уилсона; удаления и изменения индекса делают метрику неизвестной."
    >
      <div className="flex items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
        <p className="text-sm font-semibold text-text-primary tabular-nums">
          ≥ {percent(activity.overall.wilsonLower30)}
        </p>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        Оценка: {percent(activity.overall.rate30)} · {percentileLabel(activity)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        AI ≥ {percent(activity.ai?.wilsonLower30)} · не-AI ≥ {percent(activity.nonAi?.wilsonLower30)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        {activity.overall.successes}/{activity.overall.trials} · интервал {activity.intervalDays ?? "—"} дн.
      </p>
    </td>
  );
}
