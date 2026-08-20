import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAllTopicHistory } from "@shared/api/history";
import type {
  AgeWindowMetric,
  MarketActivity,
  TopicHistoryEntry,
} from "@shared/types";

const PAGE_SIZE = 100;

type SortDirection = "asc" | "desc";
type SortValue = string | number | null;

interface TopicOverlap {
  topic: string;
  count: number;
  percent: number;
}

interface HistoryRow {
  entry: TopicHistoryEntry;
  timestamp: number;
  demand: number | null;
  undiscovered: number | null;
  sold: number | null;
  aiShare: number | null;
  totalAi: number | null;
  undiscoveredAi: number | null;
  aiTop100: number | null;
  topCount: number | null;
  age1: AgeWindowMetric | null;
  age2: AgeWindowMetric | null;
  age3: AgeWindowMetric | null;
  age6: AgeWindowMetric | null;
  activity: MarketActivity | null;
  dynamicsChanged: number | null;
  dynamicsEntered: number | null;
  dynamicsExited: number | null;
  titleMatches: number | null;
  titleCoverage: number | null;
  overlaps: TopicOverlap[];
  bestOverlap: number | null;
  statusText: string;
}

type ColumnKey =
  | "date"
  | "kind"
  | "mainTopic"
  | "topic"
  | "total"
  | "undiscovered"
  | "sold"
  | "aiShare"
  | "totalAi"
  | "undiscoveredAi"
  | "aiTop100"
  | "age1"
  | "age2"
  | "age3"
  | "age6"
  | "activity"
  | "dynamics"
  | "titles"
  | "overlap"
  | "status";

interface ColumnDefinition {
  key: ColumnKey;
  label: string;
  width: number;
  align?: "left" | "right" | "center";
  sortValue: (row: HistoryRow) => SortValue;
  filterValue: (row: HistoryRow) => SortValue;
  render: (row: HistoryRow) => ReactNode;
}

function localeNumber(value: number | null): string {
  return value === null ? "—" : value.toLocaleString("en-US");
}

