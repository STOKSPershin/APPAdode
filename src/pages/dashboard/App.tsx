import { useState, useEffect, useCallback } from "react";
import {
  AuthScreen,
  Header,
  ResultsPlaceholder,
  ResultsTable,
  SavedItems,
} from "./components";
import type { TopicResult } from "@shared/types";
import { checkAndRevalidateSession } from "../../shared/api/auth";

/** Shape of data saved by ContentApp to chrome.storage.local */
interface ScanPayload {
  userTopicResult: TopicResult;
  results: TopicResult[];
  warning: string | null;
  topic: string;
  timestamp: number;
  model: string;
  filters: string[];
  minResults?: number;
  maxResults?: number;
}

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
  // ── Auth State ─────────────────────────────────────
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // ── Results State ──────────────────────────────────
  const [userTopicResult, setUserTopicResult] = useState<TopicResult | null>(null);
  const [results, setResults] = useState<TopicResult[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [scanMeta, setScanMeta] = useState<{ topic: string; model: string; timestamp: number } | null>(null);
  const [hasData, setHasData] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"scan" | "saved">("scan");

  // ── Check auth on mount & start 10min revalidation ──
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    const verify = async () => {
      try {
        const isValid = await checkAndRevalidateSession();
        setIsAuthenticated(isValid);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsCheckingAuth(false);
      }
    };

    verify();

    // Re-validate every 10 minutes
    interval = setInterval(verify, 10 * 60 * 1000);

    return () => clearInterval(interval);
  }, []);

  // ── Load scan results from chrome.storage ──────────
  useEffect(() => {
    const loadResults = async () => {
      try {
        if (typeof chrome !== "undefined" && chrome.storage?.local) {
          const data = await chrome.storage.local.get(STORAGE_KEY);
          const payload = data[STORAGE_KEY] as ScanPayload | undefined;

          if (payload && payload.results && payload.results.length > 0) {
            const min = payload.minResults ?? 0;
            const max = payload.maxResults ?? Infinity;
            
            const filteredResults = payload.results.filter(r => {
              if (r.demand === null) return false;
              return r.demand >= min && r.demand <= max;
            });

            setUserTopicResult(payload.userTopicResult);
            setResults(filteredResults);
            setWarning(payload.warning);
            setScanMeta({
              topic: payload.topic,
              model: payload.model,
              timestamp: payload.timestamp,
            });
            setHasData(true);
          }
        }
      } catch (err) {
        console.error("[Dashboard] Failed to load results:", err);
      } finally {
        setIsLoading(false);
      }
    };

    loadResults();
  }, []);

  // ── Handlers ───────────────────────────────────────
  const handleAuthenticated = useCallback((licenseKey: string) => {
    console.log("[Dashboard] Authenticated:", licenseKey.slice(0, 4) + "...");
    setIsAuthenticated(true);
  }, []);

  const handleOpenAdobeStock = () => {
    window.open("https://stock.adobe.com", "_blank");
  };

  // ── Loading State ──────────────────────────────────
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-text-muted">Загрузка...</span>
        </div>
      </div>
    );
  }

  // ── Auth Screen ────────────────────────────────────
  if (!isAuthenticated) {
    return <AuthScreen onAuthenticated={handleAuthenticated} />;
  }

  // ── Dashboard ──────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg-primary flex flex-col">
      <Header />

      <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-6 space-y-5">
        
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
        </div>

        {activeTab === "saved" ? (
          <SavedItems />
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
                  Последний скан: <span className="text-accent">{scanMeta.topic}</span>
                </p>
                <p className="text-xs text-text-muted">
                  {scanMeta.model} · {new Date(scanMeta.timestamp).toLocaleString("ru-RU")}
                </p>
              </div>
            </div>
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
            userTopicResult={userTopicResult}
            results={results}
            warning={warning}
            expectedCount={results.length}
            isGenerating={false}
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
