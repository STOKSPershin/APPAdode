import { useState } from "react";

interface TopicInputProps {
  topic: string;
  onTopicChange: (topic: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (prompt: string) => void;
  onStartSearch: () => void;
  isSearching: boolean;
}

const DEFAULT_SYSTEM_PROMPT = `Ты — эксперт по стоковой фотографии и визуальному контенту. Пользователь даст тебе тему или нишу. Твоя задача — сгенерировать 20 уникальных подтем (subtopics), которые фотографы и дизайнеры могут использовать для создания контента на Adobe Stock.

Правила:
- Каждая подтема должна быть конкретной и визуально представимой
- Подтемы должны быть на английском языке
- Возвращай ТОЛЬКО валидный JSON-массив строк
- Не добавляй пояснений или комментариев`;

/**
 * TopicInput — Main input area
 *
 * Contains:
 * - Large topic/niche text input
 * - Collapsible system prompt accordion (closed by default)
 * - Accent "Start search" button (disabled when no topic)
 */
export default function TopicInput({
  topic,
  onTopicChange,
  systemPrompt,
  onSystemPromptChange,
  onStartSearch,
  isSearching,
}: TopicInputProps) {
  const [isPromptOpen, setIsPromptOpen] = useState(false);

  const canSearch = topic.trim().length > 0 && !isSearching;

  return (
    <div className="space-y-4 animate-fade-in" style={{ animationDelay: "100ms" }}>
      {/* ── Topic Input ──────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-2xl p-5">
        <label
          htmlFor="topic-input"
          className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2"
        >
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          Тема / Ниша
        </label>

        <input
          id="topic-input"
          type="text"
          value={topic}
          onChange={(e) => onTopicChange(e.target.value)}
          placeholder="Например: Поле с овощами"
          spellCheck={false}
          className="
            w-full px-4 py-3 rounded-xl
            bg-bg-input border border-border text-text-primary text-base
            placeholder:text-text-muted
            hover:border-border-hover focus:border-accent
            transition-all duration-200 focus-ring
          "
        />

        {/* ── System Prompt Accordion ──────────────── */}
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setIsPromptOpen(!isPromptOpen)}
            className="
              flex items-center gap-2 text-sm text-text-muted
              hover:text-text-secondary transition-colors duration-200
              cursor-pointer group
            "
          >
            <svg
              className={`w-4 h-4 transition-transform duration-200 ${isPromptOpen ? "rotate-90" : ""}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
            <span className="group-hover:text-text-secondary">Системный промпт</span>
            {isPromptOpen ? null : (
              <span className="text-xs text-text-muted/60 ml-1">(нажмите чтобы раскрыть)</span>
            )}
          </button>

          <div
            className={`
              overflow-hidden transition-all duration-300 ease-in-out
              ${isPromptOpen ? "max-h-[400px] opacity-100 mt-3" : "max-h-0 opacity-0"}
            `}
          >
            <textarea
              value={systemPrompt}
              onChange={(e) => onSystemPromptChange(e.target.value)}
              rows={7}
              className="
                w-full px-4 py-3 rounded-xl
                bg-bg-input border border-border text-text-primary text-sm
                placeholder:text-text-muted
                hover:border-border-hover focus:border-accent
                transition-all duration-200 focus-ring
                resize-y min-h-[120px]
                leading-relaxed
              "
            />
            <button
              type="button"
              onClick={() => onSystemPromptChange(DEFAULT_SYSTEM_PROMPT)}
              className="
                mt-2 px-3 py-1.5 rounded-lg text-xs font-medium
                text-text-muted hover:text-text-secondary
                bg-bg-input border border-border hover:border-border-hover
                transition-all duration-200 cursor-pointer
              "
            >
              ↻ Сбросить по умолчанию
            </button>
          </div>
        </div>
      </div>

      {/* ── Start Search Button ──────────────────────── */}
      <button
        type="button"
        onClick={onStartSearch}
        disabled={!canSearch}
        className={`
          w-full px-6 py-3.5 rounded-xl
          text-sm font-semibold text-white
          transition-all duration-200 cursor-pointer
          focus-ring
          flex items-center justify-center gap-2.5
          ${
            canSearch
              ? "bg-accent hover:bg-accent-hover active:scale-[0.98] shadow-lg shadow-accent/25"
              : "bg-accent/25 cursor-not-allowed text-white/50"
          }
        `}
      >
        {isSearching ? (
          <>
            <svg className="w-4.5 h-4.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Анализ...
          </>
        ) : (
          <>
            <svg className="w-4.5 h-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
            </svg>
            Начать поиск
          </>
        )}
      </button>
    </div>
  );
}

export { DEFAULT_SYSTEM_PROMPT };
