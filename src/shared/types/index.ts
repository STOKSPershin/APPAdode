/**
 * Shared TypeScript types for the TopicHunter extension
 */

// ── AI Provider / Model ────────────────────────────────────────────

export type AIProvider = "openai";

export interface AIModelOption {
  id: string;          // e.g. "gpt-5.4-mini"
  label: string;       // e.g. "GPT-5.4 Mini"
}

/** Available models for the extension */
export const AVAILABLE_MODELS: AIModelOption[] = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.1-mini", label: "GPT-5.1 Mini" },
];

// ── Adobe Stock Filters ────────────────────────────────────────────

export type ContentFilter = "photo" | "vector" | "illustration" | "video";

export interface FilterOption {
  id: ContentFilter;
  label: string;
}

export const CONTENT_FILTERS: FilterOption[] = [
  { id: "photo", label: "Фото" },
  { id: "vector", label: "Векторы" },
  { id: "illustration", label: "Иллюстрации" },
  { id: "video", label: "Видео" },
];

// ── Topic Generation ───────────────────────────────────────────────

export interface TopicRequest {
  prompt: string;
  model: string;
  filters: ContentFilter[];
  minResults: number;
  maxResults: number;
  userTopic?: string;
  userApiKey: string;
}

export interface TopicResult {
  topic: string;
  demand: number | null;
  status: "ok" | "error" | "waf_blocked" | "pending";
  undiscoveredCount?: number | null;
  marketSalesStatus?: "ok" | "unknown" | "error" | "waf_blocked";
  totalAiCount?: number | null;
  undiscoveredAiCount?: number | null;
  marketAiStatus?: "ok" | "unknown" | "error" | "waf_blocked";
  activity?: MarketActivity;
  analytics?: TopicAnalytics;
}

export interface ActivityEstimate {
  trials: number;
  successes: number;
  rate30: number;
  wilsonLower30: number;
}

export interface MarketActivity {
  status: "ready" | "collecting" | "invalid";
  reason: string;
  baselineCheckedAt: string | null;
  currentCheckedAt: string;
  intervalDays: number | null;
  overall: ActivityEstimate | null;
  ai: ActivityEstimate | null;
  nonAi: ActivityEstimate | null;
  percentile: number | null;
  quintile: 1 | 2 | 3 | 4 | 5 | null;
  poolSize: number;
  methodVersion: "net-first-sale-v1";
}

export interface TopicHistoryEntry {
  id: string;
  sessionId: string;
  topicKey: string;
  topic: string;
  mainTopic: string | null;
  checkedAt: string;
  isSource: boolean;
  result: TopicResult;
}

export interface ActivityPoolEntry {
  topicKey: string;
  wilsonLower30: number;
}

// ── Top-100 analytics ─────────────────────────────────────────────

export type AnalyticsStatus =
  | "ok"
  | "partial"
  | "pending"
  | "not_scanned"
  | "scan_blocked"
  | "waf_blocked"
  | "parser_degraded"
  | "calibration_missing"
  | "error";

export type SalesStatus = "sold" | "undiscovered" | "unknown";
export type DateSource = "exact" | "estimated_from_id" | "unknown";
export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";
export type SalesCoverageMode = "exact" | "partial" | "unknown";
export type AgeWindowMonths = 1 | 2 | 3 | 6;

export interface DateCalibrationAnchor {
  assetId: string;
  uploadDate: string;
  source: "seed" | "import";
  importedAt?: string;
}

export interface DateCalibrationSummary {
  anchorCount: number;
  datePointCount: number;
  earliestDate: string | null;
  latestDate: string | null;
  validUntil: string | null;
  p90ErrorDays: number | null;
  maxErrorDays: number | null;
  modelVersion: string;
  status: "current" | "due_soon" | "expired" | "invalid";
}

export interface AssetObservation {
  assetId: string;
  rank: number;
  ingestPosition: string | null;
  title: string | null;
  isAi: boolean | null;
  estimatedUploadDate: string | null;
  estimatedAgeDays: number | null;
  dateSource: DateSource;
  dateErrorDays: number | null;
  salesStatus: SalesStatus;
}

export interface ParserCoverage {
  expectedAssets: number;
  parsedAssets: number;
  uniqueIdCoverage: number;
  aiCoverage: number;
  titleCoverage: number;
  dateCoverage: number;
}

export interface RawTop100Snapshot {
  batchId: string;
  topic: string;
  checkedAt: string;
  source: "content_script_html";
  filterSignature: string;
  parserVersion: string;
  dateModelVersion: string;
  totalResults: number | null;
  assets: AssetObservation[];
  coverage: ParserCoverage;
}

export interface SalesCoverage {
  mode: SalesCoverageMode;
  undiscoveredTotal: number | null;
  pagesScanned: number;
  pageLimit: number;
  confirmedUndiscovered: number;
  confirmedAiUndiscovered: number;
  sold: number | null;
  soldAi: number | null;
}

