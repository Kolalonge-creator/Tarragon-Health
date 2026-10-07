import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SQLite from "expo-sqlite";
import {
  isExpired,
  loadOfflinePackConfig,
  planOfflinePack,
  reconcilePack,
  searchLocal,
  type OfflinePackConfig,
} from "@tarragon/shared";
import { audioCatalogue } from "./audio/manifest";
import { fetchOfflinePack, fetchPackStatus, type PackRow, type PackStatus } from "./learning-centre";

/**
 * Offline lesson downloads (S55, spec 9.6). The patient opts in; the phone keeps text (and counts audio against the size cap,
 * see below) for in-date, published lessons only. Three rules, each tested in learning-pack.test.ts:
 *  1. An item past its review date is never shown, even with no signal: every read goes through readOffline(), which applies
 *     the same rule as the server (status review_due or review date today or earlier, Lagos day).
 *  2. On every refresh anything the server no longer serves (expired, unpublished, withdrawn) is deleted, and changed items are
 *     fetched again. A refresh that fails changes nothing except the purge of locally expired items, so a bad connection never
 *     empties the pack.
 *  3. The pack never exceeds the configured cap (PROPOSED, packages/shared proposed-config learning.offline_pack).
 * Audio: the cap counts the recording sizes from the bundled S32 manifest, and an item's `withAudio` says whether its recording
 * fits. The recordings themselves arrive through the S32 post-sign-up downloader once that ships (no file-download module is in
 * the app yet; OQ-S55-03). Until then the lesson plays through the audio service when the recording is bundled and otherwise
 * shows its text, as everywhere else.
 */
export interface StoredLesson {
  code: string;
  contentVersion: number;
  title: string;
  summary: string | null;
  body: string;
  category: string;
  estimatedMinutes: number | null;
  isMicroLesson: boolean;
  lessonAction: string | null;
  selfCareAction: string | null;
  knowledgeCheck: unknown;
  audioClipId: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  nextReviewDue: string | null;
  sourceReference: string | null;
  creatorName: string | null;
  textBytes: number;
  withAudio: boolean;
  downloadedAt: string;
}

export interface PackStore {
  list(): Promise<StoredLesson[]>;
  put(items: StoredLesson[]): Promise<void>;
  remove(codes: string[]): Promise<void>;
  clear(): Promise<void>;
}

export interface PackApi {
  fetchPack(): Promise<PackRow[]>;
  fetchStatus(codes: string[]): Promise<PackStatus[]>;
}

export interface RefreshResult {
  ok: boolean;
  added: number;
  removed: number;
  refreshed: number;
  totalBytes: number;
  error?: string;
}

/** What the phone may show offline: saved lessons that are still in date. Never an expired one. */
export async function readOffline(store: PackStore, now: Date = new Date()): Promise<StoredLesson[]> {
  return (await store.list()).filter((l) => !isExpired({ nextReviewDue: l.nextReviewDue }, now));
}

/** Delete locally expired items. Needs no network; run on every open of the downloads. */
export async function purgeExpired(store: PackStore, now: Date = new Date()): Promise<string[]> {
  const gone = (await store.list()).filter((l) => isExpired({ nextReviewDue: l.nextReviewDue }, now)).map((l) => l.code);
  if (gone.length) await store.remove(gone);
  return gone;
}

/**
 * This week's lesson from the downloads, for when the server cannot be reached. The phone cannot work out the programme week
 * without the server, so it keeps the one the server last chose (`lastCode`) and shows that while it is still downloaded and in
 * date; with none remembered it shows the first in-date micro-lesson. Never an expired one, never more than one lesson.
 */
export function pickOfflineWeeklyLesson(items: readonly StoredLesson[], now: Date = new Date(), lastCode?: string | null): StoredLesson | null {
  const ok = (l: StoredLesson) => l.isMicroLesson && !isExpired({ nextReviewDue: l.nextReviewDue }, now);
  return (lastCode ? items.find((l) => l.code === lastCode && ok(l)) : undefined) ?? items.find(ok) ?? null;
}

const WEEKLY_CODE_KEY = "tarragon.learning.weekly_code.v1";

/** Remember which lesson the server chose for this person this week, so the offline card shows the same one. A storage failure is harmless. */
export async function rememberWeeklyLessonCode(patientId: string, code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(`${WEEKLY_CODE_KEY}.${patientId}`, code);
  } catch {
    // the offline card then falls back to the first in-date micro-lesson
  }
}

/** Forget the remembered lesson (the server said nothing is due this week), so a later offline card does not show an old one. */
export async function forgetWeeklyLessonCode(patientId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(`${WEEKLY_CODE_KEY}.${patientId}`);
  } catch {
    // harmless
  }
}

