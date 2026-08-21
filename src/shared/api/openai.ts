/**
 * OpenAI API Client — runs client-side to bypass WAF on backend
 *
 * Generates subtopic ideas using OpenAI chat completions.
 * Makes direct fetch() calls to api.openai.com (allowed via host_permissions).
 */

const OPENAI_BASE_URL = "https://api.openai.com/v1";

const DEFAULT_SYSTEM_PROMPT = `You are an expert in stock photography and visual content. The user will give you a topic or niche. Your task is to generate 20 unique subtopics that photographers and designers can use to create content on Adobe Stock.

Rules:
- Each subtopic must be specific and visually representable
- Subtopics must be in English
- Return ONLY a valid JSON array of strings, e.g. ["Topic 1", "Topic 2", ...]
- Do NOT add any explanations, comments, or markdown formatting`;

export interface GenerateTopicsResult {
  topics: string[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Generate subtopics using OpenAI Chat Completions.
 *
 * Includes a 3-attempt retry loop with JSON validation per attempt,
 * mirroring the backend resilience logic from topichunter.md §6.1.
 *
 * @param apiKey   - User's OpenAI API key
 * @param model    - Model ID (e.g. "gpt-5.4-mini")
 * @param topic    - User's input topic / niche
 * @param systemPrompt - Custom system prompt (uses default if empty)
 */
export async function generateTopics(
  apiKey: string,
  model: string,
  topic: string,
  systemPrompt?: string,
  signal?: AbortSignal,
): Promise<GenerateTopicsResult> {
  const maxAttempts = 3;
  let lastError: Error | null = null;

  const sysPrompt = systemPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[OpenAI] ⏳ Attempt ${attempt}/${maxAttempts}...`);

      const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: sysPrompt },
            { role: "user", content: topic },
          ],
          max_completion_tokens: 2048,
          temperature: 0.8,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const errorMsg =
          (errorBody as Record<string, Record<string, string>>)?.error?.message ??
          response.statusText;
        throw new Error(`OpenAI API ${response.status}: ${errorMsg}`);
      }

      const data = await response.json();
      const rawContent: string = data.choices?.[0]?.message?.content ?? "";

      // ── Validate JSON response ─────────────────────
      // Strip markdown code fences if present (```json ... ```)
      const cleaned = rawContent
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/```\s*$/, "")
        .trim();

      const parsed: unknown = JSON.parse(cleaned);

      // Validation: must be a non-empty array of strings
      if (!Array.isArray(parsed)) {
        throw new Error("Response is not an array");
      }
      if (parsed.length === 0) {
        throw new Error("Response array is empty");
      }

      const topics = parsed
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((t) => t.trim());

      if (topics.length === 0) {
        throw new Error("No valid string topics found in array");
      }

      console.log(`[OpenAI] ✅ Attempt ${attempt}/${maxAttempts} — ${topics.length} topics`);

      return {
        topics,
        usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      };
    } catch (err) {
      if (signal?.aborted) {
        throw new Error("Сканирование остановлено вручную", { cause: err });
      }
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[OpenAI] ⚠️ Attempt ${attempt}/${maxAttempts} failed:`, lastError.message);

      // Don't retry on auth errors
      if (lastError.message.includes("401") || lastError.message.includes("403")) {
        throw lastError;
      }
    }
  }

  throw new Error(
    `Failed to generate topics after ${maxAttempts} attempts. Last error: ${lastError?.message}`,
  );
}

/**
 * Validate an OpenAI API key by making a lightweight models request.
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch(`${OPENAI_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
