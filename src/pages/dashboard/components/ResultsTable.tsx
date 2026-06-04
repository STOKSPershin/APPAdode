import { useState } from "react";
import type { TopicResult } from "@shared/types";

interface ResultsTableProps {
  /** The user's original topic — displayed as the first row with accent styling */
  userTopicResult: TopicResult | null;
  /** AI-generated subtopics with their scraping results */
  results: TopicResult[];
  /** Warning message from sanity check (if any) */
  warning: string | null;
  /** Total number of expected AI results (for skeleton count) */
  expectedCount: number;
  /** Whether the AI generation phase is still running */
  isGenerating: boolean;
}

/**
 * ResultsTable — displays user topic + AI-generated subtopics with demand data
 *
 * Features:
 * - User's topic as the first highlighted row (violet accent)
 * - Skeleton loading rows for topics being scraped
 * - Copy & Favorite action buttons per row
 * - Sanity check warning banner
 * - Stats bar (total, in-range, errors)
 */
export default function ResultsTable({
  userTopicResult,
  results,
  warning,
  expectedCount,
  isGenerating,
}: ResultsTableProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    } catch {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
    }
  };

  // Stats
  const completedResults = results.filter((r) => r.status !== "pending");
  const successResults = completedResults.filter((r) => r.status === "ok");
  const errorResults = completedResults.filter((r) => r.status === "error" || r.status === "waf_blocked");

  return (
    <div className="space-y-3 animate-fade-in">
      {/* ── Warning Banner ────────────────────────────── */}
      {warning && (
        <div className="flex items-start gap-3 px-5 py-3.5 rounded-xl bg-warning/8 border border-warning/20">
          <svg className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-warning">Предупреждение</p>
            <p className="text-xs text-warning/80 mt-0.5">{warning}</p>
          </div>
        </div>
      )}

      {/* ── User Topic Card (above table) ─────────────── */}
      {userTopicResult && (
        <div className="bg-gradient-to-r from-accent/10 via-accent/5 to-transparent border border-accent/20 rounded-2xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-accent/15 border border-accent/25">
              <svg className="w-4.5 h-4.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
              </svg>
            </div>
            <div>
              <p className="text-xs text-accent font-medium uppercase tracking-wider">Ваша тема</p>
              <p className="text-base font-semibold text-text-primary">{userTopicResult.topic}</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Demand */}
            <div className="text-right">
              <p className="text-xs text-text-muted">Спрос</p>
              {userTopicResult.status === "pending" ? (
                <div className="w-16 h-5 rounded bg-accent/10 animate-pulse mt-0.5" />
              ) : userTopicResult.status === "ok" ? (
                <p className="text-lg font-bold text-accent tabular-nums">
                  {formatDemand(userTopicResult.demand)}
                </p>
              ) : (
                <StatusBadge status={userTopicResult.status} />
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <ActionButton
                icon="copy"
                title="Копировать"
                isCopied={copiedIndex === -1}
                onClick={() => handleCopy(userTopicResult.topic, -1)}
              />
              <ActionButton icon="heart" title="В избранное" onClick={() => {}} />
            </div>
          </div>
        </div>
      )}

      {/* ── Stats Bar ─────────────────────────────────── */}
      <div className="flex items-center gap-4 px-1">
        <h3 className="text-base font-semibold text-text-primary">AI Результаты</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-text-muted">
            Всего: <span className="text-text-secondary font-medium">{expectedCount}</span>
          </span>
          {successResults.length > 0 && (
            <span className="text-success">
              Успешно: <span className="font-medium">{successResults.length}</span>
            </span>
          )}
          {errorResults.length > 0 && (
            <span className="text-error">
              Ошибок: <span className="font-medium">{errorResults.length}</span>
            </span>
          )}
        </div>

        {/* Generating indicator */}
        {isGenerating && (
          <div className="ml-auto flex items-center gap-2 text-xs text-accent">
            <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Генерация подтем…
          </div>
        )}
      </div>

      {/* ── Table ──────────────────────────────────────── */}
      <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="w-12 px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">#</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">Тема</th>
              <th className="w-32 px-4 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider">Спрос</th>
              <th className="w-24 px-4 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider">Действие</th>
            </tr>
          </thead>
          <tbody>
            {/* AI Results rows */}
            {results.map((result, idx) => (
              <tr
                key={idx}
                className="border-b border-border/50 hover:bg-bg-card-hover transition-colors duration-150 group"
              >
                {/* # */}
                <td className="px-4 py-3 text-sm text-text-muted tabular-nums">{idx + 1}</td>

                {/* Topic name */}
                <td className="px-4 py-3">
                  {result.status === "pending" && !result.topic ? (
                    <div className="w-48 h-4 rounded bg-border/40 animate-pulse" />
                  ) : (
                    <span className="text-sm font-medium text-text-primary">{result.topic}</span>
                  )}
                </td>

                {/* Demand */}
                <td className="px-4 py-3 text-right">
                  {result.status === "pending" ? (
                    <div className="w-16 h-4 rounded bg-border/40 animate-pulse ml-auto" />
                  ) : result.status === "ok" ? (
                    <span className={`text-sm font-semibold tabular-nums ${getDemandColor(result.demand)}`}>
                      {formatDemand(result.demand)}
                    </span>
                  ) : (
                    <StatusBadge status={result.status} />
                  )}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    <ActionButton
                      icon="copy"
                      title="Копировать"
                      isCopied={copiedIndex === idx}
                      onClick={() => handleCopy(result.topic, idx)}
                    />
                    <ActionButton icon="heart" title="В избранное" onClick={() => {}} />
                  </div>
                </td>
              </tr>
            ))}

            {/* Skeleton rows while AI is generating */}
            {isGenerating && results.length < expectedCount &&
              Array.from({ length: expectedCount - results.length }).map((_, idx) => (
                <tr key={`skeleton-${idx}`} className="border-b border-border/50">
                  <td className="px-4 py-3">
                    <div className="w-5 h-4 rounded bg-border/30 animate-pulse" />
                  </td>
                  <td className="px-4 py-3">
                    <div
                      className="h-4 rounded bg-border/30 animate-pulse"
                      style={{ width: `${120 + Math.random() * 140}px` }}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-14 h-4 rounded bg-border/30 animate-pulse ml-auto" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-12 h-4 rounded bg-border/30 animate-pulse mx-auto" />
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Sub-components & Helpers
// ────────────────────────────────────────────────────────────────────

/** Format demand number with commas: 524789 → "524,789" */
function formatDemand(demand: number | null): string {
  if (demand === null) return "—";
  return demand.toLocaleString("en-US");
}

/** Color-code demand: green if high, orange if medium, red-ish if low */
function getDemandColor(demand: number | null): string {
  if (demand === null) return "text-text-muted";
  if (demand >= 100000) return "text-success";
  if (demand >= 20000) return "text-accent";
  if (demand >= 5000) return "text-warning";
  return "text-error";
}

/** Status badge for error / WAF blocked states */
function StatusBadge({ status }: { status: string }) {
  const isWaf = status === "waf_blocked";
  return (
    <span
      className={`
        inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium
        ${isWaf ? "bg-warning/10 text-warning" : "bg-error/10 text-error"}
      `}
    >
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
      </svg>
      {isWaf ? "WAF" : "Ошибка"}
    </span>
  );
}

/** Small icon button for Copy / Favorite actions */
function ActionButton({
  icon,
  title,
  isCopied,
  onClick,
}: {
  icon: "copy" | "heart";
  title: string;
  isCopied?: boolean;
  onClick: () => void;
}) {
  if (icon === "copy") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-input transition-all duration-150 cursor-pointer"
      >
        {isCopied ? (
          <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.334a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184" />
          </svg>
        )}
      </button>
    );
  }

  // Heart / Favorite
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="p-1.5 rounded-lg text-text-muted hover:text-accent hover:bg-accent/10 transition-all duration-150 cursor-pointer"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
      </svg>
    </button>
  );
}
