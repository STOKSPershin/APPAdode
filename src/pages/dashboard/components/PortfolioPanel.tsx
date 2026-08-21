import { useEffect, useMemo, useState } from "react";
import { getAllTopicHistory } from "@shared/api/history";
import { getAdobeSalesImport, importAdobeSalesCsv } from "@shared/api/portfolio";
import type { AdobeSalesImport, ImportedAdobeSale, TopicHistoryEntry } from "@shared/types";

type SortKey = "assetId" | "sales" | "revenue" | "lastSale" | "matches";
type SortDirection = "asc" | "desc";

interface AssetSalesRow {
  assetId: string;
  title: string;
  fileName: string;
  contentType: string;
  licenseTypes: string[];
  sales: number;
  revenue: number;
  firstSale: string;
  lastSale: string;
  matches: TopicPosition[];
}

interface TopicPosition {
  topicKey: string;
  topic: string;
  mainTopic: string | null;
  totalWorks: number | null;
  rank: number;
  checkedAt: string;
  isCurrent: boolean;
  snapshotCount: number;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildTopicPositions(entries: TopicHistoryEntry[]): Map<string, TopicPosition[]> {
  const sorted = [...entries].sort((left, right) => Date.parse(right.checkedAt) - Date.parse(left.checkedAt));
  const latestEntryByTopic = new Map<string, string>();
  for (const entry of sorted) {
    if (!latestEntryByTopic.has(entry.topicKey)) latestEntryByTopic.set(entry.topicKey, entry.id);
  }

  const grouped = new Map<string, Map<string, TopicPosition>>();
  for (const entry of sorted) {
    const observations = entry.result.analytics?.snapshot?.assets;
    if (!observations?.length) continue;
    for (const observation of observations) {
      const byTopic = grouped.get(observation.assetId) ?? new Map<string, TopicPosition>();
      const existing = byTopic.get(entry.topicKey);
      if (existing) {
        existing.snapshotCount += 1;
      } else {
        byTopic.set(entry.topicKey, {
          topicKey: entry.topicKey,
          topic: entry.topic,
          mainTopic: entry.mainTopic,
          totalWorks: entry.result.demand ?? entry.result.analytics?.snapshot?.totalResults ?? null,
          rank: observation.rank,
          checkedAt: entry.checkedAt,
          isCurrent: latestEntryByTopic.get(entry.topicKey) === entry.id,
          snapshotCount: 1,
        });
      }
      grouped.set(observation.assetId, byTopic);
    }
  }

  return new Map([...grouped.entries()].map(([assetId, topics]) => [
    assetId,
    [...topics.values()].sort((left, right) => (
      Number(right.isCurrent) - Number(left.isCurrent)
      || left.rank - right.rank
      || left.topic.localeCompare(right.topic)
    )),
  ]));
}

function aggregateSales(
  records: ImportedAdobeSale[],
  matchesByAsset: Map<string, TopicPosition[]>,
): AssetSalesRow[] {
  const aggregates = new Map<string, AssetSalesRow>();
  for (const sale of records) {
    const existing = aggregates.get(sale.assetId);
    if (!existing) {
      aggregates.set(sale.assetId, {
        assetId: sale.assetId,
        title: sale.title,
        fileName: sale.fileName,
        contentType: sale.contentType,
        licenseTypes: [sale.licenseType],
        sales: 1,
        revenue: sale.revenue,
        firstSale: sale.soldAt,
        lastSale: sale.soldAt,
        matches: matchesByAsset.get(sale.assetId) ?? [],
      });
      continue;
    }
    existing.sales += 1;
    existing.revenue += sale.revenue;
    if (sale.soldAt < existing.firstSale) existing.firstSale = sale.soldAt;
    if (sale.soldAt > existing.lastSale) {
      existing.lastSale = sale.soldAt;
      existing.title = sale.title;
      existing.fileName = sale.fileName;
      existing.contentType = sale.contentType;
    }
    if (!existing.licenseTypes.includes(sale.licenseType)) existing.licenseTypes.push(sale.licenseType);
  }
  return [...aggregates.values()];
}

function sortValue(row: AssetSalesRow, key: SortKey): string | number {
  if (key === "assetId") return Number(row.assetId);
  if (key === "sales") return row.sales;
  if (key === "revenue") return row.revenue;
  if (key === "lastSale") return Date.parse(row.lastSale);
  return row.matches.length;
}

export default function PortfolioPanel() {
  const [salesImport, setSalesImport] = useState<AdobeSalesImport | null>(null);
  const [history, setHistory] = useState<TopicHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [onlyMatched, setOnlyMatched] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("revenue");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    let active = true;
    Promise.all([getAdobeSalesImport(), getAllTopicHistory()])
      .then(([nextImport, nextHistory]) => {
        if (!active) return;
        setSalesImport(nextImport);
        setHistory(nextHistory);
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof Error ? value.message : "Не удалось загрузить локальные данные");
      })
      .finally(() => {
        if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const matchesByAsset = useMemo(() => buildTopicPositions(history), [history]);
  const allRows = useMemo(
    () => aggregateSales(salesImport?.records ?? [], matchesByAsset),
    [matchesByAsset, salesImport],
  );
  const rows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = allRows.filter((row) => {
      if (onlyMatched && row.matches.length === 0) return false;
      if (!normalizedQuery) return true;
      return row.assetId.includes(normalizedQuery)
        || row.title.toLocaleLowerCase().includes(normalizedQuery)
        || row.fileName.toLocaleLowerCase().includes(normalizedQuery)
        || row.matches.some((match) => (
          match.topic.toLocaleLowerCase().includes(normalizedQuery)
          || match.mainTopic?.toLocaleLowerCase().includes(normalizedQuery)
        ));
    });
    const direction = sortDirection === "asc" ? 1 : -1;
    return filtered.sort((left, right) => {
      const leftValue = sortValue(left, sortKey);
      const rightValue = sortValue(right, sortKey);
      if (typeof leftValue === "string" && typeof rightValue === "string") {
        return leftValue.localeCompare(rightValue) * direction;
      }
      return (Number(leftValue) - Number(rightValue)) * direction;
    });
  }, [allRows, onlyMatched, query, sortDirection, sortKey]);

