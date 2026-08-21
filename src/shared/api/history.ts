import type {
  ActivityPoolEntry,
  ScanPayload,
  TopicAnalytics,
  TopicHistoryEntry,
} from "@shared/types";

interface HistoryResponse<T> {
  data?: T;
  error?: string;
}

function sendHistoryMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: HistoryResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response || response.error) {
        reject(new Error(response?.error ?? "Фоновый процесс истории не ответил"));
        return;
      }
      resolve(response.data as T);
    });
  });
}

export function saveScanHistory(payload: ScanPayload): Promise<string> {
  return sendHistoryMessage<string>({ type: "SAVE_SCAN_HISTORY", payload });
}

export function getScanSession(sessionId: string): Promise<ScanPayload | null> {
  return sendHistoryMessage<ScanPayload | null>({ type: "GET_SCAN_SESSION", sessionId });
}

export function deleteScanSession(sessionId: string): Promise<boolean> {
  return sendHistoryMessage<boolean>({ type: "DELETE_SCAN_SESSION", sessionId });
}

export function findScanSession(
  mainTopic: string,
  nearTimestamp?: number,
): Promise<ScanPayload | null> {
  return sendHistoryMessage<ScanPayload | null>({
    type: "FIND_SCAN_SESSION",
    mainTopic,
    nearTimestamp,
  });
}

export function getLatestHistoricAnalytics(
  topic: string,
  beforeCheckedAt?: string,
): Promise<TopicAnalytics | null> {
  return sendHistoryMessage<TopicAnalytics | null>({
    type: "GET_LATEST_TOPIC_ANALYTICS",
    topic,
    beforeCheckedAt,
  });
}

export function getHistoryStats(): Promise<{ sessions: number; topics: number }> {
  return sendHistoryMessage<{ sessions: number; topics: number }>({ type: "GET_HISTORY_STATS" });
}

export function getTopicHistory(topic: string, limit = 100): Promise<TopicHistoryEntry[]> {
  return sendHistoryMessage<TopicHistoryEntry[]>({
    type: "GET_TOPIC_HISTORY",
    topic,
    limit,
  });
}

export function getActivityPool(): Promise<ActivityPoolEntry[]> {
  return sendHistoryMessage<ActivityPoolEntry[]>({ type: "GET_ACTIVITY_POOL" });
}

export function getAllTopicHistory(): Promise<TopicHistoryEntry[]> {
  return sendHistoryMessage<TopicHistoryEntry[]>({ type: "GET_ALL_TOPIC_HISTORY" });
}
