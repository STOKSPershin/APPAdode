/**
 * Shared TypeScript types for the TopicHunter extension
 */

// ── AI Provider / Model ────────────────────────────────────────────

export type AIProvider = "openai";

export interface AIModelOption {
  id: string;          // e.g. "gpt-5.4-mini"
  label: string;       // e.g. "GPT-5.4 Mini"
}

/** Available models for the extension */
export const AVAILABLE_MODELS: AIModelOption[] = [
  { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { id: "gpt-5.1-mini", label: "GPT-5.1 Mini" },
];

// ── Adobe Stock Filters ────────────────────────────────────────────

export type ContentFilter = "photo" | "vector" | "illustration" | "video";

export interface FilterOption {
  id: ContentFilter;
  label: string;
}

export const CONTENT_FILTERS: FilterOption[] = [
  { id: "photo", label: "Фото" },
  { id: "vector", label: "Векторы" },
  { id: "illustration", label: "Иллюстрации" },
  { id: "video", label: "Видео" },
];

// ── Topic Generation ───────────────────────────────────────────────

export interface TopicRequest {
  prompt: string;
  model: string;
  filters: ContentFilter[];
  minResults: number;
  maxResults: number;
  userTopic?: string;
  userApiKey: string;
}

export interface TopicResult {
  topic: string;
  demand: number | null;
  status: "ok" | "error" | "waf_blocked" | "pending";
}

export interface TopicResponse {
  userTopicResult?: TopicResult;
  results: TopicResult[];
  warning?: string;
  creditsUsed: number;
}

// ── Saved Items ────────────────────────────────────────────────────

export interface SavedItem {
  id: string;
  mainTopic?: string;
  subtopic: string;
  demand: number | null;
  createdAt: string;
}

// ── Extension Settings (chrome.storage) ────────────────────────────

export interface ExtensionSettings {
  defaultModel: string;
  defaultFilters: ContentFilter[];
  defaultMinResults: number;
  defaultMaxResults: number;
}

// ── Auth / License ─────────────────────────────────────────────────

export interface AuthState {
  isAuthenticated: boolean;
  licenseKey: string;
}

// ── Message Types (chrome.runtime messaging) ───────────────────────

export type ExtensionMessage =
  | { type: "PING" }
  | { type: "OPEN_DASHBOARD" }
  | { type: "GET_SETTINGS" }
  | { type: "SAVE_SETTINGS"; payload: ExtensionSettings };

export type ExtensionResponse =
  | { status: "PONG"; version: string }
  | { status: "OK" }
  | { error: string };
