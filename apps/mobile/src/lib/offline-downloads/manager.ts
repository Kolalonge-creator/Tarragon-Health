import { downloadDecision, planPackRefresh, type DownloadCaps, type DownloadRefusal, type PackItem } from "@tarragon/shared";

/**
 * Offline downloads (S57 function 10.9, built S57b). One manager per namespace ("media" for the calm and sleep library today; S55's learning packs
 * can create a second one with its own caps, see OFFLINE-SEAM at the bottom). Pure logic over three ports (files, network, clock), so the whole
 * policy is tested with an in-memory file system and no native module is imported here.
 *
 * Rules, all enforced here and not left to the caller:
 *  - behind the feature flag `mobile_offline_downloads`, default OFF: with the flag off nothing is fetched (deleting is always allowed);
 *  - Wi-Fi only (the cap config says so; an unknown network is treated as NOT Wi-Fi);
 *  - a per-item and a per-pack byte cap, both from PROPOSED config (`media_library.config` download), checked before AND after a fetch;
 *  - integrity: the file written must be exactly the size the server listed (and match a SHA-256 when the server lists one); a bad file is deleted,
 *    never indexed, never played;
 *  - an item past its expiry date is deleted locally on every launch and refresh, even offline, and is never handed out;
 *  - a failed refresh (no manifest) never empties the pack: only expired items are removed;
 *  - everything is deleted on sign-out (`purgeAll`), whatever the flag says.
 */

export interface DownloadItem extends PackItem {
  readonly url: string;
  /** Lower-case hex SHA-256 of the file, when the server provides one (media_library has no hash column yet: OQ-S57b-05). */
  readonly sha256?: string | null;
}

export interface FilePort {
  /** Root directory for this app's downloads, with a trailing slash, in app-private storage. */
  readonly root: string;
  ensureDir(path: string): Promise<void>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  /** Fetches url to path. Returns the HTTP status and the bytes on disk. Never leaves a partial file on throw. */
  download(url: string, path: string): Promise<{ status: number; bytes: number }>;
  size(path: string): Promise<number | null>;
  /** Moves a verified file into place, replacing nothing (the caller removed the old one). */
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  sha256?(path: string): Promise<string>;
}

export interface NetworkPort { isOnWifi(): Promise<boolean> }

export interface ManagerDeps {
  readonly namespace: string;
  readonly files: FilePort;
  readonly network: NetworkPort;
  readonly caps: DownloadCaps;
  /** Africa/Lagos calendar day, YYYY-MM-DD. */
  readonly today: () => string;
  /** Whether the feature flag is on for this person right now. Called at every fetch. */
  readonly flagEnabled: () => Promise<boolean>;
  readonly report?: (event: string, detail: Record<string, unknown>) => void;
}

interface IndexEntry { id: string; bytes: number; expires_on: string; updated_at: string; file: string }
interface Index { version: 1; items: IndexEntry[] }

export type RefreshOutcome =
  | { status: "off" }
  | { status: "kept"; reason: "manifest_unavailable"; deleted: string[] }
  | { status: "done"; fetched: string[]; deleted: string[]; refused: { id: string; reason: DownloadRefusal | "bad_file" | "http_error" | "download_failed" }[] };

const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;

