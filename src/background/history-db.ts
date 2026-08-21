import type {
  ActivityPoolEntry,
  ContentFilter,
  ScanPayload,
  TopicAnalytics,
  TopicHistoryEntry,
  TopicResult,
} from "@shared/types";

const DB_NAME = "topicHunterHistory";
const DB_VERSION = 2;
const SESSION_STORE = "scanSessions";
const TOPIC_STORE = "topicHistory";

export interface ScanSessionRecord {
  id: string;
  timestamp: number;
  mainTopic: string;
  model: string;
  filters: string[];
  minResults: number;
  maxResults: number;
  warning: string | null;
  topicCount: number;
}

export interface TopicHistoryRecord {
  id: string;
  sessionId: string;
  topicKey: string;
  topic: string;
  mainTopic?: string;
  checkedAt: string;
  isSource: boolean;
  position?: number;
  result: TopicResult;
}

export interface HistoryDatabaseBackup {
  version: 1;
  sessions: ScanSessionRecord[];
  topics: TopicHistoryRecord[];
}

export interface HistoryImportStats {
  sessions: number;
  topics: number;
}

const MAX_BACKUP_SESSIONS = 100_000;
const MAX_BACKUP_TOPICS = 2_000_000;

let databasePromise: Promise<IDBDatabase> | null = null;

function normalizeTopic(topic: string): string {
  return topic.trim().toLocaleLowerCase();
}

function toHistoryEntry(record: TopicHistoryRecord, fallbackMainTopic?: string): TopicHistoryEntry {
  return {
    id: record.id,
    sessionId: record.sessionId,
    topicKey: record.topicKey,
    topic: record.topic,
    mainTopic: record.mainTopic ?? fallbackMainTopic ?? (record.isSource ? record.topic : null),
    checkedAt: record.checkedAt,
    isSource: record.isSource,
    result: record.result,
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const sessions = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        sessions.createIndex("timestamp", "timestamp");
      }
      let topics: IDBObjectStore;
      if (!database.objectStoreNames.contains(TOPIC_STORE)) {
        topics = database.createObjectStore(TOPIC_STORE, { keyPath: "id" });
        topics.createIndex("topic_checkedAt", ["topicKey", "checkedAt"]);
        topics.createIndex("sessionId", "sessionId");
      } else {
        topics = request.transaction!.objectStore(TOPIC_STORE);
      }
      if (!topics.indexNames.contains("checkedAt")) {
        topics.createIndex("checkedAt", "checkedAt");
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("Не удалось открыть локальную историю"));
    };
  });

  return databasePromise;
}

export async function saveScanSession(payload: ScanPayload): Promise<string> {
  const database = await openDatabase();
  const sessionId = crypto.randomUUID();
  const transaction = database.transaction([SESSION_STORE, TOPIC_STORE], "readwrite");
  const sessionStore = transaction.objectStore(SESSION_STORE);
  const topicStore = transaction.objectStore(TOPIC_STORE);
  const allResults = [payload.userTopicResult, ...payload.results];

  const session: ScanSessionRecord = {
    id: sessionId,
    timestamp: payload.timestamp,
    mainTopic: payload.topic,
    model: payload.model,
    filters: payload.filters,
    minResults: payload.minResults,
    maxResults: payload.maxResults,
    warning: payload.warning,
    topicCount: allResults.length,
  };
  sessionStore.put(session);

  allResults.forEach((result, index) => {
    const checkedAt = result.analytics?.snapshot?.checkedAt
      ?? new Date(payload.timestamp).toISOString();
    const record: TopicHistoryRecord = {
      id: `${sessionId}:${index}`,
      sessionId,
      topicKey: normalizeTopic(result.topic),
      topic: result.topic,
      mainTopic: payload.topic,
      checkedAt,
      isSource: index === 0,
      position: index,
      result,
    };
    topicStore.put(record);
  });

  await transactionDone(transaction);
  return sessionId;
}

