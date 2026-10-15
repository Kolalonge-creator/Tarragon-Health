import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Tables } from "@tarragon/shared";

export type MediaItem = Tables<"media_library">;
export type MediaKind = MediaItem["kind"];
export const MEDIA_KINDS = ["meditation", "sleep_story", "soundscape", "breathing", "exercise"] as const;

/**
 * The library as the signed-in person may read it. The database decides what is servable (active, published, not a placeholder, review
 * date still ahead, and the script guard for exercises and breathing): nothing here filters for safety, so a change in the rule cannot
 * be missed here. Returns null on a read failure so the screen can say so instead of showing an empty library.
 */
export async function listLibrary(): Promise<MediaItem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("media_library").select("*").order("series").order("series_position").order("title");
  if (error) return null;
  return data;
}

export async function getLibraryItem(code: string): Promise<{ item: MediaItem | null; failed: boolean }> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("media_library").select("*").eq("code", code).maybeSingle();
  if (error) return { item: null, failed: true };
  return { item: data, failed: false };
}
