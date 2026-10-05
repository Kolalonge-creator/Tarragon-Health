import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "./supabase";
import { DEFAULT_OFFLINE_SYNC_CONFIG, type OfflineSyncConfig } from "./outbox-rules";

/**
 * The offline-sync numbers (backdate window, stuck-notice hours, pull overlap)
 * are PROPOSED values versioned server-side in public.offline_sync_config, never
 * hard-coded. The phone keeps the last copy it saw and falls back to the
 * bundled default, so a phone that has never synced still behaves. Same
 * cache-with-fallback shape as threshold-sync.ts.
 */
const CACHE_KEY = "@tarragon/offline-sync-config/v1";

function isConfig(value: unknown): value is OfflineSyncConfig {
  const v = value as Partial<OfflineSyncConfig> | null;
  return (
    !!v &&
    typeof v.version === "number" &&
    typeof v.backdateWindowHours === "number" &&
    typeof v.stuckNoticeHours === "number" &&
    typeof v.stuckNoticeDangerHours === "number" &&
    typeof v.pullOverlapMinutes === "number"
  );
}

export async function loadOfflineSyncConfig(): Promise<OfflineSyncConfig> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return DEFAULT_OFFLINE_SYNC_CONFIG;
    const parsed: unknown = JSON.parse(raw);
    return isConfig(parsed) ? parsed : DEFAULT_OFFLINE_SYNC_CONFIG;
  } catch {
    return DEFAULT_OFFLINE_SYNC_CONFIG;
  }
}

/** Best-effort. Never throws; an offline call changes nothing. */
export async function refreshOfflineSyncConfig(): Promise<void> {
  try {
    const { data, error } = await supabase
      .from("offline_sync_config")
      .select("version, backdate_window_hours, stuck_notice_hours, stuck_notice_danger_hours, pull_overlap_minutes")
      .eq("is_active", true)
      .maybeSingle();
    if (error || !data) return;
    const next: OfflineSyncConfig = {
      version: data.version,
      backdateWindowHours: data.backdate_window_hours,
      stuckNoticeHours: data.stuck_notice_hours,
      stuckNoticeDangerHours: data.stuck_notice_danger_hours,
      pullOverlapMinutes: data.pull_overlap_minutes,
    };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(next));
  } catch {
    // keep whatever is cached
  }
}
