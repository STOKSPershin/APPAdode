import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getOwnPortfolioAssets,
  getOwnSaleEvents,
  removeOwnPortfolioAsset,
  removeOwnSaleEvent,
  saveOwnPortfolioAsset,
  saveOwnSaleEvent,
} from "@shared/api/portfolio";
import type { OwnPortfolioAsset, OwnSaleEvent } from "@shared/types";

export default function PortfolioPanel() {
  const [assets, setAssets] = useState<OwnPortfolioAsset[]>([]);
  const [sales, setSales] = useState<OwnSaleEvent[]>([]);
  const [assetId, setAssetId] = useState("");
  const [topic, setTopic] = useState("");
  const [uploadedAt, setUploadedAt] = useState("");
  const [isAi, setIsAi] = useState(true);
  const [saleAssetId, setSaleAssetId] = useState("");
  const [soldAt, setSoldAt] = useState("");
  const [revenue, setRevenue] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [nextAssets, nextSales] = await Promise.all([
      getOwnPortfolioAssets(),
      getOwnSaleEvents(),
    ]);
    setAssets(nextAssets);
    setSales(nextSales);
    setSaleAssetId((current) => current || nextAssets[0]?.assetId || "");
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([getOwnPortfolioAssets(), getOwnSaleEvents()])
      .then(([nextAssets, nextSales]) => {
        if (!active) return;
        setAssets(nextAssets);
        setSales(nextSales);
        setSaleAssetId(nextAssets[0]?.assetId ?? "");
      })
      .catch((value: unknown) => {
        if (active) setError(value instanceof Error ? value.message : "Не удалось загрузить данные");
      });
    return () => { active = false; };
  }, []);

  const salesByAsset = useMemo(() => {
    const counts = new Map<string, { count: number; revenue: number }>();
    for (const sale of sales) {
      const current = counts.get(sale.assetId) ?? { count: 0, revenue: 0 };
      current.count += 1;
      current.revenue += sale.revenue ?? 0;
      counts.set(sale.assetId, current);
    }
    return counts;
  }, [sales]);

  const addAsset = async () => {
    setError(""); setMessage("");
    try {
      await saveOwnPortfolioAsset({ assetId, topic, uploadedAt, isAi });
      await refresh();
      setMessage("Работа сохранена");
      setAssetId(""); setTopic(""); setUploadedAt("");
    } catch (value: unknown) {
      setError(value instanceof Error ? value.message : "Не удалось сохранить работу");
    }
  };

  const addSale = async () => {
    setError(""); setMessage("");
    try {
      await saveOwnSaleEvent({
        assetId: saleAssetId,
        soldAt,
        revenue: revenue.trim() ? Number(revenue) : null,
        note,
      });
      await refresh();
      setMessage("Продажа сохранена");
      setSoldAt(""); setRevenue(""); setNote("");
    } catch (value: unknown) {
      setError(value instanceof Error ? value.message : "Не удалось сохранить продажу");
    }
  };

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid lg:grid-cols-2 gap-5">
        <section className="bg-bg-card border border-border rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Мои загрузки</h2>
            <p className="text-xs text-text-muted mt-1">Эти факты станут собственной истиной для будущей калибровки оценки тем.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Asset ID"><input value={assetId} onChange={(event) => setAssetId(event.target.value)} inputMode="numeric" className={inputClass} /></Field>
            <Field label="Дата загрузки"><input type="date" value={uploadedAt} onChange={(event) => setUploadedAt(event.target.value)} className={inputClass} /></Field>
            <Field label="Тема"><input value={topic} onChange={(event) => setTopic(event.target.value)} maxLength={200} className={inputClass} /></Field>
            <label className="flex items-end gap-2 pb-2 text-sm text-text-secondary">
              <input type="checkbox" checked={isAi} onChange={(event) => setIsAi(event.target.checked)} /> AI-работа
            </label>
          </div>
          <button type="button" onClick={() => void addAsset()} className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold cursor-pointer">Сохранить загрузку</button>
        </section>

        <section className="bg-bg-card border border-border rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold text-text-primary">Факт продажи</h2>
            <p className="text-xs text-text-muted mt-1">Каждая лицензия записывается отдельным событием.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Работа">
              <select value={saleAssetId} onChange={(event) => setSaleAssetId(event.target.value)} className={inputClass}>
                <option value="">Выберите Asset ID</option>
                {assets.map((asset) => <option key={asset.id} value={asset.assetId}>{asset.assetId} · {asset.topic}</option>)}
              </select>
            </Field>
            <Field label="Дата продажи"><input type="date" value={soldAt} onChange={(event) => setSoldAt(event.target.value)} className={inputClass} /></Field>
            <Field label="Доход, $ (необязательно)"><input type="number" min="0" step="0.01" value={revenue} onChange={(event) => setRevenue(event.target.value)} className={inputClass} /></Field>
            <Field label="Комментарий"><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className={inputClass} /></Field>
          </div>
          <button type="button" disabled={!assets.length} onClick={() => void addSale()} className="px-4 py-2 rounded-xl bg-accent text-white text-sm font-semibold cursor-pointer disabled:opacity-40">Добавить продажу</button>
        </section>
      </div>

      {message && <p className="text-sm text-success">{message}</p>}
      {error && <p className="text-sm text-error">{error}</p>}

      <section className="bg-bg-card border border-border rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead><tr>{["Asset ID", "Тема", "Загружено", "AI", "Продаж", "Доход", ""].map((label) => <th key={label} className="border-b border-border px-4 py-3 text-left text-xs uppercase text-text-muted">{label}</th>)}</tr></thead>
          <tbody>
            {assets.map((asset) => {
              const outcome = salesByAsset.get(asset.assetId) ?? { count: 0, revenue: 0 };
              return (
                <tr key={asset.id}>
                  <td className="border-b border-border/50 px-4 py-3 font-medium tabular-nums">{asset.assetId}</td>
                  <td className="border-b border-border/50 px-4 py-3">{asset.topic}</td>
                  <td className="border-b border-border/50 px-4 py-3 tabular-nums">{asset.uploadedAt}</td>
                  <td className="border-b border-border/50 px-4 py-3">{asset.isAi ? "AI" : "не AI"}</td>
                  <td className="border-b border-border/50 px-4 py-3 tabular-nums">{outcome.count}</td>
                  <td className="border-b border-border/50 px-4 py-3 tabular-nums">${outcome.revenue.toFixed(2)}</td>
                  <td className="border-b border-border/50 px-4 py-3 text-right"><button type="button" onClick={() => { void removeOwnPortfolioAsset(asset.id).then(refresh); }} className="text-error cursor-pointer">Удалить</button></td>
                </tr>
              );
            })}
            {assets.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-text-muted">Загрузки ещё не добавлены</td></tr>}
          </tbody>
        </table>
      </section>

      {sales.length > 0 && (
        <section className="bg-bg-card border border-border rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Последние продажи</h3>
          <div className="space-y-2">
            {sales.slice(0, 20).map((sale) => (
              <div key={sale.id} className="flex items-center justify-between gap-3 rounded-xl bg-bg-input px-3 py-2 text-xs">
                <span className="text-text-secondary">{sale.assetId} · {sale.soldAt} · {sale.revenue === null ? "сумма не указана" : `$${sale.revenue.toFixed(2)}`}</span>
                <button type="button" onClick={() => { void removeOwnSaleEvent(sale.id).then(refresh); }} className="text-error cursor-pointer">Удалить</button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const inputClass = "w-full rounded-xl border border-border bg-bg-input px-3 py-2 text-sm text-text-primary outline-none focus:border-accent";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="space-y-1.5 text-xs text-text-secondary"><span className="block">{label}</span>{children}</label>;
}
