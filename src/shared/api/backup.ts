import {
  exportHistoryDatabase,
  replaceHistoryDatabase,
} from "../../background/history-db";
import type {
  HistoryDatabaseBackup,
  HistoryImportStats,
} from "../../background/history-db";
import type { MainTopicQueueState } from "@shared/types";

const BACKUP_FORMAT = "topichunter-full-backup";
const BACKUP_VERSION = 1;
const MAX_BACKUP_FILE_SIZE = 256 * 1024 * 1024;
const QUEUE_STORAGE_KEY = "topicHunter_mainTopicQueue_v1";
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const SENSITIVE_KEY_PATTERN = /(?:api[_-]?key|secret|password|authorization|access[_-]?token|refresh[_-]?token)/i;

interface BackupPayload {
  chromeStorage: Record<string, unknown>;
  dashboardLocalStorage: Record<string, string>;
  history: HistoryDatabaseBackup;
}

export interface FullBackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  extensionVersion: string;
  excludedSecretKeys: string[];
  payload: BackupPayload;
  checksumSha256: string;
}

export interface BackupPreview {
  createdAt: string;
  extensionVersion: string;
  sessions: number;
  topicSnapshots: number;
  storageKeys: number;
  localStorageKeys: number;
  queueItems: number;
  ignoredSecretKeys: string[];
}

export interface BackupImportResult extends HistoryImportStats {
  storageKeys: number;
  localStorageKeys: number;
  queueItems: number;
}

interface RuntimeResponse<T> {
  data?: T;
  error?: string;
}

export { MAX_BACKUP_FILE_SIZE };

export async function createFullBackup(): Promise<FullBackupFile> {
  const [storageData, history] = await Promise.all([
    chrome.storage.local.get(null),
    exportHistoryDatabase(),
  ]);
  const excludedSecretKeys: string[] = [];
  const chromeStorage = withoutSensitiveValues(storageData, excludedSecretKeys);
  const dashboardLocalStorage = withoutSensitiveStringValues(
    readDashboardLocalStorage(),
    excludedSecretKeys,
  );
  const payload: BackupPayload = { chromeStorage, dashboardLocalStorage, history };

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    excludedSecretKeys: [...new Set(excludedSecretKeys)].sort(),
    payload,
    checksumSha256: await checksumPayload(payload),
  };
}

export async function downloadFullBackup(): Promise<BackupPreview> {
  const backup = await createFullBackup();
  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName(backup.createdAt);
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  return previewBackup(backup);
}

export async function parseBackupFile(file: File): Promise<FullBackupFile> {
  if (!file.name.toLocaleLowerCase().endsWith(".json")) {
    throw new Error("Выберите JSON-файл резервной копии TopicHunter");
  }
  if (file.size <= 0 || file.size > MAX_BACKUP_FILE_SIZE) {
    throw new Error(`Размер файла должен быть от 1 байта до ${formatMegabytes(MAX_BACKUP_FILE_SIZE)} МБ`);
  }

  let value: unknown;
  try {
    value = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("Файл не является корректным JSON");
  }
  return validateBackup(value);
}

export function previewBackup(backup: FullBackupFile): BackupPreview {
  const queue = backup.payload.chromeStorage[QUEUE_STORAGE_KEY];
  return {
    createdAt: backup.createdAt,
    extensionVersion: backup.extensionVersion,
    sessions: backup.payload.history.sessions.length,
    topicSnapshots: backup.payload.history.topics.length,
    storageKeys: Object.keys(backup.payload.chromeStorage).length,
    localStorageKeys: Object.keys(backup.payload.dashboardLocalStorage).length,
    queueItems: isRecord(queue) && Array.isArray(queue.items) ? queue.items.length : 0,
    ignoredSecretKeys: findSensitiveKeys(backup),
  };
}

