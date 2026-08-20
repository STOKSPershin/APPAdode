import { useState, useEffect, useCallback, useRef } from "react";
import {
  AVAILABLE_MODELS,
  CONTENT_FILTERS,
  type ContentFilter,
  type ScanPayload,
} from "@shared/types";
import { generateTopics } from "@shared/api/openai";
import {
  analyzeTopicsWithDelay,
  scrapeAdobeStock,
  processTopicsWithDelay,
  checkSanity,
} from "@shared/api/adobe-stock";
import { getSavedTopics } from "@shared/api/saved-items";
import { saveScanHistory } from "@shared/api/history";
import { enrichMarketActivities } from "@shared/api/market-activity";
import {
  claimNextMainTopic,
  failMainTopicQueueItem,
  finishMainTopicQueueItem,
  renewMainTopicLease,
} from "@shared/api/scan-queue";

const DEFAULT_PROMPT = `Разбей тему '' на 10 конкретных, коммерческих подтем (visual concepts), которые покупатели ищут на стоках. Темы должны быть описательными и состоять из 1-3 слов. Верни ТОЛЬКО валидный JSON массив строк на английском языке (["topic1", "topic2"]).`;

const STORAGE_KEY = "latest_scan_results";

interface ScanSettings {
  apiKey: string;
  model: string;
  filters: ContentFilter[];
  prompt: string;
  minResults: number;
  maxResults: number;
}

interface ScanExecutionResult {
  historySessionId: string;
  blockedReason?: string;
}

