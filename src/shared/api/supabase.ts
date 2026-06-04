/**
 * Supabase Client — shared singleton for auth, billing, saved items
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These will be set from environment variables at build time
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get the shared Supabase client instance (lazy singleton).
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error(
        "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables.",
      );
    }
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Use chrome.storage instead of localStorage for extension context
        storage: {
          getItem: async (key: string): Promise<string | null> => {
            const result = await chrome.storage.local.get(key);
            return (result[key] as string) ?? null;
          },
          setItem: async (key: string, value: string) => {
            await chrome.storage.local.set({ [key]: value });
          },
          removeItem: async (key: string) => {
            await chrome.storage.local.remove(key);
          },
        },
        autoRefreshToken: false,
        persistSession: true,
      },
    });
  }
  return supabaseInstance;
}

/* ───── Saved Items (Favorites) ───── */

export async function saveTopic(
  mainTopic: string,
  subtopic: string,
  demand: number,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("saved_items").insert({
    main_topic: mainTopic,
    subtopic,
    demand,
  });
  if (error) throw error;
}

export async function removeSavedTopic(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("saved_items")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function getSavedTopics(): Promise<
  { id: string; main_topic: string; subtopic: string; demand: number; created_at: string }[]
> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("saved_items")
    .select("id, main_topic, subtopic, demand, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