function recordPosition(record: TopicHistoryRecord): number {
  if (typeof record.position === "number") return record.position;
  const suffix = record.id.match(/:(\d+)$/)?.[1];
  return suffix === undefined ? Number.MAX_SAFE_INTEGER : Number(suffix);
}

function validFilters(filters: string[]): ContentFilter[] {
  return filters.filter((filter): filter is ContentFilter => (
    filter === "photo"
    || filter === "vector"
    || filter === "illustration"
    || filter === "video"
  ));
}

async function loadSessionRecords(
  database: IDBDatabase,
  sessionId: string,
): Promise<TopicHistoryRecord[]> {
  const transaction = database.transaction(TOPIC_STORE, "readonly");
  const index = transaction.objectStore(TOPIC_STORE).index("sessionId");
  const records = await requestResult(index.getAll(IDBKeyRange.only(sessionId))) as TopicHistoryRecord[];
  return records.sort((left, right) => recordPosition(left) - recordPosition(right));
}

export async function getScanSession(sessionId: string): Promise<ScanPayload | null> {
  if (!sessionId) return null;
  const database = await openDatabase();
  const session = await requestResult(
    database.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).get(sessionId),
  ) as ScanSessionRecord | undefined;
  if (!session) return null;

  const records = await loadSessionRecords(database, session.id);
  const source = records.find((record) => record.isSource) ?? records[0];
  if (!source) return null;

  return {
    userTopicResult: source.result,
    results: records.filter((record) => record.id !== source.id).map((record) => record.result),
    warning: session.warning,
    topic: session.mainTopic,
    timestamp: session.timestamp,
    model: session.model,
    filters: validFilters(session.filters),
    minResults: session.minResults,
    maxResults: session.maxResults,
    historySessionId: session.id,
  };
}

export async function deleteScanSession(sessionId: string): Promise<boolean> {
  if (!sessionId) return false;

  const database = await openDatabase();
  const transaction = database.transaction([SESSION_STORE, TOPIC_STORE], "readwrite");
  transaction.objectStore(SESSION_STORE).delete(sessionId);

  const sessionIndex = transaction.objectStore(TOPIC_STORE).index("sessionId");
  const cursorRequest = sessionIndex.openCursor(IDBKeyRange.only(sessionId));
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    cursor.delete();
    cursor.continue();
  };

  await transactionDone(transaction);
  return true;
}

export async function findScanSession(
  mainTopic: string,
  nearTimestamp?: number,
): Promise<ScanPayload | null> {
  const topicKey = normalizeTopic(mainTopic);
  if (!topicKey) return null;
  const database = await openDatabase();
  const sessions = await requestResult(
    database.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).getAll(),
  ) as ScanSessionRecord[];
  const matching = sessions.filter((session) => normalizeTopic(session.mainTopic) === topicKey);
  if (matching.length === 0) return null;

  const target = typeof nearTimestamp === "number" && Number.isFinite(nearTimestamp)
    ? nearTimestamp
    : Number.POSITIVE_INFINITY;
  matching.sort((left, right) => {
    const leftBefore = left.timestamp <= target;
    const rightBefore = right.timestamp <= target;
    if (leftBefore !== rightBefore) return leftBefore ? -1 : 1;
    if (Number.isFinite(target)) {
      const distance = Math.abs(left.timestamp - target) - Math.abs(right.timestamp - target);
      if (distance !== 0) return distance;
    }
    return right.timestamp - left.timestamp;
  });

  return getScanSession(matching[0].id);
}

export async function getLatestTopicAnalytics(
  topic: string,
  beforeCheckedAt?: string,
): Promise<TopicAnalytics | null> {
  const database = await openDatabase();
  const transaction = database.transaction(TOPIC_STORE, "readonly");
  const index = transaction.objectStore(TOPIC_STORE).index("topic_checkedAt");
  const topicKey = normalizeTopic(topic);
  const upperTime = beforeCheckedAt ?? "\uffff";
  const range = IDBKeyRange.bound([topicKey, ""], [topicKey, upperTime], false, true);

  return new Promise((resolve, reject) => {
    const request = index.openCursor(range, "prev");
    request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать историю темы"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const record = cursor.value as TopicHistoryRecord;
      if (record.result.analytics?.snapshot) {
        resolve(record.result.analytics);
        return;
      }
      cursor.continue();
    };
  });
}

