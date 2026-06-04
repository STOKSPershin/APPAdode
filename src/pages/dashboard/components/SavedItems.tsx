import { useState, useEffect, useCallback } from "react";
import { getSavedTopics, removeSavedTopic } from "../../../shared/api/supabase";

interface SavedItem {
  id: string;
  main_topic: string;
  subtopic: string;
  demand: number;
  created_at: string;
}

export default function SavedItems() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadItems = useCallback(async () => {
    try {
      setIsLoading(true);
      setError("");
      const data = await getSavedTopics();
      setItems(data);
    } catch (err: any) {
      setError(err.message || "Не удалось загрузить избранное");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleRemove = async (id: string) => {
    try {
      await removeSavedTopic(id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (err: any) {
      setError(err.message || "Не удалось удалить");
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const handleCopyAll = () => {
    const text = items.map((item) => item.subtopic).join("\n");
    navigator.clipboard.writeText(text);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="w-8 h-8 text-accent animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-bg-card border border-error/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-error mb-3">{error}</p>
        <button onClick={loadItems} className="px-4 py-2 rounded-xl text-sm font-medium bg-accent text-white hover:bg-accent-hover transition-all cursor-pointer">
          Повторить
        </button>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-2xl p-10 text-center animate-fade-in">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
          <svg className="w-7 h-7 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-text-primary mb-1">Пока пусто</h3>
        <p className="text-sm text-text-muted">Нажмите ❤ в результатах скана, чтобы сохранить тему</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header with copy all */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-text-primary">
          Избранное <span className="text-text-muted font-normal">({items.length})</span>
        </h2>
        <button onClick={handleCopyAll} title="Копировать все" className="px-3 py-1.5 rounded-xl text-xs font-medium border border-border bg-bg-input text-text-secondary hover:border-border-hover hover:text-text-primary cursor-pointer transition-all flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
          Копировать все
        </button>
      </div>

      {/* Table */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Основная тема</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Подтема</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider">Спрос</th>
              <th className="text-right px-4 py-3 text-xs font-medium text-text-muted uppercase tracking-wider w-24">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-border/50 last:border-b-0 hover:bg-bg-input/50 transition-colors">
                <td className="px-4 py-3 text-text-secondary">{item.main_topic}</td>
                <td className="px-4 py-3 text-text-primary font-medium">{item.subtopic}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{item.demand?.toLocaleString() ?? "—"}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button onClick={() => handleCopy(item.subtopic)} title="Копировать" className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-accent hover:bg-accent/10 transition-all cursor-pointer border-none bg-transparent">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
                      </svg>
                    </button>
                    <button onClick={() => handleRemove(item.id)} title="Удалить" className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-error hover:bg-error/10 transition-all cursor-pointer border-none bg-transparent">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
