import { useEffect, useState } from "react";
import { getSavedTopics, removeSavedTopic } from "@shared/api/saved-items";
import { recalibrateTopicAnalytics } from "@shared/api/adobe-stock";
import type { SavedItem } from "@shared/types";
import ResultsTable from "./ResultsTable";

interface SavedItemsProps {
  onOpenScan: (request: {
    sessionId?: string;
    mainTopic: string;
    nearTimestamp?: number;
  }) => void;
}

export default function SavedItems({ onOpenScan }: SavedItemsProps) {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getDisplayItems()
      .then((data) => {
        if (!active) return;
        setItems(data);
        setError("");
      })
      .catch((value: unknown) => {
        if (!active) return;
        setError(value instanceof Error ? value.message : "Не удалось загрузить избранное");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleRemove = async (id: string) => {
    await removeSavedTopic(id);
    setItems((current) => current.filter((item) => item.id !== id));
  };

  if (isLoading) {
    return <div className="py-20 text-center text-sm text-text-muted">Загрузка избранного…</div>;
  }

  if (error) {
    return (
      <div className="bg-bg-card border border-error/20 rounded-2xl p-6 text-center">
        <p className="text-sm text-error">{error}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-2xl p-10 text-center animate-fade-in">
        <div className="text-3xl text-accent mb-3">♡</div>
        <h3 className="text-lg font-semibold text-text-primary">Пока пусто</h3>
        <p className="mt-1 text-sm text-text-muted">Нажмите сердце в результатах скана, чтобы сохранить тему вместе с последним снимком.</p>
      </div>
    );
  }

  return (
    <ResultsTable
      mainTopic=""
      userTopicResult={null}
      results={[]}
      warning={null}
      expectedCount={items.length}
      isGenerating={false}
      savedItems={items}
      onRemoveSaved={handleRemove}
      onOpenSavedScan={(item) => onOpenScan({
        sessionId: item.historySessionId,
        mainTopic: item.mainTopic,
        nearTimestamp: item.scanTimestamp ?? Date.parse(item.createdAt),
      })}
    />
  );
}

async function getDisplayItems(): Promise<SavedItem[]> {
  const items = await getSavedTopics();
  return Promise.all(items.map(async (item) => (
    item.analytics
      ? { ...item, analytics: await recalibrateTopicAnalytics(item.analytics) }
      : item
  )));
}