export async function getTopicHistory(topic: string, limit = 20): Promise<TopicHistoryEntry[]> {
  const database = await openDatabase();
  const transaction = database.transaction(TOPIC_STORE, "readonly");
  const index = transaction.objectStore(TOPIC_STORE).index("topic_checkedAt");
  const topicKey = normalizeTopic(topic);
  const range = IDBKeyRange.bound([topicKey, ""], [topicKey, "\uffff"]);
  const records: TopicHistoryEntry[] = [];

  return new Promise((resolve, reject) => {
    const request = index.openCursor(range, "prev");
    request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать историю темы"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || records.length >= Math.max(1, Math.min(limit, 100))) {
        resolve(records);
        return;
      }
      const record = cursor.value as TopicHistoryRecord;
      records.push(toHistoryEntry(record));
      cursor.continue();
    };
  });
}

export async function getAllTopicHistory(): Promise<TopicHistoryEntry[]> {
  const database = await openDatabase();
  const sessions = await requestResult(
    database.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).getAll(),
  ) as ScanSessionRecord[];
  const mainTopicBySession = new Map(sessions.map((session) => [session.id, session.mainTopic]));
  const transaction = database.transaction(TOPIC_STORE, "readonly");
  const index = transaction.objectStore(TOPIC_STORE).index("checkedAt");
  const records: TopicHistoryEntry[] = [];

  return new Promise((resolve, reject) => {
    const request = index.openCursor(null, "prev");
    request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать базу тем"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      const record = cursor.value as TopicHistoryRecord;
      records.push(toHistoryEntry(record, mainTopicBySession.get(record.sessionId)));
      cursor.continue();
    };
  });
}

export async function getActivityPool(): Promise<ActivityPoolEntry[]> {
  const database = await openDatabase();
  const transaction = database.transaction(TOPIC_STORE, "readonly");
  const store = transaction.objectStore(TOPIC_STORE);
  const latestByTopic = new Map<string, { checkedAt: string; wilsonLower30: number }>();

  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onerror = () => reject(request.error ?? new Error("Не удалось прочитать пул активности"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve([...latestByTopic.entries()].map(([topicKey, value]) => ({
          topicKey,
          wilsonLower30: value.wilsonLower30,
        })));
        return;
      }

      const record = cursor.value as TopicHistoryRecord;
      const value = record.result.activity?.overall?.wilsonLower30;
      const existing = latestByTopic.get(record.topicKey);
      if (
        record.result.activity?.status === "ready"
        && typeof value === "number"
        && Number.isFinite(value)
        && (!existing || record.checkedAt > existing.checkedAt)
      ) {
        latestByTopic.set(record.topicKey, { checkedAt: record.checkedAt, wilsonLower30: value });
      }
      cursor.continue();
    };
  });
}

export async function getHistoryStats(): Promise<{ sessions: number; topics: number }> {
  const database = await openDatabase();
  const transaction = database.transaction([SESSION_STORE, TOPIC_STORE], "readonly");
  const sessionsRequest = transaction.objectStore(SESSION_STORE).count();
  const topicsRequest = transaction.objectStore(TOPIC_STORE).count();
  const [sessions, topics] = await Promise.all([
    requestResult(sessionsRequest),
    requestResult(topicsRequest),
  ]);
  return { sessions, topics };
}

export async function exportHistoryDatabase(): Promise<HistoryDatabaseBackup> {
  const database = await openDatabase();
  const transaction = database.transaction([SESSION_STORE, TOPIC_STORE], "readonly");
  const sessionsRequest = transaction.objectStore(SESSION_STORE).getAll();
  const topicsRequest = transaction.objectStore(TOPIC_STORE).getAll();
  const [sessions, topics] = await Promise.all([
    requestResult(sessionsRequest) as Promise<ScanSessionRecord[]>,
    requestResult(topicsRequest) as Promise<TopicHistoryRecord[]>,
  ]);
  await transactionDone(transaction);
  return validateHistoryBackup({ version: 1, sessions, topics });
}

