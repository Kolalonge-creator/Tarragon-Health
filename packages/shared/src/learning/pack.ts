import { getProposedConfig } from "../proposed-config";
import { isExpired } from "./expiry";

export interface OfflinePackConfig {
  readonly max_total_bytes: number;
  readonly max_items: number;
  readonly audio_wifi_only: boolean;
}

export function loadOfflinePackConfig(asOf?: string): OfflinePackConfig {
  return getProposedConfig("learning.offline_pack", asOf).value as unknown as OfflinePackConfig;
}

export interface PackCandidate {
  readonly code: string;
  readonly contentVersion: number;
  readonly textBytes: number;
  readonly audioClipId: string | null;
  readonly nextReviewDue: string | null;
}

export interface PackPlan<T extends PackCandidate> {
  /** Items to keep, in the order given, each with whether its audio is included. */
  readonly chosen: readonly { readonly item: T; readonly withAudio: boolean }[];
  readonly skippedExpired: readonly string[];
  readonly skippedOverCap: readonly string[];
  readonly totalBytes: number;
}

/**
 * Choose what fits under the cap, in the order the server listed them. Expired items are never chosen. If an item's text
 * fits but its audio would not, the text is kept and the audio dropped; if the text itself does not fit the item is
 * skipped. `audioBytes` gives the recording size from the audio manifest (null when there is no recording yet).
 */
export function planOfflinePack<T extends PackCandidate>(
  items: readonly T[],
  config: OfflinePackConfig,
  audioBytes: (clipId: string) => number | null,
  now: Date = new Date(),
): PackPlan<T> {
  const chosen: { item: T; withAudio: boolean }[] = [];
  const skippedExpired: string[] = [];
  const skippedOverCap: string[] = [];
  let total = 0;
  for (const item of items) {
    if (isExpired({ nextReviewDue: item.nextReviewDue }, now)) {
      skippedExpired.push(item.code);
      continue;
    }
    if (chosen.length >= config.max_items || total + item.textBytes > config.max_total_bytes) {
      skippedOverCap.push(item.code);
      continue;
    }
    const audio = item.audioClipId ? audioBytes(item.audioClipId) : null;
    const withAudio = audio !== null && total + item.textBytes + audio <= config.max_total_bytes;
    total += item.textBytes + (withAudio && audio !== null ? audio : 0);
    chosen.push({ item, withAudio });
  }
  return { chosen, skippedExpired, skippedOverCap, totalBytes: total };
}

export interface PackStatusRow {
  readonly code: string;
  readonly servable: boolean;
  readonly contentVersion: number | null;
}

/**
 * On reconnect: compare what is saved with what the server says. Anything the server no longer serves (expired,
 * unpublished, withdrawn, unknown) is removed; anything whose version changed is fetched again.
 */
export function reconcilePack(
  local: readonly { readonly code: string; readonly contentVersion: number }[],
  status: readonly PackStatusRow[],
): { remove: string[]; refresh: string[] } {
  const byCode = new Map(status.map((s) => [s.code, s]));
  const remove: string[] = [];
  const refresh: string[] = [];
  for (const l of local) {
    const s = byCode.get(l.code);
    if (!s || !s.servable) remove.push(l.code);
    else if (s.contentVersion !== null && s.contentVersion !== l.contentVersion) refresh.push(l.code);
  }
  return { remove, refresh };
}
