import { supabase } from "./supabase";
import { PLATFORM_URL } from "./platform-url";
import type { Database } from "@tarragon/shared";

/**
 * Learning Centre calls (S55, Module 9). Every one is an RPC that applies the review-date rule on the server, so the phone never
 * decides what is servable online. Offline, learning-pack.ts applies the same rule to what was saved.
 */
type Fn = Database["public"]["Functions"];
export type SearchHit = Fn["search_health_education"]["Returns"][number];
export type ItemTrust = Fn["health_education_item_trust"]["Returns"][number];
export type WeeklyLesson = Fn["weekly_micro_lesson"]["Returns"][number];
export type PackRow = Fn["learning_offline_pack"]["Returns"][number];
export type PackStatus = Fn["learning_pack_status"]["Returns"][number];

/** `log` is true only for a search the person submitted; a type-ahead never feeds the zero-result log. */
export async function searchLibrary(query: string, log = false): Promise<SearchHit[]> {
  const { data, error } = await supabase.rpc("search_health_education", { p_query: query.trim(), p_limit: 20, p_log: log });
  if (error) throw error;
  return data ?? [];
}

export async function loadItemTrust(code: string): Promise<ItemTrust | null> {
  const { data, error } = await supabase.rpc("health_education_item_trust", { p_codes: [code] });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function loadWeeklyLesson(): Promise<WeeklyLesson | null> {
  const { data, error } = await supabase.rpc("weekly_micro_lesson");
  if (error) throw error;
  return data?.[0] ?? null;
}

/** "Ask your care team about this": true when saved, false when the lesson can no longer be saved (not in date). */
export async function saveLessonForConsultation(code: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("save_lesson_for_consultation", { p_code: code });
  if (error) throw error;
  return data === true;
}

export async function fetchOfflinePack(): Promise<PackRow[]> {
  const { data, error } = await supabase.rpc("learning_offline_pack");
  if (error) throw error;
  return data ?? [];
}

export async function fetchPackStatus(codes: string[]): Promise<PackStatus[]> {
  const { data, error } = await supabase.rpc("learning_pack_status", { p_codes: codes });
  if (error) throw error;
  return data ?? [];
}

/** The public address of a shareable article: the marketing site, never the signed-in app host. The link holds the content code only. */
export function sharedArticleUrl(code: string, platformUrl: string = PLATFORM_URL): string {
  return `${platformUrl.replace("//app.", "//").replace(/\/$/, "")}/learn/${encodeURIComponent(code)}`;
}

export type LessonDetail = Database["public"]["Functions"]["health_education_content_detail"]["Returns"][number];

/** One lesson by code, in date only (the server applies the review-date rule). */
export async function loadLessonDetail(code: string): Promise<LessonDetail | null> {
  const { data, error } = await supabase.rpc("health_education_content_detail", { p_code: code });
  if (error) throw error;
  return data?.[0] ?? null;
}
