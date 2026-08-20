import type {
  MainTopicQueueClaim,
  MainTopicQueueItem,
  MainTopicQueueState,
} from "@shared/types";

export const MAIN_TOPIC_QUEUE_STORAGE_KEY = "topicHunter_mainTopicQueue_v1";

const LEASE_MS = 5 * 60 * 1000;
const MIN_DELAY_MINUTES = 1;
const MAX_DELAY_MINUTES = 24 * 60;

let queueOperation: Promise<unknown> = Promise.resolve();

function nowIso(): string {
  return new Date().toISOString();
}

function clampDelay(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(MAX_DELAY_MINUTES, Math.max(MIN_DELAY_MINUTES, Math.round(value)));
}

function emptyQueue(): MainTopicQueueState {
  return {
    version: 1,
    status: "idle",
    items: [],
    activeItemId: null,
    scheduledAt: null,
    nextRunAt: null,
    delayMinMinutes: 10,
    delayMaxMinutes: 20,
    lastError: null,
    updatedAt: nowIso(),
  };
}

function normalizedTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ");
}

function normalizeQueue(value: unknown): MainTopicQueueState {
  if (!value || typeof value !== "object") return emptyQueue();
  const candidate = value as Partial<MainTopicQueueState>;
  const base = emptyQueue();
  const items = Array.isArray(candidate.items)
    ? candidate.items.filter((item): item is MainTopicQueueItem => (
      Boolean(item)
      && typeof item.id === "string"
      && typeof item.topic === "string"
    ))
    : [];
  const delayMinMinutes = clampDelay(Number(candidate.delayMinMinutes), base.delayMinMinutes);
  const delayMaxMinutes = Math.max(
    delayMinMinutes,
    clampDelay(Number(candidate.delayMaxMinutes), base.delayMaxMinutes),
  );

  return {
    ...base,
    ...candidate,
    version: 1,
    items,
    delayMinMinutes,
    delayMaxMinutes,
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : base.updatedAt,
  };
}

async function readQueue(): Promise<MainTopicQueueState> {
  const data = await chrome.storage.local.get(MAIN_TOPIC_QUEUE_STORAGE_KEY);
  return normalizeQueue(data[MAIN_TOPIC_QUEUE_STORAGE_KEY]);
}

async function writeQueue(state: MainTopicQueueState): Promise<MainTopicQueueState> {
  const next = { ...state, updatedAt: nowIso() };
  await chrome.storage.local.set({ [MAIN_TOPIC_QUEUE_STORAGE_KEY]: next });
  return next;
}

function withQueueLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = queueOperation.then(operation, operation);
  queueOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function hasPendingItems(state: MainTopicQueueState): boolean {
  return state.items.some((item) => item.status === "pending");
}

function randomDelayMs(state: MainTopicQueueState): number {
  const min = state.delayMinMinutes * 60_000;
  const max = state.delayMaxMinutes * 60_000;
  return Math.round(Math.random() * (max - min) + min);
}

export function getMainTopicQueue(): Promise<MainTopicQueueState> {
  return withQueueLock(readQueue);
}

export function addMainTopics(topics: string[]): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const activeKeys = new Set(
      state.items
        .filter((item) => item.status === "pending" || item.status === "running")
        .map((item) => normalizedTopic(item.topic).toLocaleLowerCase()),
    );
    const newKeys = new Set<string>();
    const additions = topics
      .map(normalizedTopic)
      .filter(Boolean)
      .filter((topic) => {
        const key = topic.toLocaleLowerCase();
        if (activeKeys.has(key) || newKeys.has(key)) return false;
        newKeys.add(key);
        return true;
      })
      .map<MainTopicQueueItem>((topic) => ({
        id: crypto.randomUUID(),
        topic,
        status: "pending",
        addedAt: nowIso(),
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        error: null,
        historySessionId: null,
        claimedBy: null,
        leaseUntil: null,
      }));

    const status = state.status === "completed" && additions.length > 0 ? "idle" : state.status;
    return writeQueue({ ...state, status, items: [...state.items, ...additions] });
  });
}

export function configureMainTopicQueue(
  delayMinMinutes: number,
  delayMaxMinutes: number,
): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const min = clampDelay(delayMinMinutes, state.delayMinMinutes);
    const max = Math.max(min, clampDelay(delayMaxMinutes, state.delayMaxMinutes));
    return writeQueue({ ...state, delayMinMinutes: min, delayMaxMinutes: max });
  });
}

export function startMainTopicQueue(scheduledAt?: string): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const scheduleTime = scheduledAt ? Date.parse(scheduledAt) : Date.now();
    const safeScheduleTime = Number.isFinite(scheduleTime) ? Math.max(Date.now(), scheduleTime) : Date.now();
    const nextRunAt = new Date(safeScheduleTime).toISOString();
    const nextStatus = hasPendingItems(state) ? "running" : "completed";
    return writeQueue({
      ...state,
      status: nextStatus,
      scheduledAt: nextRunAt,
      nextRunAt: nextStatus === "running" ? nextRunAt : null,
      lastError: null,
    });
  });
}

