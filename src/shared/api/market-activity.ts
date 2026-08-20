import type {
  ActivityEstimate,
  ActivityPoolEntry,
  MarketActivity,
  TopicHistoryEntry,
  TopicResult,
} from "@shared/types";
import { getActivityPool, getTopicHistory } from "./history";

const DAY_MS = 86_400_000;
const TARGET_DAYS = 30;
const MIN_BASELINE_DAYS = 21;
const MAX_BASELINE_DAYS = 45;
const MIN_PERCENTILE_POOL = 5;
const Z_95 = 1.959963984540054;

interface CounterSet {
  total: number;
  undiscovered: number;
}

function topicKey(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

function validCounterSet(total: number | null | undefined, undiscovered: number | null | undefined): CounterSet | null {
  if (
    typeof total !== "number"
    || typeof undiscovered !== "number"
    || !Number.isSafeInteger(total)
    || !Number.isSafeInteger(undiscovered)
    || total < 0
    || undiscovered < 0
    || undiscovered > total
  ) {
    return null;
  }
  return { total, undiscovered };
}

function overallCounters(result: TopicResult): CounterSet | null {
  if (result.status !== "ok" || result.marketSalesStatus !== "ok") return null;
  return validCounterSet(result.demand, result.undiscoveredCount);
}

function aiCounters(result: TopicResult): CounterSet | null {
  if (result.marketAiStatus !== "ok") return null;
  return validCounterSet(result.totalAiCount, result.undiscoveredAiCount);
}

function subtractCounters(all: CounterSet, ai: CounterSet): CounterSet | null {
  return validCounterSet(
    all.total - ai.total,
    all.undiscovered - ai.undiscovered,
  );
}

function wilsonLower(successes: number, trials: number): number {
  if (trials <= 0) return 0;
  const proportion = successes / trials;
  const zSquared = Z_95 * Z_95;
  const denominator = 1 + zSquared / trials;
  const center = proportion + zSquared / (2 * trials);
  const margin = Z_95 * Math.sqrt(
    (proportion * (1 - proportion) + zSquared / (4 * trials)) / trials,
  );
  return Math.max(0, (center - margin) / denominator);
}

function normalizeToThirtyDays(rate: number, intervalDays: number): number {
  if (rate <= 0) return 0;
  if (rate >= 1) return 1;
  return 1 - Math.pow(1 - rate, TARGET_DAYS / intervalDays);
}

function estimateActivity(
  current: CounterSet,
  baseline: CounterSet,
  intervalDays: number,
): ActivityEstimate | null {
  const newAssets = current.total - baseline.total;
  const baselineSold = baseline.total - baseline.undiscovered;
  const currentSold = current.total - current.undiscovered;
  const firstSaleEvents = currentSold - baselineSold;

  // A falling total or falling discovered counter means removals/index drift can
  // no longer be separated from first-sale transitions using aggregate counts.
  if (newAssets < 0 || firstSaleEvents < 0) return null;

  const trials = baseline.undiscovered + newAssets;
  if (trials <= 0 || firstSaleEvents > trials) return null;

  return {
    trials,
    successes: firstSaleEvents,
    rate30: normalizeToThirtyDays(firstSaleEvents / trials, intervalDays),
    wilsonLower30: normalizeToThirtyDays(
      wilsonLower(firstSaleEvents, trials),
      intervalDays,
    ),
  };
}

function emptyActivity(
  status: "collecting" | "invalid",
  reason: string,
  currentCheckedAt: string,
): MarketActivity {
  return {
    status,
    reason,
    baselineCheckedAt: null,
    currentCheckedAt,
    intervalDays: null,
    overall: null,
    ai: null,
    nonAi: null,
    percentile: null,
    quintile: null,
    poolSize: 0,
    methodVersion: "net-first-sale-v1",
  };
}

function selectBaseline(
  history: TopicHistoryEntry[],
  currentCheckedAt: string,
): { entry: TopicHistoryEntry; intervalDays: number } | null {
  const currentTime = Date.parse(currentCheckedAt);
  if (!Number.isFinite(currentTime)) return null;

  const candidates = history
    .map((entry) => ({
      entry,
      intervalDays: (currentTime - Date.parse(entry.checkedAt)) / DAY_MS,
    }))
    .filter(({ entry, intervalDays }) => (
      Number.isFinite(intervalDays)
      && intervalDays >= MIN_BASELINE_DAYS
      && intervalDays <= MAX_BASELINE_DAYS
      && overallCounters(entry.result) !== null
    ))
    .sort((left, right) => (
      Math.abs(left.intervalDays - TARGET_DAYS) - Math.abs(right.intervalDays - TARGET_DAYS)
    ));

  return candidates[0] ?? null;
}

export function calculateMarketActivity(
  current: TopicResult,
  currentCheckedAt: string,
  history: TopicHistoryEntry[],
): MarketActivity {
  const currentAll = overallCounters(current);
  if (!currentAll) {
    return emptyActivity("invalid", "Нет совместимых total и undiscovered", currentCheckedAt);
  }

  const baselineSelection = selectBaseline(history, currentCheckedAt);
  if (!baselineSelection) {
    return emptyActivity(
      "collecting",
      "Нужен предыдущий снимок этой темы 21–45 дней назад",
      currentCheckedAt,
    );
  }

  const baselineAll = overallCounters(baselineSelection.entry.result);
  if (!baselineAll) {
    return emptyActivity("invalid", "Предыдущие счётчики несовместимы", currentCheckedAt);
  }

  const overall = estimateActivity(currentAll, baselineAll, baselineSelection.intervalDays);
  if (!overall) {
    return {
      ...emptyActivity(
        "invalid",
        "Счётчики уменьшились или индекс изменился: rate30 не вычисляется",
        currentCheckedAt,
      ),
      baselineCheckedAt: baselineSelection.entry.checkedAt,
      intervalDays: Number(baselineSelection.intervalDays.toFixed(1)),
    };
  }

  const currentAi = aiCounters(current);
  const baselineAi = aiCounters(baselineSelection.entry.result);
  const ai = currentAi && baselineAi
    ? estimateActivity(currentAi, baselineAi, baselineSelection.intervalDays)
    : null;
  const currentNonAi = currentAi ? subtractCounters(currentAll, currentAi) : null;
  const baselineNonAi = baselineAi ? subtractCounters(baselineAll, baselineAi) : null;
  const nonAi = currentNonAi && baselineNonAi
    ? estimateActivity(currentNonAi, baselineNonAi, baselineSelection.intervalDays)
    : null;

  return {
    status: "ready",
    reason: "Консервативная оценка прироста работ с первой продажей",
    baselineCheckedAt: baselineSelection.entry.checkedAt,
    currentCheckedAt,
    intervalDays: Number(baselineSelection.intervalDays.toFixed(1)),
    overall,
    ai,
    nonAi,
    percentile: null,
    quintile: null,
    poolSize: 0,
    methodVersion: "net-first-sale-v1",
  };
}

function percentileFor(value: number, pool: number[]): number {
  const belowOrEqual = pool.filter((candidate) => candidate <= value).length;
  return Math.round((belowOrEqual / pool.length) * 100);
}

function quintileFor(percentile: number): 1 | 2 | 3 | 4 | 5 {
  if (percentile <= 20) return 1;
  if (percentile <= 40) return 2;
  if (percentile <= 60) return 3;
  if (percentile <= 80) return 4;
  return 5;
}

export async function enrichMarketActivities(
  results: TopicResult[],
  checkedAt = new Date().toISOString(),
): Promise<TopicResult[]> {
  const histories = await Promise.all(results.map((result) => (
    getTopicHistory(result.topic, 100).catch(() => [])
  )));
  const calculated = results.map((result, index) => ({
    ...result,
    activity: calculateMarketActivity(result, checkedAt, histories[index]),
  }));

  const historicalPool = await getActivityPool().catch((): ActivityPoolEntry[] => []);
  const latestByTopic = new Map(
    historicalPool.map((entry) => [entry.topicKey, entry.wilsonLower30]),
  );
  for (const result of calculated) {
    const value = result.activity?.overall?.wilsonLower30;
    if (result.activity?.status === "ready" && typeof value === "number") {
      latestByTopic.set(topicKey(result.topic), value);
    }
  }
  const pool = [...latestByTopic.values()].filter(Number.isFinite);

  return calculated.map((result) => {
    const activity = result.activity;
    const value = activity?.overall?.wilsonLower30;
    if (!activity || activity.status !== "ready" || typeof value !== "number") return result;
    if (pool.length < MIN_PERCENTILE_POOL) {
      return { ...result, activity: { ...activity, poolSize: pool.length } };
    }
    const percentile = percentileFor(value, pool);
    return {
      ...result,
      activity: {
        ...activity,
        percentile,
        quintile: quintileFor(percentile),
        poolSize: pool.length,
      },
    };
  });
}
