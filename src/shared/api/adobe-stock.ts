/**
 * Adobe Stock collection from the live stock.adobe.com content script.
 *
 * The collector never uses the partner API, never bypasses CAPTCHA, and runs
 * one request at a time. Per-asset dates are estimated only from the local
 * photo ID calibration model.
 */

import {
  cacheTopicAnalytics,
  getCachedTopicAnalytics,
  getLatestStoredTopicAnalytics,
} from "./analytics-cache";
import { estimateDateFromId, loadCalibrationModel } from "./date-calibration";
import { getLatestHistoricAnalytics } from "./history";
import type {
  AgeWindowMetric,
  AgeWindowMonths,
  AssetObservation,
  ContentFilter,
  ParserCoverage,
  SalesCoverage,
  TopicAnalytics,
  TopicResult,
} from "@shared/types";

const ADOBE_STOCK_BASE = "https://stock.adobe.com";
const PARSER_VERSION = "adobe-html-v2-title";
const FILTER_SIGNATURE = "photo|relevance|organic-visible-order";
const SALES_PAGE_LIMIT = 3;
const PARSER_BASELINE_KEY = "topicHunter_parserBaseline_v1";
const COVERAGE_DROP_LIMIT = 0.2;
const DAY_MS = 86_400_000;

const FILTER_PARAM_MAP: Record<ContentFilter, string> = {
  photo: "photo",
  vector: "vector",
  illustration: "illustration",
  video: "video",
};

interface ParsedSearchAsset {
  assetId: string;
  rank: number;
  ingestPosition: string | null;
  title: string | null;
  isAi: boolean | null;
}

interface ParsedSearchPage {
  assets: ParsedSearchAsset[];
  totalResults: number | null;
  expectedAssets: number;
  coverage: Omit<ParserCoverage, "dateCoverage">;
}

interface ParserBaseline {
  uniqueIdCoverage: number;
  aiCoverage: number;
  titleCoverage: number;
  lastGoodAt: string;
}

interface AnalyzeProgress {
  completed: number;
  total: number;
  topic: string;
  analytics: TopicAnalytics;
}

export type AnalyticsProgressCallback = (progress: AnalyzeProgress) => void;

class AdobeScanError extends Error {
  readonly code: "waf_blocked" | "parser_degraded" | "scan_blocked" | "error";

  constructor(
    code: "waf_blocked" | "parser_degraded" | "scan_blocked" | "error",
    message: string,
  ) {
    super(message);
    this.code = code;
  }
}

let requestQueue: Promise<unknown> = Promise.resolve();

