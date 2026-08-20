import { useCallback, useState, useEffect } from "react";
import {
  CalibrationPanel,
  Header,
  HistoryPanel,
  PortfolioPanel,
  ResultsPlaceholder,
  ResultsTable,
  SavedItems,
  ScanQueuePanel,
} from "./components";
import type { ScanPayload, TopicResult } from "@shared/types";
import { recalibrateTopicAnalytics } from "@shared/api/adobe-stock";
import { findScanSession, getHistoryStats, getScanSession } from "@shared/api/history";

const STORAGE_KEY = "latest_scan_results";

/**
 * TopicHunter Dashboard — Results Viewer
 *
 * Architecture pivot: The dashboard is now a READ-ONLY results viewer.
 * All input controls + scraping logic moved to the Content Script panel
 * that runs on stock.adobe.com (same-origin, bypasses DataDome WAF).
 *
 * Flow:
 * 1. Content Script scrapes → saves results to chrome.storage.local
 * 2. Content Script sends OPEN_DASHBOARD → SW opens this tab
 * 3. This component reads results from storage and displays them
 */
export default function App() {
  // ── Results State ──────────────────────────────────
  const [userTopicResult, setUserTopicResult] = useState<TopicResult | null>(null);
  const [results, setResults] = useState<TopicResult[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<{
    topic: string;
    model: string;
    timestamp: number;
    historySessionId?: string;
  } | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [latestPayload, setLatestPayload] = useState<ScanPayload | null>(null);
  const [viewingHistorical, setViewingHistorical] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyStats, setHistoryStats] = useState<{ sessions: number; topics: number } | null>(null);
  const [activeTab, setActiveTab] = useState<"scan" | "saved" | "calibration" | "portfolio" | "queue" | "history">("scan");

  const displayScan = useCallback(async (payload: ScanPayload, historical: boolean) => {
    const [recalibratedUserAnalytics, recalibratedResults] = await Promise.all([
      payload.userTopicResult.analytics
        ? recalibrateTopicAnalytics(payload.userTopicResult.analytics)
        : Promise.resolve(undefined),
      Promise.all(payload.results.map(async (result) => ({
        ...result,
        analytics: result.analytics
          ? await recalibrateTopicAnalytics(result.analytics)
          : undefined,
      }))),
    ]);
    setUserTopicResult({
      ...payload.userTopicResult,
      analytics: recalibratedUserAnalytics,
    });
    setResults(recalibratedResults);
    setWarning(payload.warning);
    setScanMeta({
      topic: payload.topic,
      model: payload.model,
      timestamp: payload.timestamp,
      historySessionId: payload.historySessionId,
    });
    setHasData(true);
    setViewingHistorical(historical);
  }, []);

  // ── Load scan results from chrome.storage ──────────
  useEffect(() => {
    const loadResults = async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const data = await chrome.storage.local.get(STORAGE_KEY);
          const payload = data[STORAGE_KEY] as ScanPayload | undefined;

          if (payload && payload.results && payload.userTopicResult) {
            setLatestPayload(payload);
            await displayScan(payload, false);
          }
        }
      } catch (err) {
        console.error("[Dashboard] Failed to load results:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadResults();
  }, [displayScan]);

  useEffect(() => {
    getHistoryStats()
      .then(setHistoryStats)
      .catch(() => setHistoryStats(null));
  }, []);

  // ── Handlers ───────────────────────────────────────
  const handleOpenAdobeStock = () => {
    window.open("https://stock.adobe.com", "_blank");
  };

  const handleOpenHistoryScan = async (request: {
    sessionId?: string;
    mainTopic: string;
    nearTimestamp?: number;
  }) => {
    setIsLoading(true);
    setHistoryError("");
    try {
      const payload = request.sessionId
        ? await getScanSession(request.sessionId)
        : await findScanSession(request.mainTopic, request.nearTimestamp);
      if (!payload) {
        throw new Error(`Не найден сохранённый скан темы «${request.mainTopic}»`);
      }
      await displayScan(payload, true);
      setActiveTab("scan");
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : "Не удалось открыть сохранённый скан");
    } finally {
      setIsLoading(false);
    }
  };

  const handleReturnToLatest = async () => {
    if (!latestPayload) return;
    setIsLoading(true);
    setHistoryError("");
    try {
      await displayScan(latestPayload, false);
    } finally {
      setIsLoading(false);
    }
  };

  // ── Dashboard ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-[1600px] mx-auto px-6 py-6 space-y-5">
        
        {/* Tabs */}
        <div className="flex items-center gap-2 border-b border-border mb-6">
          <button
            onClick={() => setActiveTab("scan")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "scan"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            Последний скан
          </button>
          <button
            onClick={() => setActiveTab("saved")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "saved"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            Избранное
          </button>
          <button
            onClick={() => setActiveTab("calibration")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "calibration"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            Калибровка дат
          </button>
          <button
            onClick={() => setActiveTab("portfolio")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "portfolio"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            Мои загрузки и продажи
          </button>
          <button
            onClick={() => setActiveTab("queue")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "queue"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            Очередь сканирования
          </button>
          <button
            onClick={() => setActiveTab("history")}
            className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "history"
                ? "border-accent text-accent"
                : "border-transparent text-text-muted hover:text-text-primary hover:border-border"
            }`}
          >
            База тем
          </button>
        </div>

        {historyError && (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-error/20 bg-error/8 px-5 py-3">
            <p className="text-sm text-error">{historyError}</p>
            <button type="button" onClick={() => setHistoryError("")} className="text-error cursor-pointer">×</button>
          </div>
        )}

        {activeTab === "queue" ? (
          <ScanQueuePanel />
        ) : activeTab === "history" ? (
          <HistoryPanel onOpenScan={(request) => void handleOpenHistoryScan(request)} />
        ) : activeTab === "portfolio" ? (
          <PortfolioPanel />
        ) : activeTab === "calibration" ? (
          <CalibrationPanel />
        ) : activeTab === "saved" ? (
          <SavedItems onOpenScan={(request) => void handleOpenHistoryScan(request)} />
        ) : (
          <>
            {/* Scan metadata banner */}
            {scanMeta && (
          <div className="bg-bg-card border border-border rounded-2xl p-4 flex items-center justify-between animate-fade-in">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-success/10 border border-success/20">
                <svg className="w-4.5 h-4.5 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-text-primary">
                  {viewingHistorical ? "Сохранённый скан" : "Последний скан"}: <span className="text-accent">{scanMeta.topic}</span>
                </p>
                <p className="text-xs text-text-muted">
                  {scanMeta.model} · {new Date(scanMeta.timestamp).toLocaleString("ru-RU")}
                  {viewingHistorical && <span className="ml-2 rounded-md border border-accent/25 bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-accent">История</span>}
                </p>
                {historyStats && (
                  <p className="mt-0.5 text-[11px] text-text-muted">
                    Локальная история: {historyStats.sessions} поисков · {historyStats.topics} снимков тем
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {viewingHistorical && latestPayload && (
                <button
                  type="button"
                  onClick={() => void handleReturnToLatest()}
                  className="rounded-xl border border-border bg-bg-input px-4 py-2 text-sm font-medium text-text-secondary cursor-pointer hover:border-border-hover hover:text-text-primary"
                >
                  Вернуться к последнему
                </button>
              )}
              <button
                type="button"
                onClick={handleOpenAdobeStock}
                className="
                  px-4 py-2 rounded-xl text-sm font-medium
                  bg-accent text-white hover:bg-accent-hover
                  transition-all duration-200 cursor-pointer
                  flex items-center gap-2
                "
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Новый скан
              </button>
            </div>
          </div>
        )}

        {/* Results or placeholder */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <svg className="w-8 h-8 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : hasData ? (
          <ResultsTable
            mainTopic={scanMeta?.topic ?? userTopicResult?.topic ?? ""}
            userTopicResult={userTopicResult}
            results={results}
            warning={warning}
            expectedCount={results.length}
            isGenerating={false}
            scanSessionId={scanMeta?.historySessionId}
            scanTimestamp={scanMeta?.timestamp}
          />
        ) : (
          <div className="space-y-4">
            <ResultsPlaceholder />
            {/* CTA to open Adobe Stock */}
            <div className="flex justify-center">
              <button
                type="button"
                onClick={handleOpenAdobeStock}
                className="
                  px-6 py-3 rounded-xl text-sm font-semibold
                  bg-accent text-white hover:bg-accent-hover
                  transition-all duration-200 cursor-pointer
                  shadow-lg shadow-accent/25
                  flex items-center gap-2.5
                "
              >
                <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                </svg>
                Открыть Adobe Stock для сканирования
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-border py-4">
        <p className="text-center text-xs text-text-muted">
          © 2026 StockBooster ·{" "}
          <span className="text-text-secondary">TopicHunter</span>{" "}
          · Powered by OpenAI
        </p>
      </footer>
    </div>
  );
}
