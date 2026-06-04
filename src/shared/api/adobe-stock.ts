/**
 * Adobe Stock Scraper — runs client-side to bypass DataDome WAF
 *
 * Since the browser extension makes requests from a real Chrome browser,
 * TLS fingerprint (JA3) is genuine — no curl_cffi impersonation needed.
 *
 * Primary strategy: AJAX endpoint /Ajax/Search?get_facets_only=1 → JSON { total: N }
 */

import type { ContentFilter, TopicResult } from "@shared/types";

const ADOBE_STOCK_BASE = "https://stock.adobe.com";

/**
 * Map our filter IDs to Adobe Stock content_type parameter values.
 */
const FILTER_PARAM_MAP: Record<ContentFilter, string> = {
  photo: "photo",
  vector: "vector",
  illustration: "illustration",
  video: "video",
};

/**
 * Build the filter query string for Adobe Stock API.
 * Example: "filters[content_type:photo]=1&filters[content_type:vector]=1"
 */
function buildFilterParams(filters: ContentFilter[]): string {
  return filters
    .map((f) => `filters[content_type:${FILTER_PARAM_MAP[f]}]=1`)
    .join("&");
}

// ────────────────────────────────────────────────────────────────────
// Single topic scraper
// ────────────────────────────────────────────────────────────────────

/**
 * Scrape demand count for a single keyword from Adobe Stock.
 *
 * Uses the AJAX JSON endpoint (fast, no HTML parsing needed).
 * Falls back to HTML page scraping if AJAX fails.
 */
export async function scrapeAdobeStock(
  keyword: string,
  filters: ContentFilter[] = ["photo"],
): Promise<TopicResult> {
  try {
    const filterParams = buildFilterParams(filters);
    const encodedKeyword = encodeURIComponent(keyword);

    // ── Strategy 1: AJAX JSON endpoint ──────────────
    try {
      const ajaxUrl = `${ADOBE_STOCK_BASE}/Ajax/Search?k=${encodedKeyword}&${filterParams}&get_facets_only=1`;
      const response = await fetch(ajaxUrl, {
        method: "GET",
        credentials: "omit",
        headers: {
          "Accept": "application/json, text/javascript, */*; q=0.01",
          "Accept-Language": "en-US,en;q=0.9",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${ADOBE_STOCK_BASE}/search?k=${encodedKeyword}`,
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "same-origin",
        },
      });

      if (response.ok) {
        const data = await response.json();
        const total = data.total ?? data.nb_results ?? data.totalResults;
        if (typeof total === "number") {
          return { topic: keyword, demand: total, status: "ok" };
        }
      }
    } catch (ajaxErr) {
      console.warn(`[Scraper] AJAX strategy failed for "${keyword}", falling back to HTML:`, ajaxErr);
    }

    // ── Strategy 2: HTML fallback ───────────────────
    return await scrapeHtmlFallback(keyword, filters);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const isCORS = err.message.includes("Failed to fetch") || err.message.includes("NetworkError");

    return {
      topic: keyword,
      demand: null,
      status: isCORS ? "waf_blocked" : "error",
    };
  }
}

/**
 * HTML fallback — parse result count from the full search page.
 */
async function scrapeHtmlFallback(
  keyword: string,
  filters: ContentFilter[],
): Promise<TopicResult> {
  try {
    const filterParams = buildFilterParams(filters);
    const url = `${ADOBE_STOCK_BASE}/search?k=${encodeURIComponent(keyword)}&${filterParams}`;

    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    });

    if (response.status === 403 || response.status === 429) {
      return { topic: keyword, demand: null, status: "waf_blocked" };
    }

    if (!response.ok) {
      return { topic: keyword, demand: null, status: "error" };
    }

    const html = await response.text();

    const patterns = [
      /"nb_results"\s*:\s*(\d+)/,
      /"total"\s*:\s*(\d+)/,
      /data-search-nb-results="(\d+)"/,
      /(\d[\d,]+)\s+results?\s+found/i,
      /Showing\s+\d+[-–]\d+\s+of\s+([\d,]+)/i,
      /"totalResults"\s*:\s*(\d+)/,
      /(\d[\d,]+)\s+assets?\s+found/i,
      /"count"\s*:\s*(\d+)/,
      /data-test-id="search-results-count"[^>]*>([^<]+)</,
      /aria-label="([\d,]+) results"/i,
      /aria-label="([\d,]+) images"/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        // For the data-test-id match, it might contain text like "10,000 results", so extract digits
        const digitsOnly = match[1].replace(/[^\d]/g, "");
        const count = parseInt(digitsOnly, 10);
        if (!isNaN(count)) {
          return { topic: keyword, demand: count, status: "ok" };
        }
      }
    }

    return { topic: keyword, demand: null, status: "error" };
  } catch {
    return { topic: keyword, demand: null, status: "error" };
  }
}

// ────────────────────────────────────────────────────────────────────
// Orchestrator: batch scraping with delays + progress callback
// ────────────────────────────────────────────────────────────────────

export type ProgressCallback = (
  completedIndex: number,
  result: TopicResult,
  totalCount: number,
) => void;

/**
 * Process an array of topics with rate-limiting and progress updates.
 *
 * Scrapes in batches of `batchSize` with `delayMs` between batches.
 * Calls `progressCallback` after each individual topic is scraped,
 * so the UI can update the table row-by-row.
 *
 * @param topics           - Array of topic strings to scrape
 * @param filters          - Adobe Stock content type filters
 * @param progressCallback - Called after each topic is scraped
 * @param batchSize        - Number of concurrent requests per batch (default: 3)
 * @param delayMs          - Delay range [min, max] in ms between batches (default: [1200, 2500])
 */
export async function processTopicsWithDelay(
  topics: string[],
  filters: ContentFilter[],
  progressCallback: ProgressCallback,
  batchSize = 3,
  delayMs: [number, number] = [1200, 2500],
): Promise<TopicResult[]> {
  const allResults: TopicResult[] = [];

  // Process in batches
  for (let i = 0; i < topics.length; i += batchSize) {
    const batch = topics.slice(i, i + batchSize);

    // Run batch concurrently
    const batchPromises = batch.map(async (topic, batchIdx) => {
      const globalIdx = i + batchIdx;
      const result = await scrapeAdobeStock(topic, filters);
      allResults[globalIdx] = result;
      progressCallback(globalIdx, result, topics.length);
      return result;
    });

    await Promise.all(batchPromises);

    // Add random delay between batches (skip after last batch)
    if (i + batchSize < topics.length) {
      const [min, max] = delayMs;
      const delay = Math.random() * (max - min) + min;
      console.log(`[Scraper] Batch done (${i + batch.length}/${topics.length}), waiting ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return allResults;
}

// ────────────────────────────────────────────────────────────────────
// Sanity check
// ────────────────────────────────────────────────────────────────────

/**
 * Detect if scraper is being blocked (>80% zero/error results).
 * Returns a warning message string, or null if everything looks fine.
 */
export function checkSanity(results: TopicResult[]): string | null {
  if (results.length <= 5) return null;

  const failCount = results.filter(
    (r) => r.status === "error" || r.status === "waf_blocked" || r.demand === 0,
  ).length;

  const ratio = failCount / results.length;

  if (ratio > 0.8) {
    return `⚠️ Внимание: Аномально много нулевых результатов (${(ratio * 100).toFixed(0)}%). Возможно, скрапер заблокирован Adobe или изменилась вёрстка сайта.`;
  }

  return null;
}
