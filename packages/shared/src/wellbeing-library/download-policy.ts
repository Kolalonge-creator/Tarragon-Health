/**
 * Download decisions for library audio (S57, function 10.9). Pure: the phone supplies the facts (on Wi-Fi or not, bytes, dates) and
 * the caps come from PROPOSED config (`media_library.config` download). S55's offline pack is not on this base; this is the small
 * shared seam it can adopt. Rule shared with S55: a failed refresh never empties the pack, and an expired item is deleted locally
 * even when the network is down (the phone hides expired items itself).
 */
export interface DownloadCaps {
  readonly wifi_only: boolean;
  readonly max_track_bytes: number;
  readonly max_pack_bytes: number;
}

export type DownloadRefusal = "not_on_wifi" | "track_too_large" | "pack_full" | "expired";

export function downloadDecision(args: {
  readonly onWifi: boolean;
  readonly bytes: number;
  readonly packBytesNow: number;
  readonly expiresOn: string; // YYYY-MM-DD, Africa/Lagos calendar day
  readonly today: string; // YYYY-MM-DD, Africa/Lagos
  readonly caps: DownloadCaps;
}): { ok: true } | { ok: false; reason: DownloadRefusal } {
  if (args.expiresOn <= args.today) return { ok: false, reason: "expired" };
  if (args.caps.wifi_only && !args.onWifi) return { ok: false, reason: "not_on_wifi" };
  if (args.bytes > args.caps.max_track_bytes) return { ok: false, reason: "track_too_large" };
  if (args.packBytesNow + args.bytes > args.caps.max_pack_bytes) return { ok: false, reason: "pack_full" };
  return { ok: true };
}

export interface PackItem {
  readonly id: string;
  readonly bytes: number;
  readonly expires_on: string;
  readonly updated_at: string;
}

/** What to fetch and delete. `manifest` null means the refresh failed: nothing is fetched or removed except expired items. */
export function planPackRefresh(args: {
  readonly manifest: readonly PackItem[] | null;
  readonly local: readonly PackItem[];
  readonly today: string;
}): { toFetch: PackItem[]; toDelete: string[] } {
  const expiredLocal = args.local.filter((l) => l.expires_on <= args.today).map((l) => l.id);
  if (args.manifest === null) return { toFetch: [], toDelete: expiredLocal };
  const wanted = new Map(args.manifest.map((m) => [m.id, m]));
  const toDelete = new Set(expiredLocal);
  for (const l of args.local) if (!wanted.has(l.id)) toDelete.add(l.id);
  const localById = new Map(args.local.map((l) => [l.id, l]));
  const toFetch = args.manifest.filter((m) => {
    const l = localById.get(m.id);
    return !l || l.updated_at < m.updated_at;
  });
  return { toFetch, toDelete: [...toDelete] };
}