export async function recallWeeklyLessonCode(patientId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(`${WEEKLY_CODE_KEY}.${patientId}`);
  } catch {
    return null;
  }
}

/** Search the downloads with the same synonym table the server uses. */
export function searchOffline(items: readonly StoredLesson[], query: string): StoredLesson[] {
  return searchLocal(items, query);
}

function toStored(row: PackRow, withAudio: boolean, now: Date): StoredLesson {
  return {
    code: row.code,
    contentVersion: row.content_version,
    title: row.title,
    summary: row.summary,
    body: row.body,
    category: row.category,
    estimatedMinutes: row.estimated_minutes,
    isMicroLesson: row.is_micro_lesson,
    lessonAction: row.lesson_action,
    selfCareAction: row.self_care_action,
    knowledgeCheck: row.knowledge_check,
    audioClipId: row.audio_clip_id,
    reviewedByName: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    nextReviewDue: row.next_review_due,
    sourceReference: row.source_reference,
    creatorName: row.creator_name,
    textBytes: row.text_bytes,
    withAudio,
    downloadedAt: now.toISOString(),
  };
}

/** Size of a lesson's recording from the bundled audio manifest, or null when there is none yet. */
export function manifestAudioBytes(clipId: string): number | null {
  const clip = audioCatalogue()?.get(clipId);
  const file = clip?.files.en ?? clip?.files.shared;
  return file?.bytes ?? null;
}

export async function refreshPack(deps: {
  store: PackStore;
  api?: PackApi;
  config?: OfflinePackConfig;
  audioBytes?: (clipId: string) => number | null;
  now?: Date;
  /** false: only check what is saved against the server (remove withdrawn or expired lessons); do not download the pack. */
  download?: boolean;
}): Promise<RefreshResult> {
  const now = deps.now ?? new Date();
  const api: PackApi = deps.api ?? { fetchPack: fetchOfflinePack, fetchStatus: fetchPackStatus };
  const config = deps.config ?? loadOfflinePackConfig();
  const audioBytes = deps.audioBytes ?? manifestAudioBytes;
  const { store } = deps;

  // Local expiry first: needs no network.
  await purgeExpired(store, now);
  let local = await store.list();
  let removed = 0;
  let refreshed = 0;

  try {
    if (local.length > 0) {
      const status = await api.fetchStatus(local.map((l) => l.code));
      const diff = reconcilePack(
        local.map((l) => ({ code: l.code, contentVersion: l.contentVersion })),
        status.map((s) => ({ code: s.code, servable: s.servable, contentVersion: s.content_version })),
      );
      if (diff.remove.length) {
        await store.remove(diff.remove);
        removed += diff.remove.length;
      }
      refreshed = diff.refresh.length;
      local = await store.list();
    }

    if (deps.download === false) {
      return { ok: true, added: 0, removed, refreshed, totalBytes: local.reduce((n, l) => n + l.textBytes, 0) };
    }
    const rows = await api.fetchPack();
    const plan = planOfflinePack(
      rows.map((r) => ({
        code: r.code,
        contentVersion: r.content_version,
        textBytes: r.text_bytes,
        audioClipId: r.audio_clip_id,
        nextReviewDue: r.next_review_due,
      })),
      config,
      audioBytes,
      now,
    );
    const byCode = new Map(rows.map((r) => [r.code, r]));
    const keep = new Set(plan.chosen.map((c) => c.item.code));
    const have = new Set(local.map((l) => l.code));
    const drop = local.filter((l) => !keep.has(l.code)).map((l) => l.code);
    const toWrite = plan.chosen
      .map((c) => ({ row: byCode.get(c.item.code), withAudio: c.withAudio }))
      .filter((x): x is { row: PackRow; withAudio: boolean } => x.row !== undefined)
      .map((x) => toStored(x.row, x.withAudio, now));
    // Write the new pack first and delete what no longer fits second: if the write fails (storage full) the old lessons are
    // still there, so a failed refresh really does change nothing more than the local expiry purge.
    await store.put(toWrite);
    if (drop.length) {
      await store.remove(drop);
      removed += drop.length;
    }
    return {
      ok: true,
      added: toWrite.filter((w) => !have.has(w.code)).length,
      removed,
      refreshed,
      totalBytes: plan.totalBytes,
    };
  } catch (e) {
    // A failed refresh changes nothing more: what was saved (and is still in date) stays readable.
    return { ok: false, added: 0, removed, refreshed: 0, totalBytes: (await store.list()).reduce((n, l) => n + l.textBytes, 0), error: e instanceof Error ? e.message.slice(0, 120) : "refresh failed" };
  }
}

