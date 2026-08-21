import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { getSavedTopics, saveTopic } from "@shared/api/saved-items";
import { getAllTopicHistory } from "@shared/api/history";
import {
  buildTopicScorePool,
  calculateTopicScore,
  type TopicScore,
} from "@shared/api/topic-score";
import OpportunityScore from "./OpportunityScore";
import ActivityCell from "./ActivityCell";
import type {
  AgeWindowMetric,
  AnalyticsStatus,
  SavedItem,
  TopicAnalytics,
  TopicHistoryEntry,
  TopicResult,
} from "@shared/types";

interface ResultsTableProps {
  mainTopic: string;
  userTopicResult: TopicResult | null;
  results: TopicResult[];
  warning: string | null;
  expectedCount: number;
  isGenerating: boolean;
  savedItems?: SavedItem[];
  onRemoveSaved?: (id: string) => Promise<void>;
  scanSessionId?: string;
  scanTimestamp?: number;
  onOpenSavedScan?: (item: SavedItem) => void;
}

interface DisplayRow {
  result: TopicResult;
  key: string;
  source: boolean;
  number: number | null;
  savedId?: string;
  mainTopicLabel?: string;
  savedItem?: SavedItem;
  score: TopicScore | null;
}

type SavedSortKey =
  | "topic"
  | "demand"
  | "score"
  | "aiTop100"
  | "age1"
  | "age2"
  | "age3"
  | "age6"
  | "dynamics"
  | "activity"
  | "verdict"
  | "coverage"
  | "titleMatches";

type SortDirection = "desc" | "asc";

interface SavedSortState {
  key: SavedSortKey;
  direction: SortDirection;
}

const SAVED_STORAGE_KEY = "topicHunter_savedTopics";

function savedTopicKey(mainTopic: string, subtopic: string): string {
  return `${mainTopic.trim().toLocaleLowerCase()}\u0000${subtopic.trim().toLocaleLowerCase()}`;
}