  const totals = useMemo(() => ({
    sales: salesImport?.records.length ?? 0,
    assets: allRows.length,
    revenue: allRows.reduce((sum, row) => sum + row.revenue, 0),
    matched: allRows.filter((row) => row.matches.length > 0).length,
  }), [allRows, salesImport]);

  const handleImport = async (file: File) => {
    setImporting(true);
    setError("");
    setMessage("");
    try {
      if (!file.name.toLocaleLowerCase().endsWith(".csv")) throw new Error("Выберите CSV-файл Adobe");
      if (file.size > 20 * 1024 * 1024) throw new Error("CSV больше 20 МБ");
      const nextImport = await importAdobeSalesCsv(await file.text(), file.name);
      setSalesImport(nextImport);
      setMessage(`Импортировано ${formatCount(nextImport.records.length)} продаж. Предыдущая CSV-выгрузка заменена без дублей.`);
    } catch (value: unknown) {
      setError(value instanceof Error ? value.message : "Не удалось импортировать CSV");
    } finally {
      setImporting(false);
    }
  };

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection(key === "assetId" ? "asc" : "desc");
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-sm text-text-muted">Загрузка продаж и снимков тем…</div>;
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <section className="rounded-2xl border border-border bg-bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-base font-semibold text-text-primary">Мои продажи и позиции в темах</h2>
            <p className="mt-1 text-xs leading-relaxed text-text-muted">
              Загрузите Adobe CSV из истории лицензий. Данные хранятся только локально. Повторный импорт заменит прошлую выгрузку и не создаст дубли.
            </p>
            {salesImport && (
              <p className="mt-2 text-[11px] text-text-muted">
                Файл: <span className="text-text-secondary">{salesImport.sourceFileName}</span> · импортирован {formatDateTime(salesImport.importedAt)}
              </p>
            )}
          </div>
          <label className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white cursor-pointer hover:bg-accent-hover">
            {importing ? "Импорт…" : salesImport ? "Обновить CSV" : "Загрузить CSV"}
            <input
              type="file"
              accept=".csv,text/csv"
              disabled={importing}
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void handleImport(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
        </div>

        {message && <div className="mt-4 rounded-xl border border-success/20 bg-success/8 px-4 py-3 text-sm text-success">{message}</div>}
        {error && <div className="mt-4 rounded-xl border border-error/20 bg-error/8 px-4 py-3 text-sm text-error">{error}</div>}

        {salesImport && (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <SummaryCard label="Продаж" value={formatCount(totals.sales)} />
            <SummaryCard label="Проданных работ" value={formatCount(totals.assets)} />
            <SummaryCard label="Доход" value={formatMoney(totals.revenue)} />
            <SummaryCard label="Найдены в темах" value={`${formatCount(totals.matched)} из ${formatCount(totals.assets)}`} />
          </div>
        )}
      </section>

      {salesImport ? (
        <section className="overflow-hidden rounded-2xl border border-border bg-bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Проданные работы</h3>
              <p className="mt-0.5 text-[11px] text-text-muted">Показано {formatCount(rows.length)} из {formatCount(allRows.length)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Asset ID, название или тема"
                className="w-64 rounded-xl border border-border bg-bg-input px-3 py-2 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
              />
              <label className="flex items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" checked={onlyMatched} onChange={(event) => setOnlyMatched(event.target.checked)} />
                Только найденные в темах
              </label>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1250px] text-sm">
              <thead className="bg-bg-secondary">
                <tr>
                  <SortableHeader label="Asset ID" sortKey="assetId" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <th className={headerClass}>Работа</th>
                  <th className={headerClass}>Тип / лицензии</th>
                  <SortableHeader label="Продаж" sortKey="sales" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Доход" sortKey="revenue" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Последняя продажа" sortKey="lastSale" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                  <SortableHeader label="Темы и позиции" sortKey="matches" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.assetId} className="align-top odd:bg-bg-input/20 hover:bg-accent/4">
                    <td className={`${cellClass} font-semibold tabular-nums text-text-primary`}>{row.assetId}</td>
                    <td className={`${cellClass} max-w-[360px]`}>
                      <p className="line-clamp-2 font-medium leading-snug text-text-primary" title={row.title}>{row.title}</p>
                      <p className="mt-1 truncate text-[10px] text-text-muted" title={row.fileName}>{row.fileName}</p>
                    </td>
                    <td className={cellClass}>
                      <p className="text-xs text-text-secondary">{row.contentType || "—"}</p>
                      <p className="mt-1 text-[10px] text-text-muted">{row.licenseTypes.join(", ") || "—"}</p>
                    </td>
                    <td className={`${cellClass} font-semibold tabular-nums text-text-primary`}>{formatCount(row.sales)}</td>
                    <td className={`${cellClass} font-semibold tabular-nums text-success`}>{formatMoney(row.revenue)}</td>
                    <td className={`${cellClass} whitespace-nowrap text-xs tabular-nums text-text-secondary`}>
                      {formatDateTime(row.lastSale)}
                      <p className="mt-1 text-[10px] text-text-muted">первая: {formatDateTime(row.firstSale)}</p>
                    </td>
                    <td className={`${cellClass} min-w-[390px]`}><TopicPositions positions={row.matches} /></td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-12 text-center text-sm text-text-muted">По заданному фильтру ничего не найдено</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-border bg-bg-card px-6 py-16 text-center">
          <p className="text-sm font-medium text-text-primary">CSV с продажами ещё не загружен</p>
          <p className="mt-2 text-xs text-text-muted">Подходит файл downloads.csv из истории продаж Adobe.</p>
        </section>
      )}
    </div>
  );
}