// ---------------------------------------------------------------------------
// On-device storage and the opt-in switch
// ---------------------------------------------------------------------------
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
function getDb(): Promise<SQLite.SQLiteDatabase> {
  dbPromise ??= SQLite.openDatabaseAsync("tarragon-learning.db").then(async (db) => {
    await db.execAsync("create table if not exists learning_pack (code text primary key, row text not null);");
    return db;
  });
  return dbPromise;
}

export const sqlitePackStore: PackStore = {
  async list() {
    const db = await getDb();
    const rows = await db.getAllAsync<{ row: string }>("select row from learning_pack");
    const out: StoredLesson[] = [];
    for (const r of rows) {
      try {
        out.push(JSON.parse(r.row) as StoredLesson);
      } catch {
        // an unreadable row is skipped, never shown
      }
    }
    return out;
  },
  async put(items) {
    const db = await getDb();
    for (const it of items) await db.runAsync("insert or replace into learning_pack (code, row) values (?, ?)", it.code, JSON.stringify(it));
  },
  async remove(codes) {
    const db = await getDb();
    for (const c of codes) await db.runAsync("delete from learning_pack where code = ?", c);
  },
  async clear() {
    const db = await getDb();
    await db.runAsync("delete from learning_pack");
  },
};

const ENABLED_KEY = "@tarragon/learning-pack-enabled/v1";

export async function isPackEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ENABLED_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function setPackEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(ENABLED_KEY, on ? "1" : "0");
  if (!on) await sqlitePackStore.clear();
}

const LAST_REFRESH_KEY = "@tarragon/learning-pack-last-refresh/v1";
const OWNER_KEY = "@tarragon/learning-pack-owner/v1";
/** Engineering throttle (not a clinical value): the full pack download is not repeated on every return to the app. The withdrawal check is never throttled. */
export const AUTO_REFRESH_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** True when an automatic full download is due: never refreshed, or the last one was long enough ago. Pure, so it can be tested. */
export function autoRefreshDue(lastRefreshIso: string | null, now: Date = new Date()): boolean {
  if (!lastRefreshIso) return true;
  const last = Date.parse(lastRefreshIso);
  return Number.isNaN(last) || now.getTime() - last >= AUTO_REFRESH_MIN_INTERVAL_MS;
}

/** The user the saved lessons belong to, so a shared phone never shows one person's (age-filtered) pack to the next. */
export interface OwnerStorage {
  get(): Promise<string | null>;
  set(userId: string): Promise<void>;
  clearLastRefresh(): Promise<void>;
}

/** If the saved lessons belong to someone else, delete them (and forget the refresh time) before anything is read. */
export async function ensurePackOwner(userId: string, store: PackStore, owner: OwnerStorage): Promise<boolean> {
  const current = await owner.get();
  if (current === userId) return false;
  if (current !== null) {
    await store.clear();
    await owner.clearLastRefresh();
  }
  await owner.set(userId);
  return current !== null;
}

const asyncOwner: OwnerStorage = {
  get: () => AsyncStorage.getItem(OWNER_KEY),
  set: (id) => AsyncStorage.setItem(OWNER_KEY, id),
  clearLastRefresh: () => AsyncStorage.removeItem(LAST_REFRESH_KEY),
};

/** Bind the on-phone pack to the signed-in user. Call before reading the downloads. */
export function bindPackToUser(userId: string): Promise<boolean> {
  return ensurePackOwner(userId, sqlitePackStore, asyncOwner);
}

/** Manual refresh from the Downloads card: always downloads, and records when. */
export async function refreshPackNow(): Promise<RefreshResult> {
  const res = await refreshPack({ store: sqlitePackStore });
  if (res.ok) await AsyncStorage.setItem(LAST_REFRESH_KEY, new Date().toISOString());
  return res;
}

/**
 * Called when the app returns to the foreground. Only if the patient opted in. Locally expired lessons go every time (no network),
 * and the check for lessons the server has withdrawn runs every time; only the full download waits for the throttle. Never throws.
 */
export async function refreshPackIfEnabled(userId: string): Promise<void> {
  try {
    if (!(await isPackEnabled())) return;
    await bindPackToUser(userId);
    await purgeExpired(sqlitePackStore);
    const due = autoRefreshDue(await AsyncStorage.getItem(LAST_REFRESH_KEY));
    const res = await refreshPack({ store: sqlitePackStore, download: due });
    if (res.ok && due) await AsyncStorage.setItem(LAST_REFRESH_KEY, new Date().toISOString());
  } catch {
    // best effort: the downloads stay as they were
  }
}