function percent(value: number | null, fractionDigits = 1): string {
  return value === null
    ? "—"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: fractionDigits })}%`;
}

function activityPercent(activity: MarketActivity | null): number | null {
  const value = activity?.overall?.wilsonLower30;
  return typeof value === "number" ? value * 100 : null;
}

function activityColor(activity: MarketActivity | null): string {
  switch (activity?.quintile) {
    case 1: return "text-error";
    case 2: return "text-orange-400";
    case 3: return "text-warning";
    case 4: return "text-success";
    case 5: return "text-amber-300";
    default: return "text-text-secondary";
  }
}

function ageLabel(metric: AgeWindowMetric | null): string {
  return metric ? `${metric.total}/${metric.ai} AI` : "—";
}

function ageFilter(metric: AgeWindowMetric | null): string {
  return metric ? `${metric.total} ${metric.ai} AI top10 ${metric.top10Count}` : "";
}

function renderNumber(value: number | null, className = ""): ReactNode {
  return <span className={`tabular-nums ${className}`}>{localeNumber(value)}</span>;
}

const columns: ColumnDefinition[] = [
  {
    key: "date",
    label: "Дата снимка",
    width: 170,
    sortValue: (row) => row.timestamp,
    filterValue: (row) => `${row.entry.checkedAt} ${new Date(row.timestamp).toLocaleString("ru-RU")}`,
    render: (row) => (
      <div className="whitespace-nowrap">
        <p className="font-medium text-text-primary">{new Date(row.timestamp).toLocaleDateString("ru-RU")}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">{new Date(row.timestamp).toLocaleTimeString("ru-RU")}</p>
      </div>
    ),
  },
  {
    key: "kind",
    label: "Тип",
    width: 105,
    sortValue: (row) => row.entry.isSource ? "главная" : "подтема",
    filterValue: (row) => row.entry.isSource ? "главная тема" : "подтема",
    render: (row) => (
      <span className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${row.entry.isSource ? "border-accent/25 bg-accent/10 text-accent" : "border-border bg-bg-input text-text-muted"}`}>
        {row.entry.isSource ? "Главная" : "Подтема"}
      </span>
    ),
  },
  {
    key: "mainTopic",
    label: "Основная тема",
    width: 210,
    sortValue: (row) => row.entry.mainTopic,
    filterValue: (row) => row.entry.mainTopic,
    render: (row) => <span title={row.entry.mainTopic ?? undefined}>{row.entry.mainTopic ?? "—"}</span>,
  },
  {
    key: "topic",
    label: "Тема",
    width: 220,
    sortValue: (row) => row.entry.topic,
    filterValue: (row) => row.entry.topic,
    render: (row) => <span className="font-semibold text-text-primary" title={row.entry.topic}>{row.entry.topic}</span>,
  },
  {
    key: "total",
    label: "Всего работ",
    width: 135,
    align: "right",
    sortValue: (row) => row.demand,
    filterValue: (row) => row.demand,
    render: (row) => renderNumber(row.demand, "font-semibold text-text-primary"),
  },
  {
    key: "undiscovered",
    label: "Undiscovered",
    width: 145,
    align: "right",
    sortValue: (row) => row.undiscovered,
    filterValue: (row) => row.undiscovered,
    render: (row) => renderNumber(row.undiscovered, "text-text-secondary"),
  },
  {
    key: "sold",
    label: "С продажами",
    width: 140,
    align: "right",
    sortValue: (row) => row.sold,
    filterValue: (row) => row.sold,
    render: (row) => renderNumber(row.sold, "text-success"),
  },
  {
    key: "aiShare",
    label: "Доля AI",
    width: 135,
    align: "right",
    sortValue: (row) => row.aiShare,
    filterValue: (row) => row.aiShare,
    render: (row) => percent(row.aiShare),
  },
  {
    key: "totalAi",
    label: "Всего AI",
    width: 125,
    align: "right",
    sortValue: (row) => row.totalAi,
    filterValue: (row) => row.totalAi,
    render: (row) => renderNumber(row.totalAi),
  },
  {
    key: "undiscoveredAi",
    label: "AI undiscovered",
    width: 155,
    align: "right",
    sortValue: (row) => row.undiscoveredAi,
    filterValue: (row) => row.undiscoveredAi,
    render: (row) => renderNumber(row.undiscoveredAi),
  },
  {
    key: "aiTop100",
    label: "AI top-100",
    width: 135,
    sortValue: (row) => row.aiTop100,
    filterValue: (row) => row.aiTop100,
    render: (row) => row.aiTop100 === null || row.topCount === null ? "—" : `${row.aiTop100}/${row.topCount}`,
  },
  ...([1, 2, 3, 6] as const).map((months): ColumnDefinition => ({
    key: `age${months}` as "age1" | "age2" | "age3" | "age6",
    label: `≤ ${months} мес.`,
    width: 135,
    sortValue: (row) => row[`age${months}`]?.total ?? null,
    filterValue: (row) => ageFilter(row[`age${months}`]),
    render: (row) => {
      const metric = row[`age${months}`];
      return (
        <div>
          <p className="font-semibold text-text-primary">{ageLabel(metric)}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">top-10: {metric?.top10Count ?? "—"}</p>
        </div>
      );
    },
  })),
  {
    key: "activity",
    label: "Активность 30д",
    width: 180,
    sortValue: (row) => activityPercent(row.activity),
    filterValue: (row) => `${row.activity?.status ?? ""} ${row.activity?.reason ?? ""} ${activityPercent(row.activity) ?? ""} P${row.activity?.percentile ?? ""}`,
    render: (row) => {
      const value = activityPercent(row.activity);
      if (row.activity?.status === "collecting") return <span className="text-text-muted">Накапливаем</span>;
      if (value === null) return <span className="text-text-muted">Неизвестно</span>;
      return (
        <div>
          <p className={`font-semibold tabular-nums ${activityColor(row.activity)}`}>≥ {percent(value, 2)}</p>
          <p className="mt-0.5 text-[11px] text-text-muted">P{row.activity?.percentile ?? "—"} · пул {row.activity?.poolSize ?? 0}</p>
        </div>
      );
    },
  },
  {
    key: "dynamics",
    label: "Динамика",
    width: 175,
    sortValue: (row) => row.dynamicsChanged,
    filterValue: (row) => `${row.dynamicsEntered ?? ""} ${row.dynamicsExited ?? ""} ${row.dynamicsChanged ?? ""}`,
    render: (row) => row.dynamicsChanged === null ? "Первый снимок" : (
      <div>
        <p className="font-semibold text-text-primary">Ушло {row.dynamicsExited} · пришло {row.dynamicsEntered}</p>
        <p className="mt-0.5 text-[11px] text-text-muted">Сменилось: {row.dynamicsChanged}</p>
      </div>
    ),
  },
  {
    key: "titles",
    label: "Фраза в title top-10",
    width: 170,
    sortValue: (row) => row.titleMatches,
    filterValue: (row) => `${row.titleMatches ?? "unknown"} ${row.titleCoverage ?? ""}`,
    render: (row) => row.titleMatches === null ? "Неизвестно" : row.titleMatches === 0 ? "Нет" : `${row.titleMatches} из 10`,
  },
  {
    key: "overlap",
    label: "Пересечение asset ID",
    width: 300,
    sortValue: (row) => row.bestOverlap,
    filterValue: (row) => row.overlaps.map((item) => `${item.topic} ${item.percent} ${item.count}`).join(" "),
    render: (row) => <OverlapCell overlaps={row.overlaps} hasSnapshot={row.topCount !== null} />,
  },
  {
    key: "status",
    label: "Статус данных",
    width: 160,
    sortValue: (row) => row.statusText,
    filterValue: (row) => row.statusText,
    render: (row) => <span className="text-text-secondary">{row.statusText}</span>,
  },
];

