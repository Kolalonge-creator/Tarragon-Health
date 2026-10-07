import { supabase } from "./supabase";
import { downloadDecision, getProposedConfig, type DownloadCaps } from "@tarragon/shared";

/**
 * Calm and sleep library on the phone (S57). The database decides what is servable (active, published, not a placeholder, review date
 * ahead, the script guard); nothing here filters for safety. A read failure is reported as null so the screen can say so.
 * Downloads of audio: the decision (Wi-Fi only, per-track and pack caps from PROPOSED config, expired never) is pure and tested; the native
 * network probe and file engine are NOT in this build (they need a new app build and a runtimeVersion bump), so no download is started.
 */
export interface LibraryItem {
  id: string;
  code: string;
  kind: "meditation" | "sleep_story" | "soundscape" | "breathing" | "exercise";
  exercise_type: string | null;
  title: string;
  summary: string | null;
  series: string;
  series_position: number;
  voice: string | null;
  duration_seconds: number | null;
  script: { steps?: { text?: string }[]; pattern?: { inhale_s?: number; hold_s?: number; exhale_s?: number } } | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
}

export const SERIES_ORDER = ["intro", "stress", "grief", "work", "exams", "faith_reflection", "sleep", "general"] as const;

export async function loadLibrary(): Promise<LibraryItem[] | null> {
  const { data, error } = await supabase
    .from("media_library")
    .select("id, code, kind, exercise_type, title, summary, series, series_position, voice, duration_seconds, script, reviewed_by_name, reviewed_at")
    .order("series")
    .order("series_position");
  if (error) return null;
  return (data ?? []) as unknown as LibraryItem[];
}

export function groupBySeries(items: readonly LibraryItem[]): { series: string; items: LibraryItem[] }[] {
  return SERIES_ORDER.map((s) => ({ series: s, items: items.filter((i) => i.series === s) })).filter((g) => g.items.length > 0);
}

export function scriptSteps(item: LibraryItem): string[] {
  return (item.script?.steps ?? []).map((s) => s.text ?? "").filter((s) => s.length > 0);
}

export async function recordSession(mediaId: string, seconds: number): Promise<boolean> {
  const { error } = await supabase.rpc("record_media_session", { p_media: mediaId, p_listened_seconds: Math.max(0, Math.min(14400, Math.round(seconds))) });
  return !error;
}

/** The native network state, once a module provides it. Until then Wi-Fi is NEVER assumed. */
export interface NetworkProbe { isOnWifi(): Promise<boolean> }

export function downloadCaps(): DownloadCaps {
  return (getProposedConfig("media_library.config").value as unknown as { download: DownloadCaps }).download;
}

export async function mayDownload(args: { bytes: number; packBytesNow: number; expiresOn: string; today: string }, probe: NetworkProbe | null) {
  const onWifi = probe ? await probe.isOnWifi().catch(() => false) : false;
  return downloadDecision({ ...args, onWifi, caps: downloadCaps() });
}
