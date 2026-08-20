import type { TopicAnalytics } from "@shared/types";

const STORAGE_KEY = "topicHunter_analyticsCache_v1";
const MAX_ENTRIES = 60;
const DAY_MS = 86_400_000;

interface CacheEntry {
  key: string;
  topic: string;
  savedAt: number;
  analytics: TopicAnalytics;
}

let writeQueue: Promise<void> = Promise.resolve();

function topicKey(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

async function readEntries(): Promise<CacheEntry[]> {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(data[STORAGE_KEY])
    ? (data[STORAGE_KEY] as CacheEntry[])
    : [];
}

function writeEntries(entries: CacheEntry[]): Promise<void> {
  const operation = writeQueue.then(() =>
    chrome.storage.local.set({ [STORAGE_KEY]: entries.slice(0, MAX_ENTRIES) }),
  );
  writeQueue = operation.catch(() => undefined);
  return operation;
}

export async function getCachedTopicAnalytics(
  topic: string,
  isFavorite: boolean,
  now = Date.now(),
): Promise<TopicAnalytics | null> {
  const entry = (await readEntries()).find((item) => item.key === topicKey(topic));
  if (!entry) return null;

  const ttl = (isFavorite ? 7 : 30) * DAY_MS;
  if (now - entry.savedAt > ttl) return null;

  return { ...entry.analytics, cached: true };
}

export async function getLatestStoredTopicAnalytics(topic: string): Promise<TopicAnalytics | null> {
  const entry = (await readEntries()).find((item) => item.key === topicKey(topic));
  return entry?.analytics ?? null;
}

export async function cacheTopicAnalytics(
  topic: string,
  analytics: TopicAnalytics,
): Promise<void> {
  const key = topicKey(topic);
  const entries = (await readEntries()).filter((entry) => entry.key !== key);
  entries.unshift({ key, topic: topic.trim(), savedAt: Date.now(), analytics });
  await writeEntries(entries);
}
