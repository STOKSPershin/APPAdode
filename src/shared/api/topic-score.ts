import type { MarketActivity, TopicResult, Top100Dynamics } from "@shared/types";

const MIN_PERCENTILE_POOL = 5;

const STATIC_WEIGHTS = {
  soldShare: 20,
  aiSoldShare: 12,
  aiSalesRepresentation: 8,
  topAiRepresentation: 4,
  aiTop10: 4,
  freshTop10: 12,
  freshSixMonths: 4,
  freshAiSixMonths: 6,
  size: 10,
} as const;

const DYNAMIC_WEIGHTS = {
  overallRate30: 5,
  aiRate30: 10,
  topMovement: 5,
} as const;

type ScoreMetric = keyof typeof STATIC_WEIGHTS | keyof typeof DYNAMIC_WEIGHTS;

interface ScoreVector {
  soldShare: number;
  aiSoldShare: number;
  aiSalesRepresentation: number;
  topAiRepresentation: number;
  aiTop10: number;
  freshTop10: number;
  freshSixMonths: number;
  freshAiSixMonths: number;
  size: number;
  overallRate30: number | null;
  aiRate30: number | null;
  topMovement: number | null;
  aiShare: number;
  freshAiShare: number;
  freshOneMonth: number;
  freshAiOneMonth: number;
  topAiShare: number;
}

export interface TopicScorePool {
  values: Record<ScoreMetric, number[]>;
  topicCount: number;
}

export interface TopicScoreBreakdown {
  sales: number;
  aiSales: number;
  topAccess: number;
  freshness: number;
  dynamics: number;
  size: number;
}

export interface TopicScore {
  value: number;
  preliminary: boolean;
  poolSize: number;
  breakdown: TopicScoreBreakdown;
  adjustments: string[];
}

interface ReferencePercentiles {
  p20: number;
  median: number;
  p80: number;
}

// Reference values from the verified local backup (189 unique topics, 20.08.2026).
// They are used only while a fresh profile has fewer than five comparable topics.
const REFERENCE: Record<keyof typeof STATIC_WEIGHTS, ReferencePercentiles> = {
  soldShare: { p20: 0.1596, median: 0.213, p80: 0.2619 },
  aiSoldShare: { p20: 0.0815, median: 0.1162, p80: 0.1514 },
  aiSalesRepresentation: { p20: 0.47, median: 0.54, p80: 0.63 },
  topAiRepresentation: { p20: 0.67, median: 1.06, p80: 1.25 },
  aiTop10: { p20: 1, median: 3, p80: 3 },
  freshTop10: { p20: 1, median: 3, p80: 6 },
  freshSixMonths: { p20: 10.6, median: 27.5, p80: 61.2 },
  freshAiSixMonths: { p20: 6, median: 18.5, p80: 41.8 },
  size: { p20: 27_630, median: 302_355, p80: 2_145_192 },
};

export function buildTopicScorePool(results: TopicResult[]): TopicScorePool {
  const latestByTopic = new Map<string, TopicResult>();
  for (const result of results) {
    const key = normalizeTopic(result.topic);
    if (key) latestByTopic.set(key, result);
  }

  const values = emptyPoolValues();
  for (const result of latestByTopic.values()) {
    const vector = getScoreVector(result);
    if (!vector) continue;
    for (const key of Object.keys(values) as ScoreMetric[]) {
      const value = vector[key];
      if (typeof value === "number" && Number.isFinite(value)) values[key].push(value);
    }
  }

  for (const entries of Object.values(values)) entries.sort((left, right) => left - right);
  return { values, topicCount: latestByTopic.size };
}