export async function replaceHistoryDatabase(value: unknown): Promise<HistoryImportStats> {
  const backup = validateHistoryBackup(value);
  const database = await openDatabase();
  const transaction = database.transaction([SESSION_STORE, TOPIC_STORE], "readwrite");
  const sessionStore = transaction.objectStore(SESSION_STORE);
  const topicStore = transaction.objectStore(TOPIC_STORE);

  sessionStore.clear();
  topicStore.clear();
  backup.sessions.forEach((record) => sessionStore.put(record));
  backup.topics.forEach((record) => topicStore.put(record));

  await transactionDone(transaction);
  return { sessions: backup.sessions.length, topics: backup.topics.length };
}

function validateHistoryBackup(value: unknown): HistoryDatabaseBackup {
  if (!isRecord(value) || value.version !== 1) {
    throw new Error("Неподдерживаемая версия базы истории");
  }
  if (!Array.isArray(value.sessions) || !Array.isArray(value.topics)) {
    throw new Error("В резервной копии отсутствует база истории");
  }
  if (value.sessions.length > MAX_BACKUP_SESSIONS || value.topics.length > MAX_BACKUP_TOPICS) {
    throw new Error("Резервная копия превышает допустимый размер базы");
  }

  const sessionIds = new Set<string>();
  for (const record of value.sessions) {
    if (!isScanSessionRecord(record) || sessionIds.has(record.id)) {
      throw new Error("Повреждена таблица сохранённых сканов");
    }
    sessionIds.add(record.id);
  }

  const topicIds = new Set<string>();
  const topicCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const record of value.topics) {
    if (
      !isTopicHistoryRecord(record)
      || topicIds.has(record.id)
      || !sessionIds.has(record.sessionId)
    ) {
      throw new Error("Повреждена таблица истории тем");
    }
    topicIds.add(record.id);
    topicCounts.set(record.sessionId, (topicCounts.get(record.sessionId) ?? 0) + 1);
    if (record.isSource) {
      sourceCounts.set(record.sessionId, (sourceCounts.get(record.sessionId) ?? 0) + 1);
    }
  }

  for (const session of value.sessions) {
    if (
      topicCounts.get(session.id) !== session.topicCount
      || sourceCounts.get(session.id) !== 1
    ) {
      throw new Error("Нарушена целостность сохранённого скана");
    }
  }

  return value as unknown as HistoryDatabaseBackup;
}

function isScanSessionRecord(value: unknown): value is ScanSessionRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id)
    && typeof value.timestamp === "number"
    && Number.isFinite(value.timestamp)
    && isNonEmptyString(value.mainTopic)
    && typeof value.model === "string"
    && Array.isArray(value.filters)
    && value.filters.every((filter) => typeof filter === "string")
    && typeof value.minResults === "number"
    && Number.isFinite(value.minResults)
    && typeof value.maxResults === "number"
    && Number.isFinite(value.maxResults)
    && (value.warning === null || typeof value.warning === "string")
    && typeof value.topicCount === "number"
    && Number.isSafeInteger(value.topicCount)
    && value.topicCount >= 0
  );
}

function isTopicHistoryRecord(value: unknown): value is TopicHistoryRecord {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id)
    && isNonEmptyString(value.sessionId)
    && typeof value.topicKey === "string"
    && isNonEmptyString(value.topic)
    && (value.mainTopic === undefined || typeof value.mainTopic === "string")
    && isNonEmptyString(value.checkedAt)
    && Number.isFinite(Date.parse(value.checkedAt))
    && typeof value.isSource === "boolean"
    && (value.position === undefined || (typeof value.position === "number" && Number.isSafeInteger(value.position)))
    && isRecord(value.result)
    && typeof value.result.topic === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