export interface AgeWindowMetric {
  months: AgeWindowMonths;
  total: number;
  ai: number;
  top10Count: number;
  soldAi: number | null;
  confirmedAiUndiscovered: number;
  unknownAiSales: number;
}

export interface Top100Dynamics {
  previousCheckedAt: string;
  retained: number;
  entered: number;
  exited: number;
  enteredAi: number;
  exitedAi: number;
  movedUp: number;
  movedDown: number;
  unchangedRank: number;
  averageAbsoluteRankChange: number;
  biggestRise: number;
  biggestDrop: number;
  enteredTop10: number;
  enteredFreshOneMonth: number;
  enteredFreshTop10: number;
  changed: number;
  significance: "changed" | "no_change" | "noise_not_calibrated";
  noiseThreshold: number | null;
}

export interface Top100Metrics {
  topCount: number;
  aiCount: number;
  aiTop10Count: number;
  unknownAiCount: number;
  marketSoldCount: number | null;
  imagesPerSoldAsset: number | null;
  titleMatchesTop10: number | null;
  titleCoverageTop10: number;
  soldAi: number | null;
  confirmedAiUndiscovered: number;
  ageWindows: AgeWindowMetric[];
  olderThanSixMonths: number;
  dateUnknown: number;
  sales: SalesCoverage;
  dynamics: Top100Dynamics | null;
  verdict: "open" | "frozen" | "no_fresh_ai" | "insufficient_data";
  verdictReason: string;
}

export interface TopicAnalytics {
  status: AnalyticsStatus;
  confidence: ConfidenceLevel;
  snapshot: RawTop100Snapshot | null;
  metrics: Top100Metrics | null;
  error?: string;
  cached?: boolean;
}

export interface TopicResponse {
  userTopicResult?: TopicResult;
  results: TopicResult[];
  warning?: string;
  creditsUsed: number;
}

// ── Saved Items ────────────────────────────────────────────────────

export interface SavedItem {
  id: string;
  mainTopic: string;
  subtopic: string;
  demand: number | null;
  undiscoveredCount?: number | null;
  totalAiCount?: number | null;
  undiscoveredAiCount?: number | null;
  activity?: MarketActivity;
  createdAt: string;
  analytics?: TopicAnalytics;
  historySessionId?: string;
  scanTimestamp?: number;
}

export interface ScanPayload {
  userTopicResult: TopicResult;
  results: TopicResult[];
  warning: string | null;
  topic: string;
  timestamp: number;
  model: string;
  filters: ContentFilter[];
  minResults: number;
  maxResults: number;
  historySessionId?: string;
}

// ── Main topic scan queue ─────────────────────────────────────────

export type MainTopicQueueItemStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type MainTopicQueueStatus =
  | "idle"
  | "running"
  | "paused"
  | "blocked"
  | "completed";

export interface MainTopicQueueItem {
  id: string;
  topic: string;
  status: MainTopicQueueItemStatus;
  addedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  error: string | null;
  historySessionId: string | null;
  claimedBy: string | null;
  leaseUntil: string | null;
}

export interface MainTopicQueueState {
  version: 1;
  status: MainTopicQueueStatus;
  items: MainTopicQueueItem[];
  activeItemId: string | null;
  scheduledAt: string | null;
  nextRunAt: string | null;
  delayMinMinutes: number;
  delayMaxMinutes: number;
  lastError: string | null;
  updatedAt: string;
}

export interface MainTopicQueueClaim {
  state: MainTopicQueueState;
  item: MainTopicQueueItem | null;
  waitUntil: string | null;
}

// ── Own portfolio outcomes ────────────────────────────────────────

export interface OwnPortfolioAsset {
  id: string;
  assetId: string;
  topic: string;
  uploadedAt: string;
  isAi: boolean;
  createdAt: string;
}

export interface OwnSaleEvent {
  id: string;
  assetId: string;
  soldAt: string;
  revenue: number | null;
  note: string;
  createdAt: string;
}

export interface ImportedAdobeSale {
  id: string;
  rowNumber: number;
  soldAt: string;
  assetId: string;
  title: string;
  licenseType: string;
  revenue: number;
  contentType: string;
  fileName: string;
  contributor: string;
  size: string;
}

export interface AdobeSalesImport {
  version: 1;
  importedAt: string;
  sourceFileName: string;
  records: ImportedAdobeSale[];
}

// ── Extension Settings (chrome.storage) ────────────────────────────

export interface ExtensionSettings {
  defaultModel: string;
  defaultFilters: ContentFilter[];
  defaultMinResults: number;
  defaultMaxResults: number;
}

// ── Message Types (chrome.runtime messaging) ───────────────────────

export type ExtensionMessage =
  | { type: "PING" }
  | { type: "OPEN_DASHBOARD" }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: ExtensionSettings };

export type ExtensionResponse =
  | { status: "PONG"; version: string }
  | { status: "OK" }
  | { error: string };
