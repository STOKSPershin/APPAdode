/**
 * TopicHunter — Background Service Worker (Manifest V3)
 *
 * Click behavior:
 * - On stock.adobe.com → TOGGLE_PANEL content script panel
 * - On any other site → Open/focus dashboard tab
 */

import {
  deleteScanSession,
  findScanSession,
  getActivityPool,
  getAllTopicHistory,
  getHistoryStats,
  getLatestTopicAnalytics,
  getScanSession,
  getTopicHistory,
  saveScanSession,
} from "./history-db";
import {
  addMainTopics,
  claimNextMainTopic,
  clearFinishedMainTopicQueueItems,
  configureMainTopicQueue,
  failMainTopicQueueItem,
  finishMainTopicQueueItem,
  getMainTopicQueue,
  pauseMainTopicQueue,
  removeMainTopicQueueItem,
  renewMainTopicLease,
  retryMainTopicQueueItem,
  startMainTopicQueue,
  stopMainTopicQueueNow,
} from "./scan-queue";
import type { MainTopicQueueState, ScanPayload } from "@shared/types";

const DASHBOARD_PATH = "src/pages/dashboard/index.html";
const QUEUE_ALARM = "topic-hunter-main-topic-queue";

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);
  const existing = await chrome.tabs.query({ url: dashboardUrl });

  if (existing.length > 0 && existing[0].id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    await chrome.tabs.reload(existing[0].id);
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

// ── Icon click handler ─────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  const url = tab.url || "";

  // On Adobe Stock → toggle the content script panel
  if (url.includes("stock.adobe.com") && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    return;
  }

  // On any other site → open dashboard
  await openDashboard();
});