export async function importFullBackup(backup: FullBackupFile): Promise<BackupImportResult> {
  const validated = await validateBackup(backup);
  const [currentChromeStorage, currentHistory] = await Promise.all([
    chrome.storage.local.get(null),
    exportHistoryDatabase(),
  ]);
  const currentLocalStorage = readDashboardLocalStorage();
  const importedChromeStorage = prepareImportedChromeStorage(
    validated.payload.chromeStorage,
    currentChromeStorage,
  );
  const importedLocalStorage = prepareImportedLocalStorage(
    validated.payload.dashboardLocalStorage,
    currentLocalStorage,
  );

  await sendRuntimeMessage<boolean>({ type: "SUSPEND_FOR_BACKUP_IMPORT" });

  try {
    const historyStats = await replaceHistoryDatabase(validated.payload.history);
    await replaceChromeStorage(importedChromeStorage);
    replaceDashboardLocalStorage(importedLocalStorage);
    await sendRuntimeMessage<MainTopicQueueState>({ type: "REFRESH_MAIN_TOPIC_QUEUE_SCHEDULE" });

    const queue = importedChromeStorage[QUEUE_STORAGE_KEY];
    return {
      ...historyStats,
      storageKeys: Object.keys(importedChromeStorage).length,
      localStorageKeys: Object.keys(importedLocalStorage).length,
      queueItems: isRecord(queue) && Array.isArray(queue.items) ? queue.items.length : 0,
    };
  } catch {
    const rollback = await Promise.allSettled([
      replaceHistoryDatabase(currentHistory),
      replaceChromeStorage(currentChromeStorage),
      Promise.resolve().then(() => replaceDashboardLocalStorage(currentLocalStorage)),
    ]);
    await sendRuntimeMessage<MainTopicQueueState>({ type: "REFRESH_MAIN_TOPIC_QUEUE_SCHEDULE" })
      .catch(() => undefined);
    const rollbackFailed = rollback.some((result) => result.status === "rejected");
    throw new Error(
      rollbackFailed
        ? "Импорт прерван, автоматическое восстановление завершилось не полностью"
        : "Импорт прерван, исходная локальная база восстановлена",
    );
  }
}

async function validateBackup(value: unknown): Promise<FullBackupFile> {
  assertNoDangerousKeys(value);
  if (!isRecord(value) || value.format !== BACKUP_FORMAT || value.version !== BACKUP_VERSION) {
    throw new Error("Это не поддерживаемая полная резервная копия TopicHunter");
  }
  if (
    typeof value.createdAt !== "string"
    || !Number.isFinite(Date.parse(value.createdAt))
    || typeof value.extensionVersion !== "string"
    || !Array.isArray(value.excludedSecretKeys)
    || !value.excludedSecretKeys.every((key) => typeof key === "string")
    || typeof value.checksumSha256 !== "string"
    || !/^[a-f0-9]{64}$/i.test(value.checksumSha256)
    || !isRecord(value.payload)
  ) {
    throw new Error("Повреждён заголовок резервной копии");
  }

  const payload = value.payload;
  if (
    !isRecord(payload.chromeStorage)
    || !isStringRecord(payload.dashboardLocalStorage)
    || !isRecord(payload.history)
    || payload.history.version !== 1
    || !Array.isArray(payload.history.sessions)
    || !Array.isArray(payload.history.topics)
  ) {
    throw new Error("В резервной копии отсутствуют обязательные разделы базы");
  }

  const actualChecksum = await checksumPayload(payload as unknown as BackupPayload);
  if (actualChecksum !== value.checksumSha256.toLocaleLowerCase()) {
    throw new Error("Контрольная сумма не совпала: файл повреждён или был изменён");
  }
  return value as unknown as FullBackupFile;
}

function prepareImportedChromeStorage(
  imported: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const prepared = withoutSensitiveValues(imported);
  for (const [key, value] of Object.entries(current)) {
    if (isSensitiveKey(key)) prepared[key] = value;
  }
  if (QUEUE_STORAGE_KEY in prepared) {
    prepared[QUEUE_STORAGE_KEY] = pauseImportedQueue(prepared[QUEUE_STORAGE_KEY]);
  }
  return prepared;
}

