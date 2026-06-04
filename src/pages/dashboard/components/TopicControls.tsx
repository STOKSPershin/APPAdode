import { useState } from "react";
import { AVAILABLE_MODELS, CONTENT_FILTERS, type ContentFilter } from "@shared/types";

interface TopicControlsProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedFilters: ContentFilter[];
  onFiltersChange: (filters: ContentFilter[]) => void;
}

/**
 * TopicControls — Settings panel
 *
 * Contains:
 * - OpenAI API key input (password) with "Check" button
 * - Model selector dropdown
 * - Adobe Stock content type filter checkboxes
 */
export default function TopicControls({
  apiKey,
  onApiKeyChange,
  selectedModel,
  onModelChange,
  selectedFilters,
  onFiltersChange,
}: TopicControlsProps) {
  const [isKeyVisible, setIsKeyVisible] = useState(false);
  const [keyCheckStatus, setKeyCheckStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");

  const handleCheckKey = async () => {
    if (!apiKey.trim()) return;
    setKeyCheckStatus("checking");
    // Stub — simulate key validation
    await new Promise((r) => setTimeout(r, 800));
    setKeyCheckStatus(apiKey.startsWith("sk-") ? "valid" : "invalid");
    // Reset after 3 seconds
    setTimeout(() => setKeyCheckStatus("idle"), 3000);
  };

  const toggleFilter = (filter: ContentFilter) => {
    if (selectedFilters.includes(filter)) {
      // Don't allow deselecting the last filter
      if (selectedFilters.length === 1) return;
      onFiltersChange(selectedFilters.filter((f) => f !== filter));
    } else {
      onFiltersChange([...selectedFilters, filter]);
    }
  };

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-5 space-y-5 animate-fade-in">
      {/* ── OpenAI API Key ─────────────────────────── */}
      <div>
        <label
          htmlFor="openai-key"
          className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
        >
          <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
          </svg>
          OpenAI API ключ
        </label>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              id="openai-key"
              type={isKeyVisible ? "text" : "password"}
              value={apiKey}
              onChange={(e) => onApiKeyChange(e.target.value)}
              placeholder="sk-..."
              spellCheck={false}
              autoComplete="off"
              className="
                w-full px-4 py-2.5 pr-10 rounded-xl
                bg-bg-input border border-border text-text-primary text-sm
                placeholder:text-text-muted
                hover:border-border-hover focus:border-accent
                transition-all duration-200 focus-ring
              "
            />

            {/* Toggle visibility */}
            <button
              type="button"
              onClick={() => setIsKeyVisible(!isKeyVisible)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              title={isKeyVisible ? "Скрыть" : "Показать"}
            >
              {isKeyVisible ? (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12c1.292 4.338 5.31 7.5 10.066 7.5.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                </svg>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={handleCheckKey}
            disabled={!apiKey.trim() || keyCheckStatus === "checking"}
            className={`
              px-4 py-2.5 rounded-xl text-sm font-medium
              border transition-all duration-200 cursor-pointer
              whitespace-nowrap focus-ring
              ${
                keyCheckStatus === "valid"
                  ? "border-success/40 bg-success/10 text-success"
                  : keyCheckStatus === "invalid"
                    ? "border-error/40 bg-error/10 text-error"
                    : !apiKey.trim() || keyCheckStatus === "checking"
                      ? "border-border bg-bg-input text-text-muted cursor-not-allowed"
                      : "border-border bg-bg-input text-text-secondary hover:border-border-hover hover:text-text-primary"
              }
            `}
          >
            {keyCheckStatus === "checking" ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Проверка
              </span>
            ) : keyCheckStatus === "valid" ? (
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                </svg>
                Валидный
              </span>
            ) : keyCheckStatus === "invalid" ? (
              "Неверный"
            ) : (
              "Проверить"
            )}
          </button>
        </div>
      </div>

      {/* ── Model Selector + Filters Row ───────────── */}
      <div className="flex flex-wrap items-end gap-5">
        {/* Model dropdown */}
        <div className="min-w-[180px]">
          <label
            htmlFor="model-select"
            className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
          >
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
            </svg>
            Модель
          </label>

          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => onModelChange(e.target.value)}
            className="
              w-full px-4 py-2.5 rounded-xl
              bg-bg-input border border-border text-text-primary text-sm
              hover:border-border-hover focus:border-accent
              transition-all duration-200 focus-ring
              cursor-pointer appearance-none
              bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%2371717a%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')]
              bg-[length:20px] bg-[right_12px_center] bg-no-repeat
              pr-10
            "
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Content type filters */}
        <div>
          <span className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
            <svg className="w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
            </svg>
            Фильтры Adobe Stock
          </span>

          <div className="flex gap-2">
            {CONTENT_FILTERS.map((filter) => {
              const isActive = selectedFilters.includes(filter.id);
              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => toggleFilter(filter.id)}
                  className={`
                    px-3.5 py-2 rounded-xl text-sm font-medium
                    border transition-all duration-200 cursor-pointer
                    focus-ring
                    ${
                      isActive
                        ? "bg-accent text-white border-accent shadow-md shadow-accent/20"
                        : "bg-bg-input text-text-secondary border-border hover:border-border-hover hover:text-text-primary"
                    }
                  `}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