export default function ResultsTable({
  mainTopic,
  userTopicResult,
  results,
  warning,
  expectedCount,
  isGenerating,
  savedItems,
  onRemoveSaved,
  scanSessionId,
  scanTimestamp,
  onOpenSavedScan,
}: ResultsTableProps) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [savingKeys, setSavingKeys] = useState<Set<string>>(() => new Set());
  const [savedTopicKeys, setSavedTopicKeys] = useState<Set<string>>(() => new Set());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [savedSort, setSavedSort] = useState<SavedSortState | null>(null);
  const [historyEntries, setHistoryEntries] = useState<TopicHistoryEntry[]>([]);

  const savedMode = savedItems !== undefined;
  const rawRows = useMemo<Omit<DisplayRow, "score">[]>(() => (
    savedMode
      ? savedItems.map((item, index) => ({
        result: {
          topic: item.subtopic,
          demand: item.demand,
          status: "ok" as const,
          undiscoveredCount: item.undiscoveredCount,
          totalAiCount: item.totalAiCount,
          undiscoveredAiCount: item.undiscoveredAiCount,
          activity: item.activity,
          analytics: item.analytics,
        },
        key: `saved-${item.id}`,
        source: false,
        number: index + 1,
        savedId: item.id,
        mainTopicLabel: item.mainTopic,
        savedItem: item,
      }))
      : [
        ...(userTopicResult
          ? [{ result: userTopicResult, key: "source-topic", source: true, number: null }]
          : []),
        ...results.map((result, index) => ({
          result,
          key: `result-${index}-${result.topic}`,
          source: false,
          number: index + 1,
        })),
      ]
  ), [results, savedItems, savedMode, userTopicResult]);
  const scorePool = useMemo(() => {
    const seenHistoricTopics = new Set<string>();
    const latestHistoricResults = historyEntries.flatMap((entry) => {
      const key = entry.topic.trim().toLocaleLowerCase();
      if (!key || seenHistoricTopics.has(key)) return [];
      seenHistoricTopics.add(key);
      return [entry.result];
    });
    return buildTopicScorePool([
      ...latestHistoricResults,
      ...rawRows.map((row) => row.result),
    ]);
  }, [historyEntries, rawRows]);
  const baseRows: DisplayRow[] = rawRows.map((row) => ({
    ...row,
    score: calculateTopicScore(row.result, scorePool),
  }));
  const rows = savedMode && savedSort
    ? sortSavedRows(baseRows, savedSort).map((row, index) => ({ ...row, number: index + 1 }))
    : baseRows;

  const handleSavedSort = (key: SavedSortKey) => {
    if (!savedMode) return;
    setSavedSort((current) => {
      if (!current || current.key !== key) return { key, direction: "desc" };
      if (current.direction === "desc") return { key, direction: "asc" };
      return null;
    });
  };

  useEffect(() => {
    let active = true;

    const applyItems = (items: SavedItem[]) => {
      if (!active) return;
      setSavedTopicKeys(new Set(items.map((item) => savedTopicKey(item.mainTopic, item.subtopic))));
    };
    const loadItems = async () => {
      if (savedItems) {
        applyItems(savedItems);
        return;
      }
      applyItems(await getSavedTopics());
    };
    void loadItems().catch(() => {
      if (active) setSavedTopicKeys(new Set());
    });

    const handleStorageChange = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local" || !changes[SAVED_STORAGE_KEY]) return;
      const nextItems = changes[SAVED_STORAGE_KEY].newValue;
      applyItems(Array.isArray(nextItems) ? nextItems as SavedItem[] : []);
    };
    chrome.storage?.onChanged?.addListener(handleStorageChange);
    return () => {
      active = false;
      chrome.storage?.onChanged?.removeListener(handleStorageChange);
    };
  }, [savedItems]);

  useEffect(() => {
    let active = true;
    void getAllTopicHistory()
      .then((entries) => {
        if (active) setHistoryEntries(entries);
      })
      .catch(() => {
        if (active) setHistoryEntries([]);
      });
    return () => { active = false; };
  }, []);

  const isRowSaved = (row: DisplayRow): boolean => {
    if (savedMode) return true;
    const rowMainTopic = row.mainTopicLabel || mainTopic || row.result.topic;
    return savedTopicKeys.has(savedTopicKey(rowMainTopic, row.result.topic));
  };

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleSave = async (row: DisplayRow) => {
    if (savingKeys.has(row.key) || (!savedMode && isRowSaved(row))) return;

    setSaveError(null);
    setSavingKeys((current) => new Set(current).add(row.key));
    try {
      if (savedMode) {
        if (!row.savedId || !onRemoveSaved) throw new Error("Не удалось определить сохранённую тему");
        await onRemoveSaved(row.savedId);
        return;
      }
      await saveTopic(
        mainTopic || row.mainTopicLabel || row.result.topic,
        row.result.topic,
        row.result.demand,
        row.result.undiscoveredCount,
        row.result.analytics,
        row.result.totalAiCount,
        row.result.undiscoveredAiCount,
        row.result.activity,
        scanSessionId,
        scanTimestamp,
      );
      const rowMainTopic = mainTopic || row.mainTopicLabel || row.result.topic;
      setSavedTopicKeys((current) => new Set(current).add(savedTopicKey(rowMainTopic, row.result.topic)));
    } catch (error: unknown) {
      setSaveError(error instanceof Error
        ? error.message
        : savedMode
          ? "Не удалось удалить тему из избранного"
          : "Не удалось добавить тему в избранное");
    } finally {
      setSavingKeys((current) => {
        const next = new Set(current);
        next.delete(row.key);
        return next;
      });
    }
  };

  const successful = rows.filter((row) => row.result.status === "ok").length;
  const errors = rows.filter(
    (row) => row.result.status === "error" || row.result.status === "waf_blocked",
  ).length;

  return (
    <div className="space-y-3 animate-fade-in">
      {warning && <WarningBanner text={warning} />}
      {saveError && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 rounded-xl bg-error/8 border border-error/20">
          <p className="text-sm text-error">{saveError}</p>
          <button type="button" onClick={() => setSaveError(null)} className="text-error cursor-pointer">×</button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-1">
        <h3 className="text-base font-semibold text-text-primary">{savedMode ? "Избранное и top-100" : "Результаты и top-100"}</h3>
        <span className="text-xs text-text-muted">{savedMode ? "Тем" : "Подтем"}: {expectedCount}</span>
        {!savedMode && <span className="text-xs text-success">Счётчик получен: {successful}</span>}
        {errors > 0 && <span className="text-xs text-error">Ошибок: {errors}</span>}
        {isGenerating && <span className="text-xs text-accent animate-pulse">Обновление…</span>}
      </div>

      <div className="bg-bg-card border border-border rounded-2xl overflow-x-auto">
        <table className="w-[2496px] min-w-full table-fixed border-separate border-spacing-0">
          <colgroup>
            <col className="w-12" />
            <col className="w-60" />
            <col className="w-52" />
            <col className="w-24" />
            <col className="w-44" />
            <col className="w-44" />
            <col className="w-44" />
            <col className="w-44" />
            <col className="w-44" />
            <col className="w-52" />
            <col className="w-56" />
            <col className="w-56" />
            <col className="w-40" />
            <col className="w-52" />
          </colgroup>
          <thead>
            <tr>
              <StickyHeader className="left-0 w-12">#</StickyHeader>
              <StickyHeader className="left-12 w-60 text-left">
                <SortHeaderLabel label="Тема" sortKey="topic" enabled={savedMode} state={savedSort} onSort={handleSavedSort} />
              </StickyHeader>
              <StickyHeader className="left-72 w-52 text-right">
                <SortHeaderLabel label="Кол-во работ" sortKey="demand" enabled={savedMode} state={savedSort} onSort={handleSavedSort} align="right" />
              </StickyHeader>
              <StickyHeader className="left-[496px] w-24">
                <SortHeaderLabel label="Действия" sortKey="score" enabled={savedMode} state={savedSort} onSort={handleSavedSort} />
              </StickyHeader>
              <HeaderCell><SortHeaderLabel label="AI в top-100" sortKey="aiTop100" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="≤ 1 мес." sortKey="age1" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="≤ 2 мес." sortKey="age2" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="≤ 3 мес." sortKey="age3" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="≤ 6 мес." sortKey="age6" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="Динамика" sortKey="dynamics" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="Активность 30д" sortKey="activity" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="Проходимость" sortKey="verdict" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="Данные" sortKey="coverage" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
              <HeaderCell><SortHeaderLabel label="Фраза в заголовке top-10" sortKey="titleMatches" enabled={savedMode} state={savedSort} onSort={handleSavedSort} /></HeaderCell>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.key}>
                <tr className={`group ${row.source ? "bg-accent/5" : "hover:bg-bg-card-hover"}`}>
                <StickyCell className="left-0 w-12 text-center text-text-muted">
                  {row.source ? "★" : row.number}
                </StickyCell>
                <StickyCell className="left-12 w-60">
                  {row.source && (
                    <span className="block max-w-52 truncate text-[10px] uppercase tracking-wider text-accent">
                      Ваша тема
                    </span>
                  )}
                  {!row.source && row.mainTopicLabel && (
                    <button
                      type="button"
                      onClick={() => row.savedItem && onOpenSavedScan?.(row.savedItem)}
                      disabled={!row.savedItem || !onOpenSavedScan}
                      className="block max-w-52 truncate bg-transparent p-0 text-left text-[10px] uppercase tracking-wider text-accent cursor-pointer hover:underline disabled:cursor-default disabled:no-underline"
                      title="Открыть весь сохранённый скан основной темы"
                    >
                      {row.mainTopicLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={!row.result.analytics?.snapshot}
                    onClick={() => setExpandedKey((current) => current === row.key ? null : row.key)}
                    className="flex w-full items-center gap-2 text-left disabled:cursor-default cursor-pointer"
                    title={row.result.analytics?.snapshot ? "Показать 100 работ" : row.result.topic}
                  >
                    <span className="text-text-muted">{row.result.analytics?.snapshot ? (expandedKey === row.key ? "▾" : "▸") : ""}</span>
                    <span className="block max-w-52 truncate text-sm font-medium text-text-primary">
                      {row.result.topic}
                    </span>
                  </button>
                </StickyCell>
                <StickyCell className="left-72 w-52 text-right">
                  <DemandSummary result={row.result} />
                </StickyCell>
                <StickyCell className="left-[496px] w-24 text-center">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="flex items-center justify-center gap-1">
                      <ActionButton
                        kind="copy"
                        active={copiedKey === row.key}
                        title="Копировать"
                        onClick={() => void handleCopy(row.result.topic, row.key)}
                      />
                      <ActionButton
                        kind="heart"
                        active={isRowSaved(row)}
                        loading={savingKeys.has(row.key)}
                        allowActiveClick={savedMode}
                        title={savedMode ? "Удалить из избранного" : isRowSaved(row) ? "Уже в избранном" : "В избранное"}
                        onClick={() => void handleSave(row)}
                      />
                    </div>
                    <OpportunityScore score={row.score} />
                  </div>
                </StickyCell>
                  <AnalyticsCells result={row.result} />
                </tr>
                {expandedKey === row.key && row.result.analytics?.snapshot && (
                  <tr>
                    <td colSpan={14} className="border-b border-border bg-bg-primary/60 px-5 py-4">
                      <AssetDetails analytics={row.result.analytics} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}

            {!savedMode && isGenerating && rows.length < expectedCount && (
              <tr><td colSpan={14} className="px-4 py-4 text-sm text-text-muted animate-pulse">Анализ продолжается…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="px-1 text-[11px] text-text-muted">
        Оценка 0–100 сравнивает тему с последними снимками уникальных тем локальной базы; пунктирная рамка означает, что месячная динамика ещё накапливается. В избранном нажмите «Действия», чтобы сортировать по оценке. «С продажами» = общее число работ минус Undiscovered. Доля AI = AI-работы среди всех; продажи = доля работ с продажами среди всех; продажи AI = доля работ с продажами среди AI. «В top-10» показывает, сколько работ из указанного возрастного диапазона находится на первых десяти позициях. Активность 30д — proxy прироста работ с первой продажей; главное значение является нижней 95% границей Уилсона.
      </p>
    </div>
  );
}

function AssetDetails({ analytics }: { analytics: TopicAnalytics }) {
  const snapshot = analytics.snapshot;
  if (!snapshot) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted">
        <span>batch: <span className="text-text-secondary">{snapshot.batchId.slice(0, 8)}</span></span>
        <span>{new Date(snapshot.checkedAt).toLocaleString("ru-RU")}</span>
        <span>parser: {snapshot.parserVersion}</span>
        <span>date model: {snapshot.dateModelVersion}</span>
      </div>
      <div className="max-h-80 overflow-auto rounded-xl border border-border">
        <table className="w-full min-w-[1100px] text-xs">
          <thead className="sticky top-0 bg-bg-card">
            <tr>
              {['Ранг', 'Asset ID', 'Заголовок', 'Дата по ID', 'Погрешность', 'AI', 'Продажи'].map((label) => (
                <th key={label} className="border-b border-border px-3 py-2 text-left font-medium text-text-muted">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.assets.map((asset) => (
              <tr key={asset.assetId} className="odd:bg-bg-input/30">
                <td className="px-3 py-2 tabular-nums text-text-muted">{asset.rank}</td>
                <td className="px-3 py-2 font-medium tabular-nums text-text-primary">{asset.assetId}</td>
                <td className="max-w-96 truncate px-3 py-2 text-text-secondary" title={asset.title ?? undefined}>
                  {asset.title ?? "unknown"}
                </td>
                <td className="px-3 py-2 tabular-nums text-text-secondary">{asset.estimatedUploadDate ?? "unknown"}</td>
                <td className="px-3 py-2 text-text-muted">{asset.dateErrorDays === null ? "—" : `±${asset.dateErrorDays} дн.`}</td>
                <td className="px-3 py-2">{asset.isAi === null ? "unknown" : asset.isAi ? "AI" : "не AI"}</td>
                <td className="px-3 py-2">{salesStatusLabel(asset.salesStatus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function salesStatusLabel(status: "sold" | "undiscovered" | "unknown"): string {
  if (status === "sold") return "есть ≥1";
  if (status === "undiscovered") return "нет";
  return "unknown";
}

function AnalyticsCells({ result }: { result: TopicResult }) {
  const analytics = result.analytics;
  if (!analytics) {
    const reason = result.status === "ok"
      ? "Top-100 не сканировался: спрос вне заданного диапазона"
      : "Top-100 не сканировался: спрос не получен";
    return <EmptyAnalyticsCells text={reason} activity={result.activity} />;
  }
  if (!analytics.metrics) {
    return <EmptyAnalyticsCells text={analytics.error ?? analyticsStatusLabel(analytics.status)} status={analytics.status} activity={result.activity} />;
  }

  const { metrics } = analytics;
  return (
    <>
      <MetricCell
        primary={`${metrics.aiCount}/${metrics.topCount}`}
        secondary={`В top-10 = ${metrics.aiTop10Count}`}
      />
      {([1, 2, 3, 6] as const).map((months) => {
        const metric = metrics.ageWindows.find((window) => window.months === months);
        return <AgeCell key={months} metric={metric} />;
      })}
      <DynamicsCell analytics={analytics} />
      <ActivityCell activity={result.activity} />
      <td className="border-b border-border/50 px-3 py-3 min-w-44">
        <VerdictBadge verdict={metrics.verdict} />
        <p className="mt-1 text-[11px] leading-snug text-text-muted">{metrics.verdictReason}</p>
      </td>
      <td className="border-b border-border/50 px-3 py-3 min-w-36">
        <p className="text-xs font-medium text-text-secondary">{analyticsStatusLabel(analytics.status)}</p>
        <p className="mt-1 text-[11px] text-text-muted">
          confidence: {analytics.confidence}{analytics.cached ? " · кэш" : ""}
        </p>
      </td>
      <TitleMatchCell analytics={analytics} />
    </>
  );
}

function AgeCell({ metric }: { metric?: AgeWindowMetric }) {
  if (!metric) return <MetricCell primary="—" secondary="нет данных" />;
  return (
    <MetricCell
      primary={`${metric.total}/${metric.ai} AI`}
      secondary={`В top-10 = ${metric.top10Count}`}
    />
  );
}

function MetricCell({ primary, secondary }: { primary: string; secondary: string }) {
  return (
    <td className="overflow-hidden border-b border-border/50 px-3 py-3 align-top">
      <p className="text-sm font-semibold text-text-primary tabular-nums whitespace-nowrap">{primary}</p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">{secondary}</p>
    </td>
  );
}

function EmptyAnalyticsCells({
  text,
  status,
  activity,
}: {
  text: string;
  status?: AnalyticsStatus;
  activity: TopicResult["activity"];
}) {
  return (
    <>
      <td colSpan={6} className="border-b border-border/50 px-4 py-3 text-sm text-text-muted">
        <span className={status === "parser_degraded" || status === "waf_blocked" ? "text-error" : ""}>{text}</span>
      </td>
      <ActivityCell activity={activity} />
      <td colSpan={3} className="border-b border-border/50 px-4 py-3 text-sm text-text-muted">—</td>
    </>
  );
}

function DynamicsCell({ analytics }: { analytics: TopicAnalytics }) {
  const dynamics = analytics.metrics?.dynamics;
  if (!dynamics) return <MetricCell primary="Первый снимок" secondary="сравнивать пока не с чем" />;

  return (
    <td
      className="overflow-hidden border-b border-border/50 px-3 py-3 align-top"
      title={`Максимальный рост: ${dynamics.biggestRise ?? 0}; максимальное падение: ${dynamics.biggestDrop ?? 0}; средний сдвиг: ${dynamics.averageAbsoluteRankChange ?? 0}`}
    >
      <p className="text-sm font-semibold text-text-primary whitespace-nowrap">
        Ушло {dynamics.exited} · пришло {dynamics.entered}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        ↑ {dynamics.movedUp ?? 0} · ↓ {dynamics.movedDown ?? 0} · = {dynamics.unchangedRank ?? 0} · ср. сдвиг {dynamics.averageAbsoluteRankChange ?? 0}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        Новых ID в top-10: {dynamics.enteredTop10 ?? 0}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-text-muted">
        Свежих ≤1м пришло {dynamics.enteredFreshOneMonth ?? 0} · дошли top-10: {dynamics.enteredFreshTop10 ?? 0}
      </p>
    </td>
  );
}

function TitleMatchCell({ analytics }: { analytics: TopicAnalytics }) {
  const metrics = analytics.metrics;
  if (!metrics || metrics.titleMatchesTop10 === null) {
    const known = metrics ? Math.round(metrics.titleCoverageTop10 * Math.min(10, metrics.topCount)) : 0;
    return <MetricCell primary="Неизвестно" secondary={`заголовков получено: ${known}`} />;
  }

  const topSize = Math.min(10, metrics.topCount);
  return (
    <MetricCell
      primary={metrics.titleMatchesTop10 === 0 ? "Нет" : `${metrics.titleMatchesTop10} из ${topSize}`}
      secondary="точная фраза запроса"
    />
  );
}

function sortSavedRows(rows: DisplayRow[], state: SavedSortState): DisplayRow[] {
  return rows
    .map((row, index) => ({ row, index, value: savedSortValue(row, state.key) }))
    .sort((left, right) => {
      if (left.value === null && right.value === null) return left.index - right.index;
      if (left.value === null) return 1;
      if (right.value === null) return -1;

      const comparison = typeof left.value === "number" && typeof right.value === "number"
        ? left.value - right.value
        : String(left.value).localeCompare(String(right.value), "ru", {
            sensitivity: "base",
            numeric: true,
          });
      if (comparison === 0) return left.index - right.index;
      return state.direction === "asc" ? comparison : -comparison;
    })
    .map(({ row }) => row);
}

function savedSortValue(row: DisplayRow, key: SavedSortKey): number | string | null {
  const { result } = row;
  const metrics = result.analytics?.metrics;
  if (key === "topic") return result.topic.trim();
  if (key === "demand") return result.demand;
  if (key === "score") return row.score?.value ?? null;
  if (key === "aiTop100") return metrics?.aiCount ?? null;
  if (key === "dynamics") return metrics?.dynamics?.changed ?? null;
  if (key === "activity") return result.activity?.overall?.wilsonLower30 ?? null;
  if (key === "coverage") return result.analytics?.snapshot?.coverage.uniqueIdCoverage ?? null;
  if (key === "titleMatches") return metrics?.titleMatchesTop10 ?? null;
  if (key === "verdict") {
    if (!metrics) return null;
    return {
      insufficient_data: 0,
      frozen: 1,
      no_fresh_ai: 2,
      open: 3,
    }[metrics.verdict];
  }

  const months = key === "age1" ? 1 : key === "age2" ? 2 : key === "age3" ? 3 : 6;
  return metrics?.ageWindows.find((window) => window.months === months)?.total ?? null;
}

function SortHeaderLabel({
  label,
  sortKey,
  enabled,
  state,
  onSort,
  align = "left",
}: {
  label: string;
  sortKey: SavedSortKey;
  enabled: boolean;
  state: SavedSortState | null;
  onSort: (key: SavedSortKey) => void;
  align?: "left" | "right";
}) {
  if (!enabled) return <>{label}</>;
  const active = state?.key === sortKey;
  const marker = active ? (state.direction === "desc" ? "↓" : "↑") : "↕";
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      title="Сортировать: больше → меньше, меньше → больше, сброс"
      className={`group flex w-full items-center gap-1 bg-transparent p-0 font-inherit uppercase tracking-inherit text-inherit cursor-pointer ${align === "right" ? "justify-end" : "justify-start"}`}
    >
      <span>{label}</span>
      <span className={`text-[10px] transition-opacity ${active ? "opacity-70" : "opacity-0 group-hover:opacity-25"}`} aria-hidden="true">
        {marker}
      </span>
    </button>
  );
}

function StickyHeader({ children, className }: { children: ReactNode; className: string }) {
  return (
    <th className={`sticky z-20 border-b border-border bg-bg-card px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted whitespace-nowrap ${className}`}>
      {children}
    </th>
  );
}

function HeaderCell({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-border bg-bg-card px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-text-muted whitespace-nowrap">
      {children}
    </th>
  );
}

function StickyCell({ children, className }: { children: ReactNode; className: string }) {
  return (
    <td className={`sticky z-10 overflow-hidden border-b border-border/50 bg-bg-card group-hover:bg-bg-card-hover px-3 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

function WarningBanner({ text }: { text: string }) {
  return (
    <div className="px-5 py-3.5 rounded-xl bg-warning/8 border border-warning/20 text-sm text-warning">
      {text}
    </div>
  );
}

function VerdictBadge({ verdict }: { verdict: "open" | "frozen" | "no_fresh_ai" | "insufficient_data" }) {
  const styles = verdict === "open"
    ? "bg-success/10 text-success"
    : verdict === "insufficient_data"
      ? "bg-text-muted/10 text-text-muted"
      : "bg-error/10 text-error";
  const labels = {
    open: "Есть вход",
    frozen: "Топ закрыт",
    no_fresh_ai: "Нет свежего AI",
    insufficient_data: "Недостаточно данных",
  };
  return <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold ${styles}`}>{labels[verdict]}</span>;
}

function DemandStatus({ status }: { status: TopicResult["status"] }) {
  const label = status === "waf_blocked" ? "WAF" : status === "pending" ? "…" : "Ошибка";
  return <span className="text-xs text-error">{label}</span>;
}

function DemandSummary({ result }: { result: TopicResult }) {
  if (result.status !== "ok") return <DemandStatus status={result.status} />;

  const total = result.demand;
  const rawUndiscovered = result.undiscoveredCount
    ?? result.analytics?.metrics?.sales.undiscoveredTotal
    ?? null;
  const totalsCompatible = (
    total !== null
    && rawUndiscovered !== null
    && rawUndiscovered >= 0
    && rawUndiscovered <= total
  );
  const soldCount = totalsCompatible ? total - rawUndiscovered : null;
  const rawTotalAi = typeof result.totalAiCount === "number" ? result.totalAiCount : null;
  const totalAi = (
    total !== null
    && rawTotalAi !== null
    && rawTotalAi >= 0
    && rawTotalAi <= total
  ) ? rawTotalAi : null;
  const rawUndiscoveredAi = typeof result.undiscoveredAiCount === "number"
    ? result.undiscoveredAiCount
    : null;
  const aiTotalsCompatible = (
    totalAi !== null
    && rawUndiscoveredAi !== null
    && rawUndiscoveredAi >= 0
    && rawUndiscoveredAi <= totalAi
    && (rawUndiscovered === null || rawUndiscoveredAi <= rawUndiscovered)
  );
  const soldAiCount = aiTotalsCompatible ? totalAi - rawUndiscoveredAi : null;
  const aiShare = totalAi !== null && total !== null && total > 0
    ? Math.round((totalAi / total) * 100)
    : null;
  const soldShare = soldCount !== null && total !== null && total > 0
    ? Math.round((soldCount / total) * 100)
    : null;
  const soldAiShare = soldAiCount !== null && totalAi !== null && totalAi > 0
    ? Math.round((soldAiCount / totalAi) * 100)
    : null;

  return (
    <div className="space-y-0.5">
      <p className={`text-sm font-semibold tabular-nums whitespace-nowrap ${demandColor(result.demand)}`}>
        {formatNumber(result.demand)}
      </p>
      <p className="text-[10px] leading-snug text-text-muted tabular-nums whitespace-nowrap">
        AI: {totalAi === null ? "unknown" : formatNumber(totalAi)} · {aiShare === null ? "—" : `${aiShare}%`}
      </p>
      <p className="text-[10px] leading-snug text-text-muted tabular-nums whitespace-nowrap">
        С продажами: {soldCount === null ? "—" : formatNumber(soldCount)} · {soldShare === null ? "—" : `${soldShare}%`}
      </p>
      <p className="text-[10px] leading-snug text-text-muted tabular-nums whitespace-nowrap">
        AI с продажами: {soldAiCount === null ? "unknown" : formatNumber(soldAiCount)} · {soldAiShare === null ? "—" : `${soldAiShare}%`}
      </p>
    </div>
  );
}

function analyticsStatusLabel(status: AnalyticsStatus): string {
  const labels: Record<AnalyticsStatus, string> = {
    ok: "Полные данные",
    partial: "Частичные данные",
    pending: "В очереди",
    not_scanned: "Не сканировалось",
    scan_blocked: "Сканирование заблокировано",
    waf_blocked: "Adobe остановил запросы",
    parser_degraded: "Формат Adobe изменился",
    calibration_missing: "Нет калибровки",
    error: "Ошибка анализа",
  };
  return labels[status];
}

function formatNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function demandColor(value: number | null): string {
  if (value === null) return "text-text-muted";
  if (value >= 100_000) return "text-success";
  if (value >= 20_000) return "text-accent";
  if (value >= 5_000) return "text-warning";
  return "text-error";
}

function ActionButton({
  kind,
  title,
  active,
  loading,
  allowActiveClick = false,
  onClick,
}: {
  kind: "copy" | "heart";
  title: string;
  active: boolean;
  loading?: boolean;
  allowActiveClick?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={loading || (kind === "heart" && active && !allowActiveClick)}
      onClick={onClick}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
        active ? "text-accent bg-accent/10" : "text-text-muted hover:text-accent hover:bg-accent/10"
      } disabled:cursor-default`}
    >
      {loading ? (
        <span className="animate-spin">◌</span>
      ) : kind === "copy" ? (
        active ? "✓" : "⧉"
      ) : (
        <span className={active ? "text-accent" : ""}>{active ? "♥" : "♡"}</span>
      )}
    </button>
  );
}