function prepareImportedLocalStorage(
  imported: Record<string, string>,
  current: Record<string, string>,
): Record<string, string> {
  const prepared = withoutSensitiveStringValues(imported);
  for (const [key, value] of Object.entries(current)) {
    if (isSensitiveKey(key)) prepared[key] = value;
  }
  return prepared;
}

function pauseImportedQueue(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.items)) return value;
  const items = value.items.map((item): unknown => {
    if (!isRecord(item)) return item;
    if (item.status !== "running") {
      return { ...item, claimedBy: null, leaseUntil: null };
    }
    return {
      ...item,
      status: "pending",
      startedAt: null,
      finishedAt: null,
      error: null,
      historySessionId: null,
      claimedBy: null,
      leaseUntil: null,
    };
  });
  return {
    ...value,
    version: 1,
    status: items.length > 0 ? "paused" : "idle",
    items,
    activeItemId: null,
    scheduledAt: null,
    nextRunAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
  };
}

function readDashboardLocalStorage(): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === null) continue;
    const value = localStorage.getItem(key);
    if (value !== null) values[key] = value;
  }
  return values;
}

function replaceDashboardLocalStorage(values: Record<string, string>): void {
  localStorage.clear();
  for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
}

async function replaceChromeStorage(values: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.clear();
  if (Object.keys(values).length > 0) await chrome.storage.local.set(values);
}

function withoutSensitiveValues(
  values: Record<string, unknown>,
  excludedKeys: string[] = [],
): Record<string, unknown> {
  return scrubSensitiveRecord(values, "", excludedKeys);
}

function scrubSensitiveRecord(
  values: Record<string, unknown>,
  path: string,
  excludedKeys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isSensitiveKey(key)) {
      excludedKeys.push(childPath);
      continue;
    }
    if (Array.isArray(value)) {
      result[key] = value.map((item, index) => scrubSensitiveValue(
        item,
        `${childPath}[${index}]`,
        excludedKeys,
      ));
      continue;
    }
    result[key] = isRecord(value)
      ? scrubSensitiveRecord(value, childPath, excludedKeys)
      : value;
  }
  return result;
}

function scrubSensitiveValue(value: unknown, path: string, excludedKeys: string[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item, index) => scrubSensitiveValue(item, `${path}[${index}]`, excludedKeys));
  }
  return isRecord(value) ? scrubSensitiveRecord(value, path, excludedKeys) : value;
}

function withoutSensitiveStringValues(
  values: Record<string, string>,
  excludedKeys: string[] = [],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (isSensitiveKey(key)) {
      excludedKeys.push(`localStorage:${key}`);
      continue;
    }
    result[key] = value;
  }
  return result;
}

function findSensitiveKeys(backup: FullBackupFile): string[] {
  const keys = [
    ...backup.excludedSecretKeys,
    ...Object.keys(backup.payload.chromeStorage).filter(isSensitiveKey),
    ...Object.keys(backup.payload.dashboardLocalStorage)
      .filter(isSensitiveKey)
      .map((key) => `localStorage:${key}`),
  ];
  return [...new Set(keys)].sort();
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoDangerousKeys(value: unknown): void {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === null || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const child of current) pending.push(child);
      continue;
    }
    for (const [key, child] of Object.entries(current)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error("Файл содержит недопустимую структуру данных");
      pending.push(child);
    }
  }
}

async function checksumPayload(payload: BackupPayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function sendRuntimeMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: RuntimeResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response || response.error) {
        reject(new Error(response?.error ?? "Фоновый процесс резервной копии не ответил"));
        return;
      }
      resolve(response.data as T);
    });
  });
}

function backupFileName(createdAt: string): string {
  const stamp = createdAt.replace(/[:.]/g, "-");
  return `topichunter-full-backup-${stamp}.json`;
}

function formatMegabytes(bytes: number): string {
  return Math.round(bytes / 1024 / 1024).toLocaleString("ru-RU");
}