function buildOverlaps(entries: TopicHistoryEntry[]): Map<string, TopicOverlap[]> {
  const latestAssetsByTopic = new Map<string, { topic: string; ids: Set<string> }>();
  for (const entry of entries) {
    if (latestAssetsByTopic.has(entry.topicKey)) continue;
    const assets = entry.result.analytics?.snapshot?.assets;
    if (!assets?.length) continue;
    latestAssetsByTopic.set(entry.topicKey, {
      topic: entry.topic,
      ids: new Set(assets.map((asset) => asset.assetId)),
    });
  }

  const topicsByAsset = new Map<string, Set<string>>();
  for (const [key, value] of latestAssetsByTopic) {
    for (const assetId of value.ids) {
      const topicKeys = topicsByAsset.get(assetId) ?? new Set<string>();
      topicKeys.add(key);
      topicsByAsset.set(assetId, topicKeys);
    }
  }

  const result = new Map<string, TopicOverlap[]>();
  for (const entry of entries) {
    const assets = entry.result.analytics?.snapshot?.assets;
    if (!assets?.length) {
      result.set(entry.id, []);
      continue;
    }
    const rowIds = new Set(assets.map((asset) => asset.assetId));
    const counts = new Map<string, number>();
    for (const assetId of rowIds) {
      for (const otherTopicKey of topicsByAsset.get(assetId) ?? []) {
        if (otherTopicKey === entry.topicKey) continue;
        counts.set(otherTopicKey, (counts.get(otherTopicKey) ?? 0) + 1);
      }
    }
    const overlaps = [...counts.entries()]
      .map(([key, count]) => ({
        topic: latestAssetsByTopic.get(key)?.topic ?? key,
        count,
        percent: Number(((count / rowIds.size) * 100).toFixed(1)),
      }))
      .sort((left, right) => right.percent - left.percent || left.topic.localeCompare(right.topic));
    result.set(entry.id, overlaps);
  }
  return result;
}