// ── Message router ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "PING":
      sendResponse({ status: "PONG", version: chrome.runtime.getManifest().version });
      return true;

    case "OPEN_DASHBOARD":
      openDashboard()
        .then(() => sendResponse({ status: "OK" }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "SAVE_SCAN_HISTORY":
      saveScanSession(message.payload as ScanPayload)
        .then((sessionId) => sendResponse({ data: sessionId }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_SCAN_SESSION":
      getScanSession(String(message.sessionId ?? ""))
        .then((payload) => sendResponse({ data: payload }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "DELETE_SCAN_SESSION":
      deleteScanSession(String(message.sessionId ?? ""))
        .then((deleted) => sendResponse({ data: deleted }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "FIND_SCAN_SESSION":
      findScanSession(
        String(message.mainTopic ?? ""),
        typeof message.nearTimestamp === "number" ? message.nearTimestamp : undefined,
      )
        .then((payload) => sendResponse({ data: payload }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_LATEST_TOPIC_ANALYTICS":
      getLatestTopicAnalytics(
        String(message.topic ?? ""),
        typeof message.beforeCheckedAt === "string" ? message.beforeCheckedAt : undefined,
      )
        .then((analytics) => sendResponse({ data: analytics }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_TOPIC_HISTORY":
      getTopicHistory(String(message.topic ?? ""), Number(message.limit ?? 20))
        .then((records) => sendResponse({ data: records }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_HISTORY_STATS":
      getHistoryStats()
        .then((stats) => sendResponse({ data: stats }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_ACTIVITY_POOL":
      getActivityPool()
        .then((pool) => sendResponse({ data: pool }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_ALL_TOPIC_HISTORY":
      getAllTopicHistory()
        .then((records) => sendResponse({ data: records }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "SUSPEND_FOR_BACKUP_IMPORT":
      suspendForBackupImport()
        .then(() => sendResponse({ data: true }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "REFRESH_MAIN_TOPIC_QUEUE_SCHEDULE":
      getMainTopicQueue()
        .then(async (state) => {
          await scheduleQueueWakeup(state);
          sendResponse({ data: state });
        })
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "GET_MAIN_TOPIC_QUEUE":
      getMainTopicQueue()
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "ADD_MAIN_TOPICS":
      addMainTopics(Array.isArray(message.topics) ? message.topics.map(String) : [])
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "CONFIGURE_MAIN_TOPIC_QUEUE":
      configureMainTopicQueue(Number(message.delayMinMinutes), Number(message.delayMaxMinutes))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "START_MAIN_TOPIC_QUEUE":
      updateQueueAndSchedule(
        startMainTopicQueue(typeof message.scheduledAt === "string" ? message.scheduledAt : undefined),
        true,
      )
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "PAUSE_MAIN_TOPIC_QUEUE":
      updateQueueAndSchedule(pauseMainTopicQueue())
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "STOP_MAIN_TOPIC_QUEUE_NOW":
      stopQueueAndActiveScans()
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "REMOVE_MAIN_TOPIC_QUEUE_ITEM":
      removeMainTopicQueueItem(String(message.itemId ?? ""))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "RETRY_MAIN_TOPIC_QUEUE_ITEM":
      retryMainTopicQueueItem(String(message.itemId ?? ""))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "CLEAR_FINISHED_MAIN_TOPIC_QUEUE_ITEMS":
      clearFinishedMainTopicQueueItems()
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "CLAIM_NEXT_MAIN_TOPIC":
      claimNextMainTopic(String(message.runnerId ?? ""))
        .then((claim) => sendResponse({ data: claim }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "RENEW_MAIN_TOPIC_LEASE":
      renewMainTopicLease(String(message.itemId ?? ""), String(message.runnerId ?? ""))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "FINISH_MAIN_TOPIC_QUEUE_ITEM":
      updateQueueAndSchedule(finishMainTopicQueueItem(
        String(message.itemId ?? ""),
        String(message.runnerId ?? ""),
        String(message.historySessionId ?? ""),
        typeof message.blockedReason === "string" ? message.blockedReason : undefined,
      ))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    case "FAIL_MAIN_TOPIC_QUEUE_ITEM":
      updateQueueAndSchedule(failMainTopicQueueItem(
        String(message.itemId ?? ""),
        String(message.runnerId ?? ""),
        String(message.error ?? "Неизвестная ошибка"),
      ))
        .then((state) => sendResponse({ data: state }))
        .catch((error: unknown) => sendResponse({ error: errorMessage(error) }));
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
      return false;
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== QUEUE_ALARM) return;
  void wakeQueueRunner();
});

chrome.runtime.onStartup.addListener(() => {
  void getMainTopicQueue().then(scheduleQueueWakeup);
});

chrome.runtime.onInstalled.addListener(() => {
  void getMainTopicQueue().then(scheduleQueueWakeup);
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wakeQueueRunner(): Promise<void> {
  const tabs = await chrome.tabs.query({ url: "https://stock.adobe.com/*" });
  const target = tabs.find((tab) => typeof tab.id === "number");

  if (!target?.id) {
    await chrome.tabs.create({ url: "https://stock.adobe.com/" });
    return;
  }

  try {
    await chrome.tabs.sendMessage(target.id, { type: "RUN_SCAN_QUEUE" });
  } catch {
    // Tabs opened before an extension reload have no current content script.
    await chrome.tabs.reload(target.id);
  }
}

async function stopQueueAndActiveScans(): Promise<MainTopicQueueState> {
  const state = await updateQueueAndSchedule(stopMainTopicQueueNow());
  const tabs = await chrome.tabs.query({ url: "https://stock.adobe.com/*" });
  await Promise.allSettled(tabs.map((tab) => (
    typeof tab.id === "number"
      ? chrome.tabs.sendMessage(tab.id, { type: "STOP_ACTIVE_SCAN" })
      : Promise.resolve()
  )));
  return state;
}

async function suspendForBackupImport(): Promise<void> {
  await chrome.alarms.clear(QUEUE_ALARM);
  const tabs = await chrome.tabs.query({ url: "https://stock.adobe.com/*" });
  await Promise.allSettled(tabs.map((tab) => (
    typeof tab.id === "number"
      ? chrome.tabs.sendMessage(tab.id, { type: "STOP_ACTIVE_SCAN" })
      : Promise.resolve()
  )));
}

async function scheduleQueueWakeup(state: MainTopicQueueState): Promise<void> {
  await chrome.alarms.clear(QUEUE_ALARM);
  if (state.status !== "running") return;

  const requested = state.nextRunAt ? Date.parse(state.nextRunAt) : Date.now();
  const when = Number.isFinite(requested) ? Math.max(Date.now() + 500, requested) : Date.now() + 500;
  chrome.alarms.create(QUEUE_ALARM, { when });
}

async function updateQueueAndSchedule(
  operation: Promise<MainTopicQueueState>,
  wakeImmediately = false,
): Promise<MainTopicQueueState> {
  const state = await operation;
  await scheduleQueueWakeup(state);
  if (wakeImmediately && state.status === "running") await wakeQueueRunner();
  return state;
}

export {};
