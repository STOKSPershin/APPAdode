import type { MainTopicQueueClaim, MainTopicQueueState } from "@shared/types";

interface QueueResponse<T> {
  data?: T;
  error?: string;
}

function sendQueueMessage<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: QueueResponse<T> | undefined) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      if (!response || response.error) {
        reject(new Error(response?.error ?? "Фоновый процесс очереди не ответил"));
        return;
      }
      resolve(response.data as T);
    });
  });
}

export function getMainTopicQueue(): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "GET_MAIN_TOPIC_QUEUE" });
}

export function addMainTopics(topics: string[]): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "ADD_MAIN_TOPICS", topics });
}

export function configureMainTopicQueue(
  delayMinMinutes: number,
  delayMaxMinutes: number,
): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({
    type: "CONFIGURE_MAIN_TOPIC_QUEUE",
    delayMinMinutes,
    delayMaxMinutes,
  });
}

export function startMainTopicQueue(scheduledAt?: string): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "START_MAIN_TOPIC_QUEUE", scheduledAt });
}

export function pauseMainTopicQueue(): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "PAUSE_MAIN_TOPIC_QUEUE" });
}

export function removeMainTopicQueueItem(itemId: string): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "REMOVE_MAIN_TOPIC_QUEUE_ITEM", itemId });
}

export function retryMainTopicQueueItem(itemId: string): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "RETRY_MAIN_TOPIC_QUEUE_ITEM", itemId });
}

export function clearFinishedMainTopicQueueItems(): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "CLEAR_FINISHED_MAIN_TOPIC_QUEUE_ITEMS" });
}

export function claimNextMainTopic(runnerId: string): Promise<MainTopicQueueClaim> {
  return sendQueueMessage<MainTopicQueueClaim>({ type: "CLAIM_NEXT_MAIN_TOPIC", runnerId });
}

export function renewMainTopicLease(itemId: string, runnerId: string): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({ type: "RENEW_MAIN_TOPIC_LEASE", itemId, runnerId });
}

export function finishMainTopicQueueItem(
  itemId: string,
  runnerId: string,
  historySessionId: string,
  blockedReason?: string,
): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({
    type: "FINISH_MAIN_TOPIC_QUEUE_ITEM",
    itemId,
    runnerId,
    historySessionId,
    blockedReason,
  });
}

export function failMainTopicQueueItem(
  itemId: string,
  runnerId: string,
  error: string,
): Promise<MainTopicQueueState> {
  return sendQueueMessage<MainTopicQueueState>({
    type: "FAIL_MAIN_TOPIC_QUEUE_ITEM",
    itemId,
    runnerId,
    error,
  });
}