function buildRows(entries: TopicHistoryEntry[]): HistoryRow[] {
  const overlapsById = buildOverlaps(entries);
  return entries.map((entry) => {
    const result = entry.result;
    const metrics = result.analytics?.metrics;
    const validMarket = (
      result.demand !== null
      && typeof result.undiscoveredCount === "number"
      && result.undiscoveredCount >= 0
      && result.undiscoveredCount <= result.demand
    );
    const sold = validMarket ? result.demand! - result.undiscoveredCount! : null;
    const totalAi = (
      result.demand !== null
      && typeof result.totalAiCount === "number"
      && result.totalAiCount >= 0
      && result.totalAiCount <= result.demand
    ) ? result.totalAiCount : null;
    const aiShare = totalAi !== null && result.demand !== null && result.demand > 0
      ? (totalAi / result.demand) * 100
      : null;
    const age = (months: 1 | 2 | 3 | 6) => metrics?.ageWindows.find((item) => item.months === months) ?? null;
    const dynamics = metrics?.dynamics;
    const overlaps = overlapsById.get(entry.id) ?? [];
    const statusText = [
      result.status,
      result.analytics?.status,
      result.analytics?.confidence,
      result.marketSalesStatus,
      result.marketAiStatus,
    ].filter(Boolean).join(" · ");

    return {
      entry,
      timestamp: Date.parse(entry.checkedAt),
      demand: result.demand,
      undiscovered: validMarket ? result.undiscoveredCount! : null,
      sold,
      aiShare,
      totalAi,
      undiscoveredAi: typeof result.undiscoveredAiCount === "number" ? result.undiscoveredAiCount : null,
      aiTop100: metrics?.aiCount ?? null,
      topCount: metrics?.topCount ?? null,
      age1: age(1),
      age2: age(2),
      age3: age(3),
      age6: age(6),
      activity: result.activity ?? null,
      dynamicsChanged: dynamics?.changed ?? null,
      dynamicsEntered: dynamics?.entered ?? null,
      dynamicsExited: dynamics?.exited ?? null,
      titleMatches: metrics?.titleMatchesTop10 ?? null,
      titleCoverage: metrics?.titleCoverageTop10 ?? null,
      overlaps,
      bestOverlap: overlaps[0]?.percent ?? null,
      statusText: statusText || "unknown",
    };
  });
}

function compareValues(left: SortValue, right: SortValue, direction: SortDirection): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), "ru", { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}

function matchesFilter(value: SortValue, query: string): boolean {
  const clean = query.trim();
  if (!clean) return true;
  if (typeof value === "number") {
    const comparison = clean.match(/^(<=|>=|<|>|=)\s*(-?[0-9]+(?:[.,][0-9]+)?)$/);
    if (comparison) {
      const target = Number(comparison[2].replace(",", "."));
      if (comparison[1] === "<") return value < target;
      if (comparison[1] === "<=") return value <= target;
      if (comparison[1] === ">") return value > target;
      if (comparison[1] === ">=") return value >= target;
      return value === target;
    }
  }
  return String(value ?? "").toLocaleLowerCase().includes(clean.toLocaleLowerCase());
}