export function createDownloadManager(deps: ManagerDeps) {
  const dir = `${deps.files.root}${deps.namespace}/`;
  const indexPath = `${dir}index.json`;

  async function readIndex(): Promise<Index> {
    try {
      const raw = await deps.files.readText(indexPath);
      if (!raw) return { version: 1, items: [] };
      const parsed = JSON.parse(raw) as Index;
      if (parsed.version !== 1 || !Array.isArray(parsed.items)) return { version: 1, items: [] };
      return { version: 1, items: parsed.items.filter((i) => SAFE_ID.test(i.id) && typeof i.bytes === "number" && typeof i.expires_on === "string") };
    } catch {
      return { version: 1, items: [] };
    }
  }
  async function writeIndex(ix: Index): Promise<void> {
    await deps.files.writeText(indexPath, JSON.stringify(ix));
  }
  const fileFor = (id: string) => `${dir}${id}.audio`;
  const asPack = (e: IndexEntry): PackItem => ({ id: e.id, bytes: e.bytes, expires_on: e.expires_on, updated_at: e.updated_at });

  /** Removes every local item past its date. Works offline and with the flag off. Returns the ids removed. */
  async function purgeExpired(): Promise<string[]> {
    await deps.files.ensureDir(dir);
    const ix = await readIndex();
    const today = deps.today();
    const gone = ix.items.filter((i) => i.expires_on <= today);
    for (const g of gone) await deps.files.remove(g.file).catch(() => undefined);
    if (gone.length > 0) await writeIndex({ version: 1, items: ix.items.filter((i) => i.expires_on > today) });
    return gone.map((g) => g.id);
  }

  /** The file to play for an item, or null. Expired, missing and wrong-size files are never handed out. */
  async function localUri(id: string): Promise<string | null> {
    if (!SAFE_ID.test(id)) return null;
    const ix = await readIndex();
    const e = ix.items.find((i) => i.id === id);
    if (!e || e.expires_on <= deps.today()) return null;
    const sz = await deps.files.size(e.file);
    if (sz !== e.bytes) return null;
    return e.file;
  }

  async function packBytes(): Promise<number> {
    return (await readIndex()).items.reduce((n, i) => n + i.bytes, 0);
  }

  /**
   * Brings the local pack in line with the server's manifest (null when the manifest could not be read). Deletes first (so room is freed and expired
   * items go), then fetches what is missing or changed, one at a time, each checked against the caps and verified before it is indexed.
   */
  async function refresh(manifest: readonly DownloadItem[] | null): Promise<RefreshOutcome> {
    const expired = await purgeExpired();
    if (manifest === null) return { status: "kept", reason: "manifest_unavailable", deleted: expired };
    if (!(await deps.flagEnabled().catch(() => false))) return { status: "off" };

    let ix = await readIndex();
    const today = deps.today();
    const plan = planPackRefresh({ manifest, local: ix.items.map(asPack), today });
    const deleted = [...expired];
    for (const id of plan.toDelete) {
      const e = ix.items.find((i) => i.id === id);
      if (e) await deps.files.remove(e.file).catch(() => undefined);
      deleted.push(id);
    }
    ix = { version: 1, items: ix.items.filter((i) => !plan.toDelete.includes(i.id)) };
    await writeIndex(ix);

    const fetched: string[] = [];
    const refused: { id: string; reason: DownloadRefusal | "bad_file" | "http_error" | "download_failed" }[] = [];
    const byId = new Map(manifest.map((m) => [m.id, m]));
    for (const planned of plan.toFetch) {
      const item = byId.get(planned.id);
      if (!item) continue;
      if (!SAFE_ID.test(item.id)) { refused.push({ id: item.id, reason: "bad_file" }); continue; }
      const replacing = ix.items.find((i) => i.id === item.id);
      const decision = downloadDecision({
        onWifi: await deps.network.isOnWifi().catch(() => false),
        bytes: item.bytes,
        packBytesNow: ix.items.reduce((n, i) => n + i.bytes, 0) - (replacing?.bytes ?? 0),
        expiresOn: item.expires_on,
        today,
        caps: deps.caps,
      });
      if (!decision.ok) { refused.push({ id: item.id, reason: decision.reason }); if (decision.reason === "not_on_wifi") break; continue; }

      const tmp = `${fileFor(item.id)}.part`;
      let outcome: "ok" | "http_error" | "download_failed" | "bad_file" = "ok";
      try {
        const r = await deps.files.download(item.url, tmp);
        if (r.status < 200 || r.status >= 300) outcome = "http_error";
        else {
          // Integrity: exactly the listed size (also stops a server sending more than the cap), and the hash when one is listed.
          const sz = await deps.files.size(tmp);
          if (sz !== item.bytes || r.bytes !== item.bytes) outcome = "bad_file";
          else if (item.sha256 && deps.files.sha256 && (await deps.files.sha256(tmp)).toLowerCase() !== item.sha256.toLowerCase()) outcome = "bad_file";
        }
      } catch {
        outcome = "download_failed";
      }
      if (outcome !== "ok") {
        await deps.files.remove(tmp).catch(() => undefined);
        refused.push({ id: item.id, reason: outcome });
        deps.report?.("offline_download_refused", { namespace: deps.namespace, id: item.id, reason: outcome });
        continue;
      }
      // Only a verified file reaches its final name: remove the old copy, then move the checked temporary file into place.
      await deps.files.remove(fileFor(item.id)).catch(() => undefined);
      await deps.files.move(tmp, fileFor(item.id));
      ix = { version: 1, items: [...ix.items.filter((i) => i.id !== item.id), { id: item.id, bytes: item.bytes, expires_on: item.expires_on, updated_at: item.updated_at, file: fileFor(item.id) }] };
      await writeIndex(ix);
      fetched.push(item.id);
    }
    return { status: "done", fetched, deleted, refused };
  }

  /** Everything this manager holds, regardless of the flag. Called on sign-out. */
  async function purgeAll(): Promise<void> {
    await deps.files.remove(dir).catch(() => undefined);
  }

  return { refresh, purgeExpired, purgeAll, localUri, packBytes };
}

export type DownloadManager = ReturnType<typeof createDownloadManager>;

/* OFFLINE-SEAM (S55): S55's learning packs are not on this branch. When that code lands, create a second manager with namespace "learning" and the
 * learning caps, feed `refresh` the learning manifest mapped to DownloadItem (id, bytes, expires_on, updated_at, url), and call `purgeExpired` at
 * launch; sign-out purges every namespace through `purgeAllDownloads` in ./index.ts, which only needs the new manager added to its list. */