export function calculateTopicScore(
  result: TopicResult,
  pool: TopicScorePool,
): TopicScore | null {
  const vector = getScoreVector(result);
  if (!vector) return null;

  const percentile = (key: ScoreMetric, value: number): number => {
    const entries = pool.values[key];
    if (entries.length >= MIN_PERCENTILE_POOL) return percentileRank(entries, value);
    if (key in REFERENCE) {
      return referencePercentile(value, REFERENCE[key as keyof typeof STATIC_WEIGHTS]);
    }
    return 0.5;
  };
  const points = (key: ScoreMetric, value: number, weight: number) => (
    percentile(key, value) * weight
  );
  const pointsWithReducedInfluence = (
    key: ScoreMetric,
    value: number,
    weight: number,
    influence: number,
  ) => {
    const rank = percentile(key, value);
    const adjustedRank = 0.5 + (rank - 0.5) * influence;
    return adjustedRank * weight;
  };

  const soldPoints = points("soldShare", vector.soldShare, STATIC_WEIGHTS.soldShare);
  const aiSoldPoints = pointsWithReducedInfluence(
    "aiSoldShare",
    vector.aiSoldShare,
    STATIC_WEIGHTS.aiSoldShare,
    0.7,
  );
  const aiSalesRepresentationPoints = points(
    "aiSalesRepresentation",
    vector.aiSalesRepresentation,
    STATIC_WEIGHTS.aiSalesRepresentation,
  );
  const topAiRepresentationPoints = points(
    "topAiRepresentation",
    vector.topAiRepresentation,
    STATIC_WEIGHTS.topAiRepresentation,
  );
  const aiTop10Points = points("aiTop10", vector.aiTop10, STATIC_WEIGHTS.aiTop10);
  const freshTop10Points = points("freshTop10", vector.freshTop10, STATIC_WEIGHTS.freshTop10);
  const freshSixMonthsPoints = points(
    "freshSixMonths",
    vector.freshSixMonths,
    STATIC_WEIGHTS.freshSixMonths,
  );
  const freshAiSixMonthsPoints = points(
    "freshAiSixMonths",
    vector.freshAiSixMonths,
    STATIC_WEIGHTS.freshAiSixMonths,
  );
  const sizePoints = points("size", vector.size, STATIC_WEIGHTS.size);

  const hasOverallActivity = vector.overallRate30 !== null
    && pool.values.overallRate30.length >= MIN_PERCENTILE_POOL;
  const hasAiActivity = vector.aiRate30 !== null
    && pool.values.aiRate30.length >= MIN_PERCENTILE_POOL;
  const hasMovement = vector.topMovement !== null
    && pool.values.topMovement.length >= MIN_PERCENTILE_POOL;
  const overallActivityPoints = hasOverallActivity
    ? points("overallRate30", vector.overallRate30!, DYNAMIC_WEIGHTS.overallRate30)
    : DYNAMIC_WEIGHTS.overallRate30 / 2;
  const aiActivityPoints = hasAiActivity
    ? points("aiRate30", vector.aiRate30!, DYNAMIC_WEIGHTS.aiRate30)
    : DYNAMIC_WEIGHTS.aiRate30 / 2;
  const movementPoints = hasMovement
    ? points("topMovement", vector.topMovement!, DYNAMIC_WEIGHTS.topMovement)
    : DYNAMIC_WEIGHTS.topMovement / 2;

  const breakdown: TopicScoreBreakdown = {
    sales: soldPoints,
    aiSales: aiSoldPoints + aiSalesRepresentationPoints,
    topAccess: topAiRepresentationPoints + aiTop10Points + freshTop10Points,
    freshness: freshSixMonthsPoints + freshAiSixMonthsPoints,
    dynamics: overallActivityPoints + aiActivityPoints + movementPoints,
    size: sizePoints,
  };
  let score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const adjustments: string[] = [];

  const soldBelowMedian = percentile("soldShare", vector.soldShare) < 0.5;
  const aiSoldBelowMedian = percentile("aiSoldShare", vector.aiSoldShare) < 0.5;
  const topAiBelowMedian = percentile("topAiRepresentation", vector.topAiRepresentation) < 0.5;
  let saturationPenalty = 0;
  if (vector.topAiShare >= 0.7 && aiSoldBelowMedian) saturationPenalty += 8;
  if (vector.topAiShare >= 0.7 && vector.aiSalesRepresentation < 0.5) {
    saturationPenalty += 7;
  } else if (vector.topAiShare >= 0.7 && vector.aiSalesRepresentation < 0.7) {
    saturationPenalty += 4;
  }
  if (vector.aiShare >= 0.8 && (soldBelowMedian || aiSoldBelowMedian)) saturationPenalty += 5;
  saturationPenalty = Math.min(15, saturationPenalty);
  if (saturationPenalty > 0) {
    score -= saturationPenalty;
    adjustments.push(`−${saturationPenalty}: AI занимает верх, но продаётся слабее`);
  } else if (vector.aiShare < 0.05 && aiSoldBelowMedian && topAiBelowMedian) {
    score -= 5;
    adjustments.push("−5: AI почти отсутствует и не показывает коммерческого результата");
  }

  const scoreCaps: Array<{ maximum: number; reason: string }> = [];
  if (vector.freshSixMonths < 5 || vector.freshAiShare < 0.2 || vector.freshOneMonth === 0) {
    scoreCaps.push({ maximum: 30, reason: "top закрыт для свежих работ" });
  } else if (vector.freshAiOneMonth === 0) {
    scoreCaps.push({ maximum: 40, reason: "в top-100 нет свежего AI" });
  }

  if (vector.size < 1_000) {
    scoreCaps.push({ maximum: 50, reason: "узкая ниша: менее 1 000 работ" });
  } else if (vector.size < 5_000) {
    scoreCaps.push({ maximum: 60, reason: "узкая ниша: менее 5 000 работ" });
  } else if (vector.size < 20_000) {
    scoreCaps.push({ maximum: 70, reason: "небольшая ниша: менее 20 000 работ" });
  } else if (vector.size < 100_000) {
    scoreCaps.push({ maximum: 85, reason: "ограниченный объём: менее 100 000 работ" });
  }

  for (const cap of scoreCaps) {
    if (score > cap.maximum) {
      score = cap.maximum;
      adjustments.push(`потолок ${cap.maximum}: ${cap.reason}`);
    }
  }

  return {
    value: Math.max(0, Math.min(100, Math.round(score))),
    preliminary: !hasOverallActivity || !hasAiActivity || !hasMovement,
    poolSize: pool.topicCount,
    breakdown: roundBreakdown(breakdown),
    adjustments,
  };
}