function TopicPositions({ positions }: { positions: TopicPosition[] }) {
  if (positions.length === 0) {
    return <span className="text-xs text-text-muted">Asset ID не встречался в сохранённых top-100</span>;
  }
  const visible = positions.slice(0, 3);
  const hidden = positions.slice(3);
  return (
    <div className="space-y-1.5">
      {visible.map((position) => <TopicPositionItem key={position.topicKey} position={position} />)}
      {hidden.length > 0 && (
        <details className="group">
          <summary className="w-fit cursor-pointer list-none text-[11px] text-accent hover:text-accent-hover">
            Ещё {hidden.length} {hidden.length === 1 ? "тема" : "тем"} ▾
          </summary>
          <div className="mt-1.5 space-y-1.5">
            {hidden.map((position) => <TopicPositionItem key={position.topicKey} position={position} />)}
          </div>
        </details>
      )}
    </div>
  );
}

function TopicPositionItem({ position }: { position: TopicPosition }) {
  const context = position.mainTopic && position.mainTopic.toLocaleLowerCase() !== position.topic.toLocaleLowerCase()
    ? ` · главная: ${position.mainTopic}`
    : "";
  return (
    <div
      className={`rounded-lg border px-2.5 py-1.5 ${
        position.isCurrent
          ? "border-accent/20 bg-accent/8"
          : "border-border bg-bg-input/50"
      }`}
      title={`${formatDateTime(position.checkedAt)}${context}`}
    >
      <p className="text-xs leading-snug text-text-primary">
        <span className="font-medium">{position.topic}</span>{" "}
        <span className="text-text-muted">({position.totalWorks === null ? "?" : `${formatCount(position.totalWorks)} работ`})</span>{" "}
        <span className={position.isCurrent ? "font-semibold text-accent" : "text-text-secondary"}>
          · {position.isCurrent ? "место" : "было место"} {position.rank}
        </span>
      </p>
      <p className="mt-0.5 text-[10px] text-text-muted">
        снимок {formatDateTime(position.checkedAt)}
        {position.snapshotCount > 1 ? ` · встречался в ${position.snapshotCount} снимках` : ""}
        {context}
      </p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg-input px-4 py-3">
      <p className="text-[10px] uppercase tracking-wider text-text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function SortableHeader({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKey: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  return (
    <th className={headerClass}>
      <button type="button" onClick={() => onSort(sortKey)} className="flex items-center gap-1 cursor-pointer text-left hover:text-text-secondary">
        {label}
        <span className={`text-[9px] ${activeKey === sortKey ? "text-accent" : "text-text-muted/40"}`}>
          {activeKey === sortKey ? direction === "asc" ? "↑" : "↓" : "↕"}
        </span>
      </button>
    </th>
  );
}

const headerClass = "border-b border-border px-4 py-3 text-left text-[10px] font-medium uppercase tracking-wider text-text-muted";
const cellClass = "border-b border-border/60 px-4 py-3";