function runSingleRequest<T>(operation: () => Promise<T>): Promise<T> {
  const result = requestQueue.then(operation, operation);
  requestQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function waitRandom([min, max]: [number, number]): Promise<void> {
  const delay = Math.round(Math.random() * (max - min) + min);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function buildFilterParams(filters: ContentFilter[]): string {
  return filters
    .map((filter) => `filters[content_type:${FILTER_PARAM_MAP[filter]}]=1`)
    .join("&");
}

function buildPhotoSearchUrl(
  keyword: string,
  page = 1,
  undiscovered = false,
): string {
  const url = new URL("/search/images", ADOBE_STOCK_BASE);
  const params = url.searchParams;
  params.set("filters[content_type:photo]", "1");
  params.set("filters[content_type:illustration]", "0");
  params.set("filters[content_type:zip_vector]", "0");
  params.set("filters[content_type:video]", "0");
  params.set("filters[content_type:template]", "0");
  params.set("filters[content_type:3d]", "0");
  params.set("filters[content_type:audio]", "0");
  params.set("filters[content_type:image]", "1");
  params.set("filters[include_stock_enterprise]", "0");
  params.set("filters[is_editorial]", "0");
  params.set("k", keyword.trim());
  params.set("order", "relevance");
  params.set("search_page", String(page));
  params.set("get_facets", page === 1 ? "1" : "0");
  params.set("search_type", page === 1 ? "usertyped" : "pagination");
  if (undiscovered) params.set("filters[undiscovered]", "only");
  return url.toString();
}

function containsBlockPage(html: string): boolean {
  // Adobe loads a regular DataDome telemetry script on every healthy search
  // page, so the word "datadome" by itself is not evidence of a block.
  // Only treat challenge-specific endpoints/markers or visible restriction
  // text as a block page.
  if (
    /geo\.captcha-delivery\.com\/captcha\/\?initialCid=/i.test(html)
    || /ct\.captcha-delivery\.com\/c\.js/i.test(html)
    || /blocked_by_datadome|dd_blocked/i.test(html)
  ) {
    return true;
  }

  const documentValue = new DOMParser().parseFromString(html, "text/html");
  const pageText = documentValue.body?.textContent ?? "";
  return /please enable js|доступ временно ограничен|access temporarily restricted/i.test(pageText);
}

async function fetchHtml(url: string): Promise<string> {
  return runSingleRequest(async () => {
    const response = await fetch(url, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });

    if (response.status === 403 || response.status === 429) {
      throw new AdobeScanError("waf_blocked", `Adobe остановил запрос: HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new AdobeScanError("error", `Adobe вернул HTTP ${response.status}`);
    }

    const html = await response.text();
    if (containsBlockPage(html)) {
      throw new AdobeScanError("waf_blocked", "Adobe показал DataDome или страницу ограничения доступа");
    }
    return html;
  });
}

function parseResultCount(documentValue: Document): number | null {
  const heading = documentValue.querySelector("main h1")?.textContent ?? "";
  const headingMatch = heading.match(/([0-9][0-9,.\s]*)\s+results?/i);
  if (headingMatch?.[1]) {
    const value = Number(headingMatch[1].replace(/\D/g, ""));
    if (Number.isSafeInteger(value)) return value;
  }

  const titleMatch = documentValue.title.match(/Browse\s+([0-9][0-9,.\s]*)\s+Stock/i);
  if (titleMatch?.[1]) {
    const value = Number(titleMatch[1].replace(/\D/g, ""));
    if (Number.isSafeInteger(value)) return value;
  }

  if (/no results|0 results/i.test(heading)) return 0;
  return null;
}

function parseSearchPage(html: string, strictTop100: boolean): ParsedSearchPage {
  const documentValue = new DOMParser().parseFromString(html, "text/html");
  const totalResults = parseResultCount(documentValue);
  const detailScript = documentValue.querySelector<HTMLScriptElement>("#image-detail-json");
  let detailData: Record<string, { is_gentech?: unknown; title?: unknown }> = {};

  if (detailScript?.textContent) {
    try {
      detailData = JSON.parse(detailScript.textContent) as Record<
        string,
        { is_gentech?: unknown; title?: unknown }
      >;
    } catch {
      throw new AdobeScanError("parser_degraded", "Adobe изменил JSON image-detail-json");
    }
  }

  const cells = Array.from(
    documentValue.querySelectorAll<HTMLElement>("[data-t='search-result-cell'][data-content-id]"),
  );
  const seen = new Set<string>();
  const assets: ParsedSearchAsset[] = [];

  for (const cell of cells) {
    const assetId = cell.dataset.contentId?.trim() ?? "";
    if (!/^\d+$/.test(assetId) || seen.has(assetId)) continue;
    seen.add(assetId);

    const rawAi = detailData[assetId]?.is_gentech;
    const rawTitle = detailData[assetId]?.title;
    const imageAlt = cell.querySelector("img")?.getAttribute("alt")?.trim() ?? "";
    assets.push({
      assetId,
      rank: assets.length + 1,
      ingestPosition: cell.dataset.ingestPosition ?? null,
      title: typeof rawTitle === "string" && rawTitle.trim()
        ? rawTitle.trim()
        : imageAlt || null,
      isAi: typeof rawAi === "boolean" ? rawAi : null,
    });
    if (assets.length === 100) break;
  }

  const expectedAssets = totalResults === null ? 100 : Math.min(100, totalResults);
  const denominator = Math.max(1, expectedAssets);
  const knownAi = assets.filter((asset) => asset.isAi !== null).length;
  const knownTitles = assets.filter((asset) => asset.title !== null).length;
  const coverage = {
    expectedAssets,
    parsedAssets: assets.length,
    uniqueIdCoverage: Math.min(1, assets.length / denominator),
    aiCoverage: assets.length === 0 ? 0 : knownAi / assets.length,
    titleCoverage: assets.length === 0 ? 0 : knownTitles / assets.length,
  };

  if (totalResults === 0) return { assets, totalResults, expectedAssets, coverage };
  if (!detailScript || assets.length === 0) {
    throw new AdobeScanError("parser_degraded", "Не найдены карточки или image-detail-json");
  }
  if (strictTop100 && expectedAssets >= 10 && assets.length < expectedAssets * 0.9) {
    throw new AdobeScanError(
      "parser_degraded",
      `Покрытие top-100 упало до ${assets.length}/${expectedAssets}`,
    );
  }
  if (strictTop100 && coverage.aiCoverage < 0.8) {
    throw new AdobeScanError(
      "parser_degraded",
      `Покрытие is_gentech упало до ${(coverage.aiCoverage * 100).toFixed(0)}%`,
    );
  }
  if (strictTop100 && coverage.titleCoverage < 0.8) {
    throw new AdobeScanError(
      "parser_degraded",
      `Покрытие title упало до ${(coverage.titleCoverage * 100).toFixed(0)}%`,
    );
  }

  return { assets, totalResults, expectedAssets, coverage };
}

function signedInAdobeSessionDetected(): boolean {
  if (typeof document === "undefined") return false;
  const header = document.querySelector("header, [role='banner']");
  if (!header) return false;

  const controls = Array.from(
    header.querySelectorAll<HTMLElement>("button, a, [aria-label], [title]"),
  );
  return controls.some((element) => {
    const signal = [
      element.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("href"),
    ].join(" ");
    return /sign out|log out|my account|account menu|profile menu|выйти|мой аккаунт/i.test(signal);
  });
}

async function checkParserBaseline(coverage: ParserCoverage): Promise<void> {
  const stored = await chrome.storage.local.get(PARSER_BASELINE_KEY);
  const baseline = stored[PARSER_BASELINE_KEY] as ParserBaseline | undefined;

  if (
    baseline &&
    (
      coverage.uniqueIdCoverage < baseline.uniqueIdCoverage * (1 - COVERAGE_DROP_LIMIT) ||
      coverage.aiCoverage < baseline.aiCoverage * (1 - COVERAGE_DROP_LIMIT) ||
      coverage.titleCoverage < baseline.titleCoverage * (1 - COVERAGE_DROP_LIMIT)
    )
  ) {
    throw new AdobeScanError(
      "parser_degraded",
      "Покрытие полей просело более чем на 20% относительно последнего исправного скана",
    );
  }

  const nextBaseline: ParserBaseline = {
    uniqueIdCoverage: Math.max(baseline?.uniqueIdCoverage ?? 0, coverage.uniqueIdCoverage),
    aiCoverage: Math.max(baseline?.aiCoverage ?? 0, coverage.aiCoverage),
    titleCoverage: Math.max(baseline?.titleCoverage ?? 0, coverage.titleCoverage),
    lastGoodAt: new Date().toISOString(),
  };
  await chrome.storage.local.set({ [PARSER_BASELINE_KEY]: nextBaseline });
}

function subtractCalendarMonths(now: Date, months: AgeWindowMonths): number {
  const cutoff = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff.getTime();
}

function calculateAgeWindows(
  assets: AssetObservation[],
  now: Date,
  exactSales: boolean,
): AgeWindowMetric[] {
  const windows: AgeWindowMonths[] = [1, 2, 3, 6];

  return windows.map((months) => {
    const cutoff = subtractCalendarMonths(now, months);
    const cohort = assets.filter((asset) => {
      if (!asset.estimatedUploadDate) return false;
      return Date.parse(`${asset.estimatedUploadDate}T00:00:00Z`) >= cutoff;
    });
    const aiAssets = cohort.filter((asset) => asset.isAi === true);
    const confirmedAiUndiscovered = aiAssets.filter(
      (asset) => asset.salesStatus === "undiscovered",
    ).length;

    return {
      months,
      total: cohort.length,
      ai: aiAssets.length,
      top10Count: cohort.filter((asset) => asset.rank <= 10).length,
      soldAi: exactSales
        ? aiAssets.filter((asset) => asset.salesStatus === "sold").length
        : null,
      confirmedAiUndiscovered,
      unknownAiSales: exactSales
        ? 0
        : aiAssets.filter((asset) => asset.salesStatus === "unknown").length,
    };
  });
}

function normalizePhrase(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function calculateTitleMatchesTop10(
  topic: string,
  assets: AssetObservation[],
): { matches: number | null; coverage: number } {
  const top10 = assets.filter((asset) => asset.rank <= 10);
  if (top10.length === 0) return { matches: 0, coverage: 1 };

  const known = top10.filter(
    (asset) => typeof asset.title === "string" && asset.title.trim().length > 0,
  );
  const coverage = known.length / top10.length;
  if (coverage < 1) return { matches: null, coverage };

  const phrase = normalizePhrase(topic);
  if (!phrase) return { matches: null, coverage };
  const matches = known.filter((asset) => normalizePhrase(asset.title!).includes(phrase)).length;
  return { matches, coverage };
}

function deriveMetrics(
  assets: AssetObservation[],
  sales: SalesCoverage,
  now: Date,
  marketTotal: number | null,
  topic: string,
) {
  const exactSales = sales.mode === "exact";
  const ageWindows = calculateAgeWindows(assets, now, exactSales);
  const oneMonth = ageWindows.find((window) => window.months === 1)!;
  const dateUnknown = assets.filter((asset) => !asset.estimatedUploadDate).length;
  const aiAssets = assets.filter((asset) => asset.isAi === true);
  const aiTop10Count = aiAssets.filter((asset) => asset.rank <= 10).length;
  const unknownAiCount = assets.filter((asset) => asset.isAi === null).length;
  const compatibleMarketTotals = (
    marketTotal !== null
    && sales.undiscoveredTotal !== null
    && Number.isSafeInteger(marketTotal)
    && Number.isSafeInteger(sales.undiscoveredTotal)
    && marketTotal >= 0
    && sales.undiscoveredTotal >= 0
    && sales.undiscoveredTotal <= marketTotal
  );
  const marketSoldCount = compatibleMarketTotals
    ? marketTotal - sales.undiscoveredTotal!
    : null;
  const imagesPerSoldAsset = marketSoldCount !== null && marketSoldCount > 0
    ? marketTotal! / marketSoldCount
    : null;
  const titleMatches = calculateTitleMatchesTop10(topic, assets);
  const sixMonthCutoff = subtractCalendarMonths(now, 6);
  const olderThanSixMonths = assets.filter((asset) => {
    if (!asset.estimatedUploadDate) return false;
    return Date.parse(`${asset.estimatedUploadDate}T00:00:00Z`) < sixMonthCutoff;
  }).length;

  let verdict: "open" | "frozen" | "no_fresh_ai" | "insufficient_data" = "open";
  let verdictReason = "В top-100 присутствуют свежие AI-работы";

  if (assets.length === 0) {
    verdict = "insufficient_data";
    verdictReason = "В выдаче нет работ для анализа top-100";
  } else if (dateUnknown > assets.length * 0.1 || unknownAiCount > assets.length * 0.1) {
    verdict = "insufficient_data";
    verdictReason = "Недостаточно данных для оценки проходимости";
  } else if (oneMonth.total === 0) {
    verdict = "frozen";
    verdictReason = "В top-100 нет работ моложе одного месяца";
  } else if (oneMonth.ai === 0 && aiAssets.length > 0) {
    verdict = "no_fresh_ai";
    verdictReason = "AI в нише есть, но свежего AI в top-100 нет";
  }

  return {
    topCount: assets.length,
    aiCount: aiAssets.length,
    aiTop10Count,
    unknownAiCount,
    marketSoldCount,
    imagesPerSoldAsset,
    titleMatchesTop10: titleMatches.matches,
    titleCoverageTop10: titleMatches.coverage,
    soldAi: exactSales
      ? aiAssets.filter((asset) => asset.salesStatus === "sold").length
      : null,
    confirmedAiUndiscovered: aiAssets.filter(
      (asset) => asset.salesStatus === "undiscovered",
    ).length,
    ageWindows,
    olderThanSixMonths,
    dateUnknown,
    sales,
    dynamics: null,
    verdict,
    verdictReason,
  } as const;
}

async function attachDynamics(
  current: TopicAnalytics,
  previous: TopicAnalytics | null,
): Promise<TopicAnalytics> {
  if (!current.snapshot || !current.metrics || !previous?.snapshot) return current;

  const previousById = new Map(previous.snapshot.assets.map((asset) => [asset.assetId, asset]));
  const currentById = new Map(current.snapshot.assets.map((asset) => [asset.assetId, asset]));
  const retainedAssets = current.snapshot.assets.filter((asset) => previousById.has(asset.assetId));
  const retained = retainedAssets.length;
  const enteredAssets = current.snapshot.assets.filter((asset) => !previousById.has(asset.assetId));
  const exitedAssets = previous.snapshot.assets.filter((asset) => !currentById.has(asset.assetId));
  const rankChanges = retainedAssets.map((asset) => {
    const previousRank = previousById.get(asset.assetId)!.rank;
    return { currentRank: asset.rank, previousRank, delta: asset.rank - previousRank };
  });
  const movedUp = rankChanges.filter((change) => change.delta < 0).length;
  const movedDown = rankChanges.filter((change) => change.delta > 0).length;
  const unchangedRank = rankChanges.filter((change) => change.delta === 0).length;
  const averageAbsoluteRankChange = rankChanges.length === 0
    ? 0
    : Number((
      rankChanges.reduce((sum, change) => sum + Math.abs(change.delta), 0) / rankChanges.length
    ).toFixed(1));
  const biggestRise = rankChanges.reduce(
    (maximum, change) => Math.max(maximum, change.previousRank - change.currentRank),
    0,
  );
  const biggestDrop = rankChanges.reduce(
    (maximum, change) => Math.max(maximum, change.currentRank - change.previousRank),
    0,
  );
  const oneMonthCutoff = subtractCalendarMonths(new Date(current.snapshot.checkedAt), 1);
  const enteredFreshAssets = enteredAssets.filter((asset) => (
    asset.estimatedUploadDate !== null
    && Date.parse(`${asset.estimatedUploadDate}T00:00:00Z`) >= oneMonthCutoff
  ));
  const stored = await chrome.storage.local.get("topicHunter_noiseThreshold");
  const rawThreshold = stored.topicHunter_noiseThreshold;
  const noiseThreshold = typeof rawThreshold === "number" && rawThreshold >= 0
    ? rawThreshold
    : null;
  const changed = enteredAssets.length;

  return {
    ...current,
    metrics: {
      ...current.metrics,
      dynamics: {
        previousCheckedAt: previous.snapshot.checkedAt,
        retained,
        entered: enteredAssets.length,
        exited: exitedAssets.length,
        enteredAi: enteredAssets.filter((asset) => asset.isAi === true).length,
        exitedAi: exitedAssets.filter((asset) => asset.isAi === true).length,
        movedUp,
        movedDown,
        unchangedRank,
        averageAbsoluteRankChange,
        biggestRise,
        biggestDrop,
        enteredTop10: enteredAssets.filter((asset) => asset.rank <= 10).length,
        enteredFreshOneMonth: enteredFreshAssets.length,
        enteredFreshTop10: enteredFreshAssets.filter((asset) => asset.rank <= 10).length,
        changed,
        significance: noiseThreshold === null
          ? "noise_not_calibrated"
          : changed <= noiseThreshold
            ? "no_change"
            : "changed",
        noiseThreshold,
      },
    },
  };
}

function errorAnalytics(error: unknown): TopicAnalytics {
  if (error instanceof AdobeScanError) {
    return {
      status: error.code,
      confidence: "unknown",
      snapshot: null,
      metrics: null,
      error: error.message,
    };
  }

  return {
    status: "error",
    confidence: "unknown",
    snapshot: null,
    metrics: null,
    error: error instanceof Error ? error.message : "Неизвестная ошибка анализа Adobe",
  };
}

export async function recalibrateTopicAnalytics(
  analytics: TopicAnalytics,
): Promise<TopicAnalytics> {
  if (!analytics.snapshot || !analytics.metrics) return analytics;

  const checkedAt = new Date(analytics.snapshot.checkedAt);
  const calibration = await loadCalibrationModel();
  if (calibration.points.length < 2) return analytics;

  const modelChanged = analytics.snapshot.dateModelVersion !== calibration.summary.modelVersion;
  const assets = analytics.snapshot.assets.map((asset) => {
    const title = typeof asset.title === "string" && asset.title.trim()
      ? asset.title.trim()
      : null;
    if (modelChanged) {
      const estimate = estimateDateFromId(calibration, asset.assetId);
      const timestamp = estimate.uploadDate
        ? Date.parse(`${estimate.uploadDate}T00:00:00Z`)
        : null;
      return {
        ...asset,
        title,
        estimatedUploadDate: estimate.uploadDate,
        estimatedAgeDays: timestamp === null
          ? null
          : Math.max(0, Math.floor((checkedAt.getTime() - timestamp) / DAY_MS)),
        dateSource: estimate.uploadDate ? "estimated_from_id" as const : "unknown" as const,
        dateErrorDays: estimate.errorDays,
      };
    }
    return { ...asset, title };
  });
  const dateCoverage = assets.length === 0
    ? 0
    : assets.filter((asset) => asset.estimatedUploadDate !== null).length / assets.length;
  const titleCoverage = assets.length === 0
    ? 0
    : assets.filter((asset) => asset.title !== null).length / assets.length;
  const metrics = deriveMetrics(
    assets,
    analytics.metrics.sales,
    checkedAt,
    analytics.snapshot.totalResults,
    analytics.snapshot.topic,
  );

  return {
    ...analytics,
    snapshot: {
      ...analytics.snapshot,
      assets,
      dateModelVersion: modelChanged
        ? calibration.summary.modelVersion
        : analytics.snapshot.dateModelVersion,
      coverage: { ...analytics.snapshot.coverage, dateCoverage, titleCoverage },
    },
    metrics: { ...metrics, dynamics: analytics.metrics.dynamics },
  };
}

export async function analyzeTopicTop100(topic: string): Promise<TopicAnalytics> {
  const cleanTopic = topic.trim();
  if (!cleanTopic) return errorAnalytics(new AdobeScanError("error", "Пустая тема"));
  if (signedInAdobeSessionDetected()) {
    return errorAnalytics(new AdobeScanError(
      "scan_blocked",
      "Обнаружена активная сессия Adobe. Откройте Stock в отдельном профиле без входа",
    ));
  }

  const batchId = crypto.randomUUID();
  const checkedAt = new Date();

  try {
    const calibration = await loadCalibrationModel(checkedAt);
    if (calibration.points.length < 2) {
      return {
        status: "calibration_missing",
        confidence: "unknown",
        snapshot: null,
        metrics: null,
        error: "Недостаточно точек калибровки ID → дата",
      };
    }

    const mainHtml = await fetchHtml(buildPhotoSearchUrl(cleanTopic));
    const mainPage = parseSearchPage(mainHtml, true);
    const assets: AssetObservation[] = mainPage.assets.map((asset) => {
      const estimate = estimateDateFromId(calibration, asset.assetId);
      const estimatedTimestamp = estimate.uploadDate
        ? Date.parse(`${estimate.uploadDate}T00:00:00Z`)
        : null;

      return {
        assetId: asset.assetId,
        rank: asset.rank,
        ingestPosition: asset.ingestPosition,
        title: asset.title,
        isAi: asset.isAi,
        estimatedUploadDate: estimate.uploadDate,
        estimatedAgeDays: estimatedTimestamp === null
          ? null
          : Math.max(0, Math.floor((checkedAt.getTime() - estimatedTimestamp) / DAY_MS)),
        dateSource: estimate.uploadDate ? "estimated_from_id" : "unknown",
        dateErrorDays: estimate.errorDays,
        salesStatus: "unknown",
      };
    });

    const coverage: ParserCoverage = {
      ...mainPage.coverage,
      dateCoverage: assets.length === 0
        ? 0
        : assets.filter((asset) => asset.estimatedUploadDate !== null).length / assets.length,
    };
    if (mainPage.totalResults !== 0) {
      await checkParserBaseline(coverage);
    }

    await waitRandom([1800, 3200]);
    const firstUndiscoveredHtml = await fetchHtml(buildPhotoSearchUrl(cleanTopic, 1, true));
    const firstUndiscovered = parseSearchPage(firstUndiscoveredHtml, false);
    const undiscoveredTotal = firstUndiscovered.totalResults;
    const undiscoveredIds = new Set(firstUndiscovered.assets.map((asset) => asset.assetId));
    let pagesScanned = 1;

    const shouldComplete = undiscoveredTotal !== null && undiscoveredTotal <= SALES_PAGE_LIMIT * 100;
    const pagesNeeded = shouldComplete
      ? Math.max(1, Math.ceil((undiscoveredTotal ?? 0) / 100))
      : 1;

    for (let page = 2; page <= pagesNeeded; page += 1) {
      await waitRandom([1800, 3200]);
      const html = await fetchHtml(buildPhotoSearchUrl(cleanTopic, page, true));
      const parsed = parseSearchPage(html, false);
      for (const asset of parsed.assets) undiscoveredIds.add(asset.assetId);
      pagesScanned += 1;
    }

    const exactSales = shouldComplete && undiscoveredTotal !== null && undiscoveredIds.size >= undiscoveredTotal;
    for (const asset of assets) {
      asset.salesStatus = undiscoveredIds.has(asset.assetId)
        ? "undiscovered"
        : exactSales
          ? "sold"
          : "unknown";
    }

    const sales: SalesCoverage = {
      mode: exactSales ? "exact" : undiscoveredTotal === null ? "unknown" : "partial",
      undiscoveredTotal,
      pagesScanned,
      pageLimit: SALES_PAGE_LIMIT,
      confirmedUndiscovered: assets.filter((asset) => asset.salesStatus === "undiscovered").length,
      confirmedAiUndiscovered: assets.filter(
        (asset) => asset.isAi === true && asset.salesStatus === "undiscovered",
      ).length,
      sold: exactSales ? assets.filter((asset) => asset.salesStatus === "sold").length : null,
      soldAi: exactSales
        ? assets.filter((asset) => asset.isAi === true && asset.salesStatus === "sold").length
        : null,
    };

    const snapshot = {
      batchId,
      topic: cleanTopic,
      checkedAt: checkedAt.toISOString(),
      source: "content_script_html" as const,
      filterSignature: FILTER_SIGNATURE,
      parserVersion: PARSER_VERSION,
      dateModelVersion: calibration.summary.modelVersion,
      totalResults: mainPage.totalResults,
      assets,
      coverage,
    };
    const metrics = deriveMetrics(assets, sales, checkedAt, mainPage.totalResults, cleanTopic);
    const calibrationCurrent = calibration.summary.status !== "expired" && calibration.summary.status !== "invalid";
    const completeCore = coverage.uniqueIdCoverage >= 0.95 && coverage.aiCoverage >= 0.95 && coverage.dateCoverage >= 0.9;
    const status = completeCore && calibrationCurrent && exactSales ? "ok" : "partial";
    const confidence = !completeCore || !calibrationCurrent
      ? "low"
      : exactSales
        ? "high"
        : "medium";

    return { status, confidence, snapshot, metrics };
  } catch (error) {
    return errorAnalytics(error);
  }
}

export async function analyzeTopicsWithDelay(
  topics: string[],
  favoriteTopics: Set<string>,
  progressCallback: AnalyticsProgressCallback,
  forceRefresh = false,
): Promise<Map<string, TopicAnalytics>> {
  const uniqueTopics = [...new Map(
    topics
      .map((topic) => topic.trim())
      .filter(Boolean)
      .map((topic) => [topic.toLocaleLowerCase(), topic]),
  ).values()];
  const result = new Map<string, TopicAnalytics>();

  for (let index = 0; index < uniqueTopics.length; index += 1) {
    const topic = uniqueTopics[index];
    const normalized = topic.toLocaleLowerCase();
    const isFavorite = favoriteTopics.has(normalized);
    const cachedValue = forceRefresh
      ? null
      : await getCachedTopicAnalytics(topic, isFavorite);
    const cached = cachedValue ? await recalibrateTopicAnalytics(cachedValue) : null;
    const previous = cached
      ? null
      : (await getLatestHistoricAnalytics(topic).catch(() => null))
        ?? (await getLatestStoredTopicAnalytics(topic));
    const scanned = cached ?? await analyzeTopicTop100(topic);
    const analytics = cached ? scanned : await attachDynamics(scanned, previous);

    result.set(normalized, analytics);
    progressCallback({ completed: index + 1, total: uniqueTopics.length, topic, analytics });

    if (!cached && (analytics.status === "ok" || analytics.status === "partial")) {
      await cacheTopicAnalytics(topic, analytics);
    }

    if (["waf_blocked", "parser_degraded", "scan_blocked"].includes(analytics.status)) {
      break;
    }
    if (index + 1 < uniqueTopics.length) await waitRandom([2500, 4500]);
  }

  return result;
}

export async function scrapeAdobeStock(
  keyword: string,
  filters: ContentFilter[] = ["photo"],
): Promise<TopicResult> {
  const totalResult = await scrapeAdobeCount(keyword, filters, false);
  if (totalResult.status !== "ok" || totalResult.demand === null) {
    return {
      ...totalResult,
      undiscoveredCount: null,
      marketSalesStatus: totalResult.status === "waf_blocked" ? "waf_blocked" : "unknown",
      totalAiCount: null,
      undiscoveredAiCount: null,
      marketAiStatus: "unknown",
    };
  }

  await waitRandom([900, 1600]);
  const undiscoveredResult = await scrapeAdobeCount(keyword, filters, true);
  if (undiscoveredResult.status !== "ok" || undiscoveredResult.demand === null) {
    return {
      ...totalResult,
      undiscoveredCount: null,
      marketSalesStatus: undiscoveredResult.status === "waf_blocked" ? "waf_blocked" : "error",
      totalAiCount: null,
      undiscoveredAiCount: null,
      marketAiStatus: "unknown",
    };
  }

  const compatible = undiscoveredResult.demand <= totalResult.demand;
  if (!compatible) {
    return {
      ...totalResult,
      undiscoveredCount: null,
      marketSalesStatus: "error",
      totalAiCount: null,
      undiscoveredAiCount: null,
      marketAiStatus: "unknown",
    };
  }

  await waitRandom([900, 1600]);
  const totalAiResult = await scrapeAdobeCount(keyword, filters, false, true);
  if (totalAiResult.status !== "ok" || totalAiResult.demand === null) {
    return {
      ...totalResult,
      undiscoveredCount: undiscoveredResult.demand,
      marketSalesStatus: "ok",
      totalAiCount: null,
      undiscoveredAiCount: null,
      marketAiStatus: totalAiResult.status === "waf_blocked" ? "waf_blocked" : "error",
    };
  }

  await waitRandom([900, 1600]);
  const undiscoveredAiResult = await scrapeAdobeCount(keyword, filters, true, true);
  if (undiscoveredAiResult.status !== "ok" || undiscoveredAiResult.demand === null) {
    return {
      ...totalResult,
      undiscoveredCount: undiscoveredResult.demand,
      marketSalesStatus: "ok",
      totalAiCount: totalAiResult.demand,
      undiscoveredAiCount: null,
      marketAiStatus: undiscoveredAiResult.status === "waf_blocked" ? "waf_blocked" : "error",
    };
  }

  const compatibleAi = (
    totalAiResult.demand <= totalResult.demand
    && undiscoveredAiResult.demand <= undiscoveredResult.demand
    && undiscoveredAiResult.demand <= totalAiResult.demand
  );
  return {
    ...totalResult,
    undiscoveredCount: undiscoveredResult.demand,
    marketSalesStatus: "ok",
    totalAiCount: compatibleAi ? totalAiResult.demand : null,
    undiscoveredAiCount: compatibleAi ? undiscoveredAiResult.demand : null,
    marketAiStatus: compatibleAi ? "ok" : "error",
  };
}

async function scrapeAdobeCount(
  keyword: string,
  filters: ContentFilter[],
  undiscovered: boolean,
  gentechOnly = false,
): Promise<TopicResult> {
  try {
    const filterParams = buildFilterParams(filters);
    const encodedKeyword = encodeURIComponent(keyword);
    const undiscoveredParam = undiscovered ? "&filters[undiscovered]=only" : "";
    const gentechParam = gentechOnly ? "&filters[gentech]=only" : "";

    try {
      const response = await runSingleRequest(() => fetch(
        `${ADOBE_STOCK_BASE}/Ajax/Search?k=${encodedKeyword}&${filterParams}${undiscoveredParam}${gentechParam}&get_facets_only=1`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json, text/javascript, */*; q=0.01",
            "Accept-Language": "en-US,en;q=0.9",
            "X-Requested-With": "XMLHttpRequest",
          },
        },
      ));

      if (response.status === 403 || response.status === 429) {
        return { topic: keyword, demand: null, status: "waf_blocked" };
      }
      if (response.ok) {
        const text = await response.text();
        if (containsBlockPage(text)) {
          return { topic: keyword, demand: null, status: "waf_blocked" };
        }
        const data = JSON.parse(text) as Record<string, unknown>;
        const total = data.total ?? data.nb_results ?? data.totalResults;
        if (typeof total === "number") {
          return { topic: keyword, demand: total, status: "ok" };
        }
      }
    } catch {
      // The HTML fallback below is deliberately kept for format changes.
    }

    return await scrapeHtmlFallback(keyword, filters, undiscovered, gentechOnly);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isBlocked = /403|429|datadome|failed to fetch|networkerror/i.test(message);
    return { topic: keyword, demand: null, status: isBlocked ? "waf_blocked" : "error" };
  }
}

async function scrapeHtmlFallback(
  keyword: string,
  filters: ContentFilter[],
  undiscovered: boolean,
  gentechOnly: boolean,
): Promise<TopicResult> {
  try {
    const filterParams = buildFilterParams(filters);
    const undiscoveredParam = undiscovered ? "&filters[undiscovered]=only" : "";
    const gentechParam = gentechOnly ? "&filters[gentech]=only" : "";
    const html = await fetchHtml(
      `${ADOBE_STOCK_BASE}/search?k=${encodeURIComponent(keyword)}&${filterParams}${undiscoveredParam}${gentechParam}`,
    );
    const documentValue = new DOMParser().parseFromString(html, "text/html");
    const total = parseResultCount(documentValue);
    return total === null
      ? { topic: keyword, demand: null, status: "error" }
      : { topic: keyword, demand: total, status: "ok" };
  } catch (error) {
    return {
      topic: keyword,
      demand: null,
      status: error instanceof AdobeScanError && error.code === "waf_blocked"
        ? "waf_blocked"
        : "error",
    };
  }
}

export type ProgressCallback = (
  completedIndex: number,
  result: TopicResult,
  totalCount: number,
) => void;

export async function processTopicsWithDelay(
  topics: string[],
  filters: ContentFilter[],
  progressCallback: ProgressCallback,
  delayMs: [number, number] = [1800, 3200],
): Promise<TopicResult[]> {
  const results: TopicResult[] = [];

  for (let index = 0; index < topics.length; index += 1) {
    const result = await scrapeAdobeStock(topics[index], filters);
    results.push(result);
    progressCallback(index, result, topics.length);

    if (
      result.status === "waf_blocked"
      || result.marketSalesStatus === "waf_blocked"
      || result.marketAiStatus === "waf_blocked"
    ) break;
    if (index + 1 < topics.length) await waitRandom(delayMs);
  }

  return results;
}

export function checkSanity(results: TopicResult[]): string | null {
  if (results.length <= 5) return null;

  const failed = results.filter(
    (result) => result.status === "error" || result.status === "waf_blocked" || result.demand === 0,
  ).length;
  const ratio = failed / results.length;

  if (ratio > 0.8) {
    return `⚠️ Аномально много нулевых или ошибочных результатов (${(ratio * 100).toFixed(0)}%). Очередь остановлена до проверки Adobe.`;
  }
  return null;
}
