import { getProposedConfig, type DownloadCaps } from "@tarragon/shared";
import { supabase } from "@/lib/supabase";
import { lagosLocalDate } from "@/lib/lagos-date";
import { createDownloadManager, type DownloadItem, type DownloadManager, type FilePort, type NetworkPort, type RefreshOutcome } from "./manager";

/**
 * Real adapters for the offline download manager (S57b). NEEDS A NEW NATIVE BUILD: `expo-file-system` and `expo-network` are native modules, so the
 * installed app must be rebuilt with EAS (and runtimeVersion bumped) before this can run on a phone. Until then the modules are loaded lazily inside a
 * try/catch: an over-the-air update carrying this JS to an older binary finds no native module, `getMediaDownloads()` returns null and the feature is
 * simply absent (no crash). The feature flag `mobile_offline_downloads` is OFF by default on top of that. Never run on a real device (see docs).
 * The only entry points are the ones App.tsx and the library screen call; the policy lives in ./manager.ts and is unit tested.
 */

export const OFFLINE_DOWNLOADS_FLAG = "mobile_offline_downloads";

type FsLegacy = typeof import("expo-file-system/legacy");
type NetworkModule = typeof import("expo-network");

function loadNative(): { fs: FsLegacy; net: NetworkModule } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("expo-file-system/legacy") as FsLegacy;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const net = require("expo-network") as NetworkModule;
    if (!fs.documentDirectory) return null;
    return { fs, net };
  } catch {
    return null;
  }
}

function filePort(fs: FsLegacy): FilePort {
  const root = `${fs.documentDirectory}offline-downloads/`;
  return {
    root,
    ensureDir: (p) => fs.makeDirectoryAsync(p, { intermediates: true }).catch(() => undefined),
    readText: async (p) => ((await fs.getInfoAsync(p)).exists ? fs.readAsStringAsync(p) : null),
    writeText: (p, t) => fs.writeAsStringAsync(p, t),
    download: async (url, path) => {
      try {
        const r = await fs.downloadAsync(url, path);
        const info = await fs.getInfoAsync(path);
        return { status: r.status, bytes: info.exists && "size" in info ? info.size : 0 };
      } catch (e) {
        await fs.deleteAsync(path, { idempotent: true }).catch(() => undefined);
        throw e;
      }
    },
    size: async (p) => {
      const info = await fs.getInfoAsync(p);
      return info.exists && "size" in info ? info.size : null;
    },
    move: (from, to) => fs.moveAsync({ from, to }),
    remove: (p) => fs.deleteAsync(p, { idempotent: true }),
  };
}

function networkPort(net: NetworkModule): NetworkPort {
  return {
    isOnWifi: async () => {
      const s = await net.getNetworkStateAsync();
      return s.isConnected === true && s.type === net.NetworkStateType.WIFI;
    },
  };
}

async function flagEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_feature_flags");
  if (error) return false;
  return ((data ?? {}) as Record<string, boolean>)[OFFLINE_DOWNLOADS_FLAG] === true;
}

let media: DownloadManager | null | undefined;

/** The calm and sleep library's download manager, or null when this build has no native file module. */
export function getMediaDownloads(): DownloadManager | null {
  if (media !== undefined) return media;
  const native = loadNative();
  if (!native) { media = null; return media; }
  const caps = (getProposedConfig("media_library.config").value as unknown as { download: DownloadCaps }).download;
  media = createDownloadManager({
    namespace: "media",
    files: filePort(native.fs),
    network: networkPort(native.net),
    caps,
    today: () => lagosLocalDate(Date.now()),
    flagEnabled,
  });
  return media;
}

interface ManifestRow { id: string; bytes: number; audio_url: string | null; updated_at: string; expires_on: string }

/** Reads the server's manifest (null on any failure) and syncs the local pack to it. Safe to call on launch and on Wi-Fi. */
export async function refreshMediaDownloads(): Promise<RefreshOutcome | null> {
  const m = getMediaDownloads();
  if (!m) return null;
  const { data, error } = await supabase.rpc("media_offline_manifest");
  const items = !error && data && typeof data === "object" ? ((data as { items?: ManifestRow[] }).items ?? null) : null;
  const manifest: DownloadItem[] | null = items
    ? items.filter((i) => typeof i.audio_url === "string" && i.audio_url.length > 0).map((i) => ({ id: i.id, bytes: i.bytes, expires_on: i.expires_on, updated_at: i.updated_at, url: i.audio_url as string }))
    : null;
  return m.refresh(manifest);
}

/** Removes every offline download of every namespace. Called on sign-out and never depends on the flag. */
export async function purgeAllDownloads(): Promise<void> {
  const native = loadNative();
  if (!native) return;
  await native.fs.deleteAsync(`${native.fs.documentDirectory}offline-downloads/`, { idempotent: true }).catch(() => undefined);
  media = undefined;
}

export { createDownloadManager } from "./manager";
export type { DownloadItem, DownloadManager, FilePort, NetworkPort, RefreshOutcome } from "./manager";