function OverlapCell({ overlaps, hasSnapshot }: { overlaps: TopicOverlap[]; hasSnapshot: boolean }) {
  if (!hasSnapshot) return <span className="text-text-muted">Нет top-100</span>;
  if (overlaps.length === 0) return <span className="text-text-muted">Нет пересечений</span>;
  const visible = overlaps.slice(0, 3);
  const hidden = overlaps.slice(3);
  return (
    <div className="space-y-1" title="Процент считается от уникальных asset ID текущего снимка; сравнение — с последним top-100 каждой другой темы.">
      {visible.map((item) => (
        <p key={item.topic} className="truncate text-[11px] text-text-secondary">
          <span className="font-medium text-text-primary">{item.topic}</span> — {percent(item.percent)} ({item.count} ID)
        </p>
      ))}
      {hidden.length > 0 && (
        <details className="text-[11px] text-text-muted">
          <summary className="cursor-pointer text-accent">Ещё {hidden.length}</summary>
          <div className="mt-1 space-y-1">
            {hidden.map((item) => (
              <p key={item.topic}>{item.topic} — {percent(item.percent)} ({item.count} ID)</p>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function SnapshotDetails({ entry }: { entry: TopicHistoryEntry }) {
  const snapshot = entry.result.analytics?.snapshot;
  if (!snapshot) {
    return <p className="text-sm text-text-muted">Для этой строки top-100 не сохранялся.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-text-muted">
        <span>batch: <span className="text-text-secondary">{snapshot.batchId}</span></span>
        <span>parser: <span className="text-text-secondary">{snapshot.parserVersion}</span></span>
        <span>date model: <span className="text-text-secondary">{snapshot.dateModelVersion}</span></span>
        <span>ID: {(snapshot.coverage.uniqueIdCoverage * 100).toFixed(0)}%</span>
        <span>AI: {(snapshot.coverage.aiCoverage * 100).toFixed(0)}%</span>
        <span>title: {((snapshot.coverage.titleCoverage ?? 0) * 100).toFixed(0)}%</span>
        <span>date: {(snapshot.coverage.dateCoverage * 100).toFixed(0)}%</span>
      </div>
      <div className="max-h-96 overflow-auto rounded-xl border border-border">
        <table className="min-w-[1200px] w-full text-[11px]">
          <thead className="sticky top-0 bg-bg-card">
            <tr>
              {["Ранг", "Asset ID", "Заголовок", "Дата по ID", "Ошибка", "AI", "Продажа"].map((label) => (
                <th key={label} className="border-b border-border px-3 py-2 text-left font-medium text-text-muted">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {snapshot.assets.map((asset) => (
              <tr key={asset.assetId} className="odd:bg-bg-input/30">
                <td className="px-3 py-2 tabular-nums text-text-muted">{asset.rank}</td>
                <td className="px-3 py-2 tabular-nums font-medium text-text-primary">{asset.assetId}</td>
                <td className="max-w-[420px] truncate px-3 py-2 text-text-secondary" title={asset.title ?? undefined}>{asset.title ?? "unknown"}</td>
                <td className="px-3 py-2 tabular-nums text-text-secondary">{asset.estimatedUploadDate ?? "unknown"}</td>
                <td className="px-3 py-2 text-text-muted">{asset.dateErrorDays === null ? "—" : `±${asset.dateErrorDays} дн.`}</td>
                <td className="px-3 py-2">{asset.isAi === null ? "unknown" : asset.isAi ? "AI" : "не AI"}</td>
                <td className="px-3 py-2">{asset.salesStatus === "sold" ? "есть ≥1" : asset.salesStatus === "undiscovered" ? "нет" : "unknown"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface HistoryPanelProps {
  onOpenScan: (request: { sessionId: string; mainTopic: string }) => void;
}

export default function HistoryPanel({ onOpenScan }: HistoryPanelProps) {
  const [entries, setEntries] = useState<TopicHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortKey, setSortKey] = useState<ColumnKey>("date");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filters, setFilters] = useState<Partial<Record<ColumnKey, string>>>({});
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;
    getAllTopicHistory()
      .then((records) => {
        if (!active) return;
        setEntries(records);
        setError("");
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof Error ? value.message : "Не удалось загрузить базу тем");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const rows = useMemo(() => buildRows(entries), [entries]);
  const processedRows = useMemo(() => {
    const filtered = rows.filter((row) => columns.every((column) => (
      matchesFilter(column.filterValue(row), filters[column.key] ?? "")
    )));
    const column = columns.find((item) => item.key === sortKey) ?? columns[0];
    return [...filtered].sort((left, right) => (
      compareValues(column.sortValue(left), column.sortValue(right), sortDirection)
    ));
  }, [filters, rows, sortDirection, sortKey]);

  useEffect(() => {
    const element = sentinelRef.current;
    if (!element || visibleCount >= processedRows.length) return;
    const observer = new IntersectionObserver((items) => {
      if (items.some((item) => item.isIntersecting)) {
        setVisibleCount((current) => Math.min(current + PAGE_SIZE, processedRows.length));
      }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [processedRows.length, visibleCount]);

  const visibleRows = processedRows.slice(0, visibleCount);
  const uniqueTopics = new Set(entries.map((entry) => entry.topicKey)).size;
  const activeFilters = Object.values(filters).some((value) => value?.trim());

  const handleSort = (key: ColumnKey) => {
    setVisibleCount(PAGE_SIZE);
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  };

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-text-muted">Загрузка локальной базы тем…</div>;
  }

  if (error) {
    return <div className="rounded-2xl border border-error/20 bg-bg-card p-6 text-sm text-error">{error}</div>;
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-bg-card p-10 text-center">
        <h2 className="text-lg font-semibold text-text-primary">База тем пока пустая</h2>
        <p className="mt-1 text-sm text-text-muted">После следующего поиска здесь появятся все темы и их датированные снимки.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Локальная база тем</h2>
          <p className="mt-1 text-xs text-text-muted">
            {entries.length.toLocaleString("ru-RU")} снимков · {uniqueTopics.toLocaleString("ru-RU")} уникальных тем · показано {visibleRows.length.toLocaleString("ru-RU")} из {processedRows.length.toLocaleString("ru-RU")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeFilters && (
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setVisibleCount(PAGE_SIZE);
              }}
              className="rounded-xl border border-border bg-bg-input px-3 py-2 text-xs text-text-secondary cursor-pointer hover:border-border-hover"
            >
              Сбросить фильтры
            </button>
          )}
          <button
            type="button"
            disabled={visibleCount >= processedRows.length}
            onClick={() => setVisibleCount(processedRows.length)}
            className="rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white cursor-pointer disabled:cursor-default disabled:opacity-40"
          >
            Показать все
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-bg-card">
        <table className="min-w-[3300px] table-fixed border-separate border-spacing-0 text-xs">
          <colgroup>
            {columns.map((column) => <col key={column.key} style={{ width: column.width }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-bg-card">
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={`border-b border-border px-3 pt-3 pb-2 ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left"}`}>
                  <button
                    type="button"
                    onClick={() => handleSort(column.key)}
                    className="inline-flex items-center gap-1 bg-transparent text-[11px] font-medium uppercase tracking-wider text-text-muted cursor-pointer hover:text-text-primary"
                  >
                    {column.label}
                    <span className={sortKey === column.key ? "text-accent" : "text-text-muted/40"}>
                      {sortKey === column.key ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className="border-b border-border px-2 pb-2">
                  <input
                    value={filters[column.key] ?? ""}
                    onChange={(event) => {
                      setFilters((current) => ({ ...current, [column.key]: event.target.value }));
                      setVisibleCount(PAGE_SIZE);
                    }}
                    placeholder="Фильтр"
                    title="Для чисел: >100, <=20 или обычный поиск"
                    className="w-full rounded-lg border border-border bg-bg-input px-2 py-1.5 text-[11px] font-normal text-text-primary outline-none placeholder:text-text-muted/60 focus:border-accent"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <Fragment key={row.entry.id}>
                <tr className="align-top hover:bg-bg-input/35">
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={`border-b border-border/50 px-3 py-3 leading-snug text-text-secondary ${column.align === "right" ? "text-right" : column.align === "center" ? "text-center" : "text-left"}`}
                    >
                      {column.key === "mainTopic" ? (
                        <button
                          type="button"
                          onClick={() => onOpenScan({
                            sessionId: row.entry.sessionId,
                            mainTopic: row.entry.mainTopic ?? row.entry.topic,
                          })}
                          className="max-w-full truncate bg-transparent p-0 text-left text-accent cursor-pointer hover:underline"
                          title="Открыть весь сохранённый скан основной темы"
                        >
                          {column.render(row)}
                        </button>
                      ) : column.key === "topic" ? (
                        <button
                          type="button"
                          disabled={!row.entry.result.analytics?.snapshot}
                          onClick={() => setExpandedId((current) => current === row.entry.id ? null : row.entry.id)}
                          className="flex w-full items-start gap-2 bg-transparent text-left cursor-pointer disabled:cursor-default"
                          title={row.entry.result.analytics?.snapshot ? "Показать сохранённые asset ID" : undefined}
                        >
                          <span className="text-text-muted">{row.entry.result.analytics?.snapshot ? (expandedId === row.entry.id ? "▾" : "▸") : ""}</span>
                          {column.render(row)}
                        </button>
                      ) : column.render(row)}
                    </td>
                  ))}
                </tr>
                {expandedId === row.entry.id && (
                  <tr>
                    <td colSpan={columns.length} className="border-b border-border bg-bg-primary/60 px-5 py-4">
                      <SnapshotDetails entry={row.entry} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {processedRows.length === 0 && (
        <div className="rounded-xl border border-border bg-bg-card p-8 text-center text-sm text-text-muted">
          По заданным фильтрам ничего не найдено.
        </div>
      )}

      <div ref={sentinelRef} className="flex min-h-10 items-center justify-center text-xs text-text-muted">
        {visibleCount < processedRows.length
          ? `Прокрутите ниже — загрузятся ещё ${Math.min(PAGE_SIZE, processedRows.length - visibleCount)} строк`
          : `Показаны все ${processedRows.length.toLocaleString("ru-RU")} строк`}
      </div>
    </div>
  );
}