export default function ContentApp() {
  const [isOpen, setIsOpen] = useState(false);
  const [isPromptOpen, setIsPromptOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(AVAILABLE_MODELS[0].id);
  const [filters, setFilters] = useState<ContentFilter[]>(["photo"]);
  const [topic, setTopic] = useState("");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [phase, setPhase] = useState<"idle" | "generating" | "scraping" | "analyzing" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ cur: 0, total: 0 });
  const [error, setError] = useState("");
  const [minResults, setMinResults] = useState(20000);
  const [maxResults, setMaxResults] = useState(1000000);
  const [queueTopic, setQueueTopic] = useState<string | null>(null);
  const [queueWaitingUntil, setQueueWaitingUntil] = useState<string | null>(null);
  const queueRunnerActiveRef = useRef(false);
  const queueRunnerIdRef = useRef(crypto.randomUUID());
  const scanActiveRef = useRef(false);

  // Load settings
  useEffect(() => {
    chrome.storage?.local?.get(["openai_api_key", "th_model", "th_filters", "th_min", "th_max", "th_prompt"], (r) => {
      if (r.openai_api_key) setApiKey(r.openai_api_key as string);
      if (r.th_model) setModel(r.th_model as string);
      if (r.th_filters) setFilters(r.th_filters as ContentFilter[]);
      if (r.th_min !== undefined) setMinResults(Number(r.th_min));
      if (r.th_max !== undefined) setMaxResults(Number(r.th_max));
      if (r.th_prompt) setPrompt(r.th_prompt as string);
    });
  }, []);

  // Save settings
  useEffect(() => {
    if (apiKey) chrome.storage?.local?.set({ openai_api_key: apiKey, th_model: model, th_filters: filters, th_min: minResults, th_max: maxResults, th_prompt: prompt });
  }, [apiKey, model, filters, minResults, maxResults, prompt]);

  // Listen for TOGGLE_PANEL
  useEffect(() => {
    const handler = () => setIsOpen((p) => !p);
    window.addEventListener("topichunter-toggle", handler);
    return () => window.removeEventListener("topichunter-toggle", handler);
  }, []);

  const toggleFilter = (f: ContentFilter) => {
    if (filters.includes(f)) {
      if (filters.length === 1) return;
      setFilters(filters.filter((x) => x !== f));
    } else {
      setFilters([...filters, f]);
    }
  };

  const executeScan = useCallback(async (
    scanTopic: string,
    settings: ScanSettings,
  ): Promise<ScanExecutionResult> => {
    if (scanActiveRef.current) throw new Error("Другой скан уже выполняется");
    const t = scanTopic.trim();
    if (!t || !settings.apiKey.trim()) throw new Error("Не задана тема или OpenAI API ключ");
    scanActiveRef.current = true;
    setTopic(t);
    const scanTimestamp = Date.now();
    setPhase("generating");
    setError("");
    setProgress({ cur: 0, total: 0 });

    try {
      const ai = await generateTopics(settings.apiKey, settings.model, t, settings.prompt);
      setPhase("scraping");
      setProgress({ cur: 0, total: ai.topics.length + 1 });

      const userResult = await scrapeAdobeStock(t, settings.filters);
      setProgress((p) => ({ ...p, cur: 1 }));

      const marketCounterBlocked = (
        userResult.marketSalesStatus === "waf_blocked"
        || userResult.marketAiStatus === "waf_blocked"
      );
      const rawResults = marketCounterBlocked
        ? ai.topics.map((generatedTopic) => ({
          topic: generatedTopic,
          demand: null,
          status: "waf_blocked" as const,
          undiscoveredCount: null,
          marketSalesStatus: "waf_blocked" as const,
        }))
        : await processTopicsWithDelay(ai.topics, settings.filters, (idx) => {
          setProgress((p) => ({ ...p, cur: idx + 2 }));
        });

      const activityResults = await enrichMarketActivities(
        [userResult, ...rawResults],
        new Date(scanTimestamp).toISOString(),
      );
      const userResultWithActivity = activityResults[0];
      const results = activityResults.slice(1);

      const warning = marketCounterBlocked
        ? "Adobe остановил один из рыночных счётчиков. Очередь подтем остановлена до следующего запуска."
        : checkSanity(results);
      const passingTopics = results
        .filter((result) => (
          result.status === "ok" &&
          result.demand !== null &&
          result.demand >= settings.minResults &&
          result.demand <= settings.maxResults
        ))
        .map((result) => result.topic);
      const topicsForAnalytics = [t, ...passingTopics];
      const savedItems = await getSavedTopics().catch(() => []);
      const favoriteTopics = new Set(
        savedItems.map((item) => item.subtopic.trim().toLocaleLowerCase()),
      );

      setPhase("analyzing");
      setProgress({ cur: 0, total: topicsForAnalytics.length });
      const analyticsByTopic = await analyzeTopicsWithDelay(
        topicsForAnalytics,
        favoriteTopics,
        ({ completed, total }) => setProgress({ cur: completed, total }),
        true,
      );
      const userTopicResult = {
        ...userResultWithActivity,
        analytics: analyticsByTopic.get(t.toLocaleLowerCase()),
      };
      const enrichedResults = results.map((result) => ({
        ...result,
        analytics: analyticsByTopic.get(result.topic.trim().toLocaleLowerCase()),
      }));

      const scanPayload: ScanPayload = {
        userTopicResult,
        results: enrichedResults,
        warning,
        topic: t,
        timestamp: scanTimestamp,
        model: settings.model,
        filters: settings.filters,
        minResults: settings.minResults,
        maxResults: settings.maxResults,
      };
      const historySessionId = await saveScanHistory(scanPayload);
      await chrome.storage.local.set({
        [STORAGE_KEY]: { ...scanPayload, historySessionId },
      });

      setPhase("done");
      await chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" });
      const blockingAnalytics = [
        userTopicResult.analytics,
        ...enrichedResults.map((result) => result.analytics),
      ].find((analytics) => (
        analytics
        && ["waf_blocked", "parser_degraded", "scan_blocked"].includes(analytics.status)
      ));
      return {
        historySessionId,
        blockedReason: marketCounterBlocked
          ? warning ?? "Adobe остановил рыночный счётчик"
          : blockingAnalytics?.error,
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
      throw err;
    } finally {
      scanActiveRef.current = false;
    }
  }, []);

  const handleSearch = useCallback(async () => {
    const t = topic.trim();
    if (!t || !apiKey.trim()) return;
    try {
      await executeScan(t, { apiKey, model, filters, prompt, minResults, maxResults });
      window.dispatchEvent(new CustomEvent("topichunter-run-queue"));
    } catch {
      // executeScan already exposes the error in the panel.
    }
  }, [topic, apiKey, model, filters, prompt, minResults, maxResults, executeScan]);

  const runMainTopicQueue = useCallback(async () => {
    if (queueRunnerActiveRef.current || scanActiveRef.current) return;
    queueRunnerActiveRef.current = true;
    setQueueWaitingUntil(null);

    try {
      const claim = await claimNextMainTopic(queueRunnerIdRef.current);
      if (!claim.item) {
        setQueueWaitingUntil(claim.waitUntil);
        return;
      }

      const item = claim.item;
      setQueueTopic(item.topic);
      setIsOpen(true);
      const stored = await chrome.storage.local.get([
        "openai_api_key",
        "th_model",
        "th_filters",
        "th_min",
        "th_max",
        "th_prompt",
      ]);
      const queueApiKey = typeof stored.openai_api_key === "string" ? stored.openai_api_key : "";
      if (!queueApiKey.trim()) {
        const message = "Очередь остановлена: не сохранён OpenAI API ключ";
        await failMainTopicQueueItem(item.id, queueRunnerIdRef.current, message);
        throw new Error(message);
      }
      const queueFilters = Array.isArray(stored.th_filters)
        ? stored.th_filters.filter((filter): filter is ContentFilter => (
            filter === "photo" || filter === "vector" || filter === "illustration" || filter === "video"
          ))
        : ["photo" as const];
      const settings: ScanSettings = {
        apiKey: queueApiKey,
        model: typeof stored.th_model === "string" ? stored.th_model : AVAILABLE_MODELS[0].id,
        filters: queueFilters.length > 0 ? queueFilters : ["photo"],
        prompt: typeof stored.th_prompt === "string" ? stored.th_prompt : DEFAULT_PROMPT,
        minResults: Number.isFinite(Number(stored.th_min)) ? Number(stored.th_min) : 20000,
        maxResults: Number.isFinite(Number(stored.th_max)) ? Number(stored.th_max) : 1000000,
      };
      const leaseTimer = window.setInterval(() => {
        void renewMainTopicLease(item.id, queueRunnerIdRef.current).catch(() => undefined);
      }, 45_000);

      try {
        const result = await executeScan(item.topic, settings);
        const nextState = await finishMainTopicQueueItem(
          item.id,
          queueRunnerIdRef.current,
          result.historySessionId,
          result.blockedReason,
        );
        if (result.blockedReason) {
          setError(`Очередь остановлена: ${result.blockedReason}`);
          setPhase("error");
        } else {
          setQueueWaitingUntil(nextState.nextRunAt);
        }
      } catch (queueError) {
        const message = queueError instanceof Error ? queueError.message : String(queueError);
        await failMainTopicQueueItem(item.id, queueRunnerIdRef.current, message).catch(() => undefined);
        setError(message);
        setPhase("error");
      } finally {
        window.clearInterval(leaseTimer);
        setQueueTopic(null);
      }
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : String(queueError));
      setPhase("error");
    } finally {
      queueRunnerActiveRef.current = false;
    }
  }, [executeScan]);

  useEffect(() => {
    const handler = () => void runMainTopicQueue();
    window.addEventListener("topichunter-run-queue", handler);
    const initialCheck = window.setTimeout(handler, 1_000);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("topichunter-run-queue", handler);
    };
  }, [runMainTopicQueue]);

  const working = phase === "generating" || phase === "scraping" || phase === "analyzing";
  const canSearch = topic.trim().length > 0 && apiKey.trim().length > 0 && !working && queueTopic === null;
  const pct = progress.total > 0 ? Math.round((progress.cur / progress.total) * 100) : 0;

  // ── FAB (minimized) ────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        title="TopicHunter"
        className="w-12 h-12 rounded-[14px] bg-th-accent border-none cursor-pointer flex items-center justify-center text-white shadow-[0_8px_24px_rgba(139,92,246,0.4)] hover:scale-110 transition-transform"
        style={{ animation: "th-pulse-glow 2.5s ease-in-out infinite" }}
      >
        <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        </svg>
      </button>
    );
  }

  // ── Panel ──────────────────────────────────
  return (
    <div className="w-[380px] max-h-[calc(100vh-40px)] bg-th-bg border border-th-border rounded-2xl shadow-[0_25px_50px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col" style={{ animation: "th-slide-up 0.25s ease-out" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-th-border bg-th-card/90 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-th-accent/12 border border-th-accent/20 flex items-center justify-center text-th-accent">
            <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
          </div>
          <span className="text-[13px] font-semibold text-th-text">TopicHunter</span>
          <span className="text-[10px] font-semibold text-th-warning bg-th-warning/12 border border-th-warning/20 px-2 py-0.5 rounded-full uppercase tracking-wider">Live</span>
        </div>
        <button onClick={() => setIsOpen(false)} className="w-7 h-7 rounded-lg bg-transparent border-none text-th-text-muted hover:bg-th-input hover:text-th-text cursor-pointer flex items-center justify-center transition-all">
          <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12h-15" /></svg>
        </button>
      </div>

      {/* Body */}
      <div className="p-4 overflow-y-auto max-h-[520px] flex flex-col gap-3">
        <div className="px-3 py-2.5 rounded-xl bg-th-warning/8 border border-th-warning/20 text-[11px] leading-relaxed text-th-warning">
          Сканируйте только в отдельном профиле Chrome без входа в Adobe Stock. При признаках активной сессии очередь остановится.
        </div>

        {/* API Key */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-th-text-sec">🔑 OpenAI API ключ</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." spellCheck={false} autoComplete="off"
            className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] placeholder:text-th-text-muted outline-none hover:border-th-border-hover focus:border-th-accent transition-colors" />
        </div>

        {/* Model */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-th-text-sec">✦ Модель</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] outline-none hover:border-th-border-hover focus:border-th-accent cursor-pointer appearance-none bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%2371717a%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-8 transition-colors">
            {AVAILABLE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>

        {/* Filters */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-th-text-sec">🎯 Фильтры</label>
          <div className="flex gap-1.5 flex-wrap">
            {CONTENT_FILTERS.map((f) => (
              <button key={f.id} onClick={() => toggleFilter(f.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-medium border cursor-pointer transition-all ${
                  filters.includes(f.id) ? "bg-th-accent border-th-accent text-white shadow-[0_2px_8px_rgba(139,92,246,0.25)]" : "bg-th-input border-th-border text-th-text-sec hover:border-th-border-hover hover:text-th-text"
                }`}>{f.label}</button>
            ))}
          </div>
        </div>

        {/* Min/Max Filters */}
        <div className="flex gap-3">
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs font-medium text-th-text-sec">Мин. результатов</label>
            <input type="number" value={minResults} onChange={(e) => setMinResults(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] outline-none hover:border-th-border-hover focus:border-th-accent transition-colors" />
          </div>
          <div className="flex flex-col gap-1.5 flex-1">
            <label className="text-xs font-medium text-th-text-sec">Макс. результатов</label>
            <input type="number" value={maxResults} onChange={(e) => setMaxResults(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] outline-none hover:border-th-border-hover focus:border-th-accent transition-colors" />
          </div>
        </div>

        {/* Topic */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-th-text-sec">🔍 Тема / Ниша</label>
          <input type="text" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Например: Vegetable field" spellCheck={false}
            className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] placeholder:text-th-text-muted outline-none hover:border-th-border-hover focus:border-th-accent transition-colors" />
        </div>

        {/* System prompt accordion */}
        <button onClick={() => setIsPromptOpen(!isPromptOpen)} className="flex items-center gap-1.5 text-xs text-th-text-muted bg-transparent border-none cursor-pointer p-0 font-inherit hover:text-th-text-sec transition-colors">
          <svg className={`w-3.5 h-3.5 transition-transform ${isPromptOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
          <span>Системный промпт</span>
        </button>
        {isPromptOpen && (
          <div className="flex flex-col gap-1.5">
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4}
              className="w-full px-3 py-2 rounded-xl border border-th-border bg-th-input text-th-text text-[13px] outline-none hover:border-th-border-hover focus:border-th-accent resize-y min-h-[80px] leading-relaxed transition-colors" />
            <button onClick={() => setPrompt(DEFAULT_PROMPT)} className="self-start px-3 py-1.5 rounded-xl text-xs border border-th-border bg-th-input text-th-text-sec hover:border-th-border-hover hover:text-th-text cursor-pointer transition-all">↻ Сбросить</button>
          </div>
        )}

        {/* Progress */}
        {working && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-th-text-muted">
              <div className="w-1.5 h-1.5 rounded-full bg-th-accent animate-pulse" />
              {phase === "generating"
                ? "Генерация подтем…"
                : phase === "analyzing"
                  ? `Анализ top-100 ${progress.cur}/${progress.total}…`
                  : `Проверка спроса ${progress.cur}/${progress.total}…`}
            </div>
            {(phase === "scraping" || phase === "analyzing") && (
              <div className="w-full h-1 rounded bg-th-input overflow-hidden">
                <div className="h-full bg-th-accent rounded transition-[width] duration-300" style={{ width: `${pct}%` }} />
              </div>
            )}
          </div>
        )}

        {phase === "error" && error && (
          <div className="px-3 py-2.5 rounded-xl bg-th-error/8 border border-th-error/20 text-xs text-th-error leading-relaxed">{error}</div>
        )}

        {phase === "done" && (
          <div className="text-xs text-th-success">✅ Готово! Результаты открыты в дашборде.</div>
        )}

        {(queueTopic || queueWaitingUntil) && (
          <div className="px-3 py-2.5 rounded-xl bg-th-accent/8 border border-th-accent/20 text-xs text-th-text-sec leading-relaxed">
            {queueTopic
              ? <>Очередь главных тем: сейчас <span className="font-semibold text-th-text">{queueTopic}</span></>
              : <>Следующая тема после паузы: <span className="font-semibold text-th-text">{new Date(queueWaitingUntil!).toLocaleString("ru-RU")}</span></>}
          </div>
        )}

        {/* Search button */}
        <button onClick={handleSearch} disabled={!canSearch}
          className={`w-full py-2.5 rounded-xl text-[13px] font-semibold border-none cursor-pointer flex items-center justify-center gap-2 transition-all ${
            canSearch ? "bg-th-accent text-white shadow-[0_4px_12px_rgba(139,92,246,0.3)] hover:bg-th-accent-hover active:scale-[0.98]" : "bg-th-accent/25 text-white/50 cursor-not-allowed shadow-none"
          }`}>
          {working ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" style={{ animation: "th-spin 0.7s linear infinite" }}>
                <circle style={{ opacity: 0.25 }} cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path style={{ opacity: 0.75 }} fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {phase === "generating"
                ? "Генерация…"
                : phase === "analyzing"
                  ? `Top-100 ${pct}%`
                  : `Спрос ${pct}%`}
            </>
          ) : (
            <>
              <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" /></svg>
              Начать поиск
            </>
          )}
        </button>
      </div>
    </div>
  );
}