function getScoreVector(result: TopicResult): ScoreVector | null {
  const total = result.demand;
  const undiscovered = result.undiscoveredCount;
  const totalAi = result.totalAiCount;
  const undiscoveredAi = result.undiscoveredAiCount;
  const metrics = result.analytics?.metrics;
  const sixMonths = metrics?.ageWindows.find((window) => window.months === 6);
  const oneMonth = metrics?.ageWindows.find((window) => window.months === 1);

  if (
    result.status !== "ok"
    || !metrics
    || !sixMonths
    || !oneMonth
    || total === null
    || total <= 0
    || undiscovered === undefined
    || undiscovered === null
    || undiscovered < 0
    || undiscovered > total
    || totalAi === undefined
    || totalAi === null
    || totalAi <= 0
    || totalAi > total
    || undiscoveredAi === undefined
    || undiscoveredAi === null
    || undiscoveredAi < 0
    || undiscoveredAi > totalAi
    || metrics.topCount <= 0
  ) {
    return null;
  }

  const sold = total - undiscovered;
  const soldAi = totalAi - undiscoveredAi;
  const soldShare = sold / total;
  const aiSoldShare = soldAi / totalAi;
  const aiShare = totalAi / total;
  const topAiShare = metrics.aiCount / metrics.topCount;

  return {
    soldShare,
    aiSoldShare,
    aiSalesRepresentation: soldShare > 0 ? aiSoldShare / soldShare : 0,
    topAiRepresentation: aiShare > 0 ? Math.min(topAiShare / aiShare, 1.25) : 0,
    aiTop10: Math.min(metrics.aiTop10Count, 3),
    freshTop10: sixMonths.top10Count,
    freshSixMonths: sixMonths.total,
    freshAiSixMonths: sixMonths.ai,
    size: total,
    overallRate30: readyActivityValue(result.activity?.overall?.wilsonLower30, result.activity?.status),
    aiRate30: readyActivityValue(result.activity?.ai?.wilsonLower30, result.activity?.status),
    topMovement: dynamicsValue(metrics.dynamics),
    aiShare,
    freshAiShare: sixMonths.total > 0 ? sixMonths.ai / sixMonths.total : 0,
    freshOneMonth: oneMonth.total,
    freshAiOneMonth: oneMonth.ai,
    topAiShare,
  };
}

function readyActivityValue(
  value: number | undefined,
  status: MarketActivity["status"] | undefined,
): number | null {
  return status === "ready" && typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dynamicsValue(dynamics: Top100Dynamics | null): number | null {
  if (!dynamics) return null;
  return (
    dynamics.enteredFreshTop10 * 4
    + dynamics.enteredTop10 * 2
    + dynamics.enteredAi
  );
}

function percentileRank(sortedValues: number[], value: number): number {
  let lower = 0;
  let equal = 0;
  for (const entry of sortedValues) {
    if (entry < value) lower += 1;
    else if (entry === value) equal += 1;
    else break;
  }
  return clamp01((lower + equal / 2) / sortedValues.length);
}

function referencePercentile(value: number, reference: ReferencePercentiles): number {
  if (value <= reference.p20) {
    return reference.p20 <= 0 ? 0.2 : clamp01(0.2 * value / reference.p20);
  }
  if (value <= reference.median) {
    return interpolate(value, reference.p20, reference.median, 0.2, 0.5);
  }
  if (value <= reference.p80) {
    return interpolate(value, reference.median, reference.p80, 0.5, 0.8);
  }
  const span = Math.max(reference.p80 - reference.median, Number.EPSILON);
  return clamp01(0.8 + 0.2 * (1 - Math.exp(-(value - reference.p80) / span)));
}

function interpolate(value: number, from: number, to: number, low: number, high: number): number {
  if (to <= from) return high;
  return low + ((value - from) / (to - from)) * (high - low);
}

function emptyPoolValues(): Record<ScoreMetric, number[]> {
  return {
    soldShare: [],
    aiSoldShare: [],
    aiSalesRepresentation: [],
    topAiRepresentation: [],
    aiTop10: [],
    freshTop10: [],
    freshSixMonths: [],
    freshAiSixMonths: [],
    size: [],
    overallRate30: [],
    aiRate30: [],
    topMovement: [],
  };
}

function normalizeTopic(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function roundBreakdown(value: TopicScoreBreakdown): TopicScoreBreakdown {
  return Object.fromEntries(
    Object.entries(value).map(([key, points]) => [key, Math.round(points * 10) / 10]),
  ) as unknown as TopicScoreBreakdown;
}