export function pauseMainTopicQueue(): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    return writeQueue({ ...state, status: "paused", nextRunAt: null });
  });
}

export function removeMainTopicQueueItem(itemId: string): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const item = state.items.find((candidate) => candidate.id === itemId);
    if (item?.status === "running") return state;
    return writeQueue({ ...state, items: state.items.filter((candidate) => candidate.id !== itemId) });
  });
}

export function clearFinishedMainTopicQueueItems(): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const items = state.items.filter((item) => item.status !== "completed");
    const status = items.length === 0 || state.status === "completed" ? "idle" : state.status;
    return writeQueue({ ...state, items, status, lastError: null });
  });
}

export function retryMainTopicQueueItem(itemId: string): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const items = state.items.map((item) => item.id === itemId
      ? {
          ...item,
          status: "pending" as const,
          startedAt: null,
          finishedAt: null,
          error: null,
          claimedBy: null,
          leaseUntil: null,
        }
      : item);
    return writeQueue({
      ...state,
      items,
      status: state.status === "running" ? "running" : "paused",
      activeItemId: state.activeItemId === itemId ? null : state.activeItemId,
      lastError: null,
    });
  });
}

export function claimNextMainTopic(runnerId: string): Promise<MainTopicQueueClaim> {
  return withQueueLock(async () => {
    let state = await readQueue();
    if (state.status !== "running") return { state, item: null, waitUntil: null };

    const currentTime = Date.now();
    const waitUntil = state.nextRunAt ? Date.parse(state.nextRunAt) : currentTime;
    if (Number.isFinite(waitUntil) && waitUntil > currentTime) {
      return { state, item: null, waitUntil: state.nextRunAt };
    }

    const active = state.items.find((item) => item.id === state.activeItemId);
    if (active?.status === "running") {
      const leaseTime = active.leaseUntil ? Date.parse(active.leaseUntil) : 0;
      if (Number.isFinite(leaseTime) && leaseTime > currentTime) {
        return { state, item: null, waitUntil: active.leaseUntil };
      }
      state = {
        ...state,
        activeItemId: null,
        items: state.items.map((item) => item.id === active.id
          ? { ...item, status: "pending" as const, claimedBy: null, leaseUntil: null }
          : item),
      };
    }

    const pending = state.items.find((item) => item.status === "pending");
    if (!pending) {
      state = await writeQueue({ ...state, status: "completed", activeItemId: null, nextRunAt: null });
      return { state, item: null, waitUntil: null };
    }

    const startedAt = nowIso();
    const claimed: MainTopicQueueItem = {
      ...pending,
      status: "running",
      startedAt,
      finishedAt: null,
      attempts: pending.attempts + 1,
      error: null,
      claimedBy: runnerId,
      leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(),
    };
    state = await writeQueue({
      ...state,
      activeItemId: claimed.id,
      nextRunAt: null,
      items: state.items.map((item) => item.id === claimed.id ? claimed : item),
    });
    return { state, item: claimed, waitUntil: null };
  });
}

export function renewMainTopicLease(itemId: string, runnerId: string): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const items = state.items.map((item) => (
      item.id === itemId && item.status === "running" && item.claimedBy === runnerId
        ? { ...item, leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() }
        : item
    ));
    return writeQueue({ ...state, items });
  });
}

export function finishMainTopicQueueItem(
  itemId: string,
  runnerId: string,
  historySessionId: string,
  blockedReason?: string,
): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const current = state.items.find((item) => item.id === itemId);
    if (!current || current.claimedBy !== runnerId) return state;
    const blocked = Boolean(blockedReason);
    const items = state.items.map((item) => item.id === itemId
      ? {
          ...item,
          status: blocked ? "blocked" as const : "completed" as const,
          finishedAt: nowIso(),
          error: blockedReason ?? null,
          historySessionId,
          claimedBy: null,
          leaseUntil: null,
        }
      : item);
    const pendingRemain = items.some((item) => item.status === "pending");
    const nextRunAt = !blocked && state.status === "running" && pendingRemain
      ? new Date(Date.now() + randomDelayMs(state)).toISOString()
      : null;
    const status = blocked
      ? "blocked" as const
      : state.status === "paused"
        ? "paused" as const
        : pendingRemain
          ? "running" as const
          : "completed" as const;
    return writeQueue({
      ...state,
      items,
      status,
      activeItemId: null,
      nextRunAt,
      lastError: blockedReason ?? null,
    });
  });
}

export function failMainTopicQueueItem(
  itemId: string,
  runnerId: string,
  error: string,
): Promise<MainTopicQueueState> {
  return withQueueLock(async () => {
    const state = await readQueue();
    const items = state.items.map((item) => (
      item.id === itemId && item.claimedBy === runnerId
        ? {
            ...item,
            status: "failed" as const,
            finishedAt: nowIso(),
            error,
            claimedBy: null,
            leaseUntil: null,
          }
        : item
    ));
    return writeQueue({
      ...state,
      items,
      status: "paused",
      activeItemId: null,
      nextRunAt: null,
      lastError: error,
    });
  });
}
