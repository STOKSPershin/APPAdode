import type { MarketActivity, SavedItem, TopicAnalytics } from "@shared/types";

const STORAGE_KEY = "topicHunter_savedTopics";

let storageWriteQueue: Promise<void> = Promise.resolve();

function hasChromeStorage(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readItems(): Promise<SavedItem[]> {
  if (hasChromeStorage()) {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    return Array.isArray(data[STORAGE_KEY])
      ? (data[STORAGE_KEY] as SavedItem[])
      : [];
  }

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedItem[]) : [];
  } catch {
    return [];
  }
}

async function writeItems(items: SavedItem[]): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [STORAGE_KEY]: items });
    return;
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function updateItems(
  updater: (items: SavedItem[]) => SavedItem[],
): Promise<void> {
  const operation = storageWriteQueue.then(async () => {
    const items = await readItems();
    await writeItems(updater(items));
  });

  storageWriteQueue = operation.catch(() => undefined);
  return operation;
}

function itemKey(mainTopic: string, subtopic: string): string {
  return `${mainTopic.trim().toLocaleLowerCase()}\u0000${subtopic.trim().toLocaleLowerCase()}`;
}

export async function saveTopic(
  mainTopic: string,
  subtopic: string,
  demand: number | null,
  undiscoveredCount?: number | null,
  analytics?: TopicAnalytics,
  totalAiCount?: number | null,
  undiscoveredAiCount?: number | null,
  activity?: MarketActivity,
  historySessionId?: string,
  scanTimestamp?: number,
): Promise<void> {
  const cleanMainTopic = mainTopic.trim();
  const cleanSubtopic = subtopic.trim();

  if (!cleanSubtopic) {
    throw new Error("Нельзя сохранить пустую тему");
  }

  return updateItems((items) => {
    const key = itemKey(cleanMainTopic, cleanSubtopic);
    const existingIndex = items.findIndex(
      (item) => itemKey(item.mainTopic, item.subtopic) === key,
    );

    if (existingIndex >= 0) {
      return items.map((item, index) =>
        index === existingIndex
          ? {
              ...item,
              mainTopic: cleanMainTopic,
              subtopic: cleanSubtopic,
              demand,
              undiscoveredCount: undiscoveredCount === undefined
                ? item.undiscoveredCount
                : undiscoveredCount,
              analytics: analytics ?? item.analytics,
              totalAiCount: totalAiCount === undefined ? item.totalAiCount : totalAiCount,
              undiscoveredAiCount: undiscoveredAiCount === undefined
                ? item.undiscoveredAiCount
                : undiscoveredAiCount,
              activity: activity ?? item.activity,
              historySessionId: historySessionId ?? item.historySessionId,
              scanTimestamp: scanTimestamp ?? item.scanTimestamp,
            }
          : item,
      );
    }

    return [
      {
        id: crypto.randomUUID(),
        mainTopic: cleanMainTopic,
        subtopic: cleanSubtopic,
        demand,
        undiscoveredCount,
        createdAt: new Date().toISOString(),
        analytics,
        totalAiCount,
        undiscoveredAiCount,
        activity,
        historySessionId,
        scanTimestamp,
      },
      ...items,
    ];
  });
}

export function removeSavedTopic(id: string): Promise<void> {
  return updateItems((items) => items.filter((item) => item.id !== id));
}

export async function getSavedTopics(): Promise<SavedItem[]> {
  const items = await readItems();
  return [...items].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}
