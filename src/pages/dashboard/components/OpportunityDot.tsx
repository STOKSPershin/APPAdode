import type { TopicAnalytics } from "@shared/types";

type OpportunityLevel = "closed" | "top100" | "top10" | "gold" | "unknown";

interface OpportunitySignal {
  level: OpportunityLevel;
  label: string;
}

function getOpportunitySignal(analytics?: TopicAnalytics): OpportunitySignal {
  const metrics = analytics?.metrics;
  const sixMonths = metrics?.ageWindows.find((window) => window.months === 6);
  if (!metrics || !sixMonths) {
    return { level: "unknown", label: "Нет данных top-100" };
  }

  const aiShare = sixMonths.total > 0 ? sixMonths.ai / sixMonths.total : 0;
  if (sixMonths.total < 5 || aiShare < 0.2) {
    return {
      level: "closed",
      label: "Закрыто: свежих за 6 месяцев меньше 5 или доля AI среди них ниже 20%",
    };
  }

  if (sixMonths.top10Count >= 3 && metrics.aiTop10Count >= 3) {
    return {
      level: "gold",
      label: "AI занимает верх: минимум 3 свежих и 3 AI находятся в top-10",
    };
  }

  if (sixMonths.top10Count >= 1) {
    return { level: "top10", label: "Свежие работы доходят до top-10" };
  }

  return { level: "top100", label: "Вход в top-100 возможен, но свежих работ в top-10 нет" };
}

const LEVEL_STYLES: Record<OpportunityLevel, string> = {
  closed: "bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.12)]",
  top100: "bg-yellow-300 shadow-[0_0_0_3px_rgba(253,224,71,0.12)]",
  top10: "bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]",
  gold: "bg-[#d4af37] shadow-[0_0_0_3px_rgba(212,175,55,0.22),0_0_10px_rgba(212,175,55,0.35)]",
  unknown: "bg-zinc-600 shadow-[0_0_0_3px_rgba(82,82,91,0.12)]",
};

export default function OpportunityDot({ analytics }: { analytics?: TopicAnalytics }) {
  const signal = getOpportunitySignal(analytics);
  return (
    <span
      role="img"
      aria-label={signal.label}
      title={signal.label}
      className={`block h-2.5 w-2.5 rounded-full ${LEVEL_STYLES[signal.level]}`}
    />
  );
}
