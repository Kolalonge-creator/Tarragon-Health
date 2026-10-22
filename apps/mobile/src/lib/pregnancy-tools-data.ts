import { weekCardState, scheduleEntries, type AntenatalVisitRow, type PregnancyContentRow, type ScheduleEntry, type WeekCardState } from "@tarragon/clinical";
import type * as SQLite from "expo-sqlite";
import { enqueue } from "./outbox";
import { localGet, localSet } from "./pregnancy-local";
import type { BirthPlanFields, BirthPlanPayload } from "./pregnancy-payloads";
import { getStoreWithSchema } from "./secure-db";
import { supabase } from "./supabase";

/**
 * Data for the phone's pregnancy screens beyond the counter and timer (S67 follow-up, OQ-346): the go-live guard, the birth plan,
 * the week card and the antenatal visits. Reads are RLS-scoped; the S67 tables are not in the generated client types yet (they are spliced
 * from a live project that holds other branches' schema), so calls go through a narrow shape instead of `any`.
 *
 * Offline first (INV-06): the birth plan and the pregnancy id are kept in the encrypted store, and a save is written there FIRST and then
 * queued on the one outbox (kind `birth_plan`), so the plan card opens and saves with no signal and reaches the server later. The week card
 * and the schedule need the server; with no signal they say so calmly and never show invented content.
 */
interface QueryError { code?: string; message?: string }
interface Chain<T> extends PromiseLike<{ data: T | null; error: QueryError | null }> {
  eq(column: string, value: string | number): Chain<T>;
  order(column: string, opts?: { ascending?: boolean }): Chain<T>;
  maybeSingle(): PromiseLike<{ data: unknown; error: QueryError | null }>;
}
interface Untyped {
  from(table: string): { select(columns: string): Chain<unknown[]> };
}
const db = (): Untyped => supabase as unknown as Untyped;

// Kept in the encrypted store (pregnancy-local), not plain AsyncStorage; the old key is read once and moved across.
const LEGACY_GUARD_KEY = (subjectId: string) => `@tarragon/maternal-guard/v1:${subjectId}`;
const GUARD_KEY = (subjectId: string) => `maternal-guard:${subjectId}`;

/**
 * The courtesy check for the `maternal_enabled` go-live guard (INV-14, client side; the database functions refuse regardless).
 * Fails closed: an error with no earlier answer on this phone reads as "not open". The last answer the server gave is kept per person so
 * a pregnant person who already has the tools keeps them with no signal (INV-06); a server "no" always replaces it.
 */
export async function maternalGuardOpen(subjectId: string): Promise<boolean> {
  try {
    const { data, error } = await (supabase as unknown as { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: QueryError | null }> }).rpc("go_live_guard_is_open", { p_key: "maternal_enabled" });
    if (error) throw new Error(error.message ?? "guard");
    const open = data === true;
    await localSet(GUARD_KEY(subjectId), open ? "1" : "0").catch(() => {});
    return open;
  } catch {
    try {
      return (await localGet(GUARD_KEY(subjectId), LEGACY_GUARD_KEY(subjectId))) === "1";
    } catch {
      return false;
    }
  }
}

async function setupPlanStore(store: SQLite.SQLiteDatabase): Promise<void> {
  await store.execAsync("create table if not exists local_birth_plan (subject_id text primary key, value text not null)");
}

export interface CachedBirthPlan {
  pregnancyId: string;
  organisationId: string;
  plan: BirthPlanFields | null;
  savedAtMs: number;
}

function parse(raw: string | null): CachedBirthPlan | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<CachedBirthPlan>;
    if (typeof v.pregnancyId !== "string" || typeof v.organisationId !== "string") return null;
    return { pregnancyId: v.pregnancyId, organisationId: v.organisationId, plan: v.plan ?? null, savedAtMs: typeof v.savedAtMs === "number" ? v.savedAtMs : 0 };
  } catch {
    return null;
  }
}

export async function readCachedBirthPlan(subjectId: string): Promise<CachedBirthPlan | null> {
  try {
    const store = await getStoreWithSchema("birth_plan", setupPlanStore);
    const row = await store.getFirstAsync<{ value: string }>("select value from local_birth_plan where subject_id = ?", [subjectId]);
    return parse(row?.value ?? null);
  } catch {
    return null;
  }
}

async function clearCachedBirthPlan(subjectId: string): Promise<void> {
  const store = await getStoreWithSchema("birth_plan", setupPlanStore);
  await store.runAsync("delete from local_birth_plan where subject_id = ?", [subjectId]);
}

async function writeCachedBirthPlan(subjectId: string, value: CachedBirthPlan): Promise<void> {
  const store = await getStoreWithSchema("birth_plan", setupPlanStore);
  await store.runAsync("insert or replace into local_birth_plan (subject_id, value) values (?, ?)", [subjectId, JSON.stringify(value)]);
}

export interface BirthPlanState {
  /** Null when there is no recorded pregnancy to hang a plan on (and none cached). */
  pregnancyId: string | null;
  plan: BirthPlanFields | null;
  /** True when this came from the phone because the server could not be reached. */
  fromCache: boolean;
  /** True when the plan could not be read at all (no signal and nothing on the phone): the standard contraction pattern is in use. */
  loadFailed?: boolean;
}

const PLAN_COLUMNS =
  "place_of_birth, transport_plan, money_plan_kobo, money_plan_note, blood_donor_name, blood_donor_phone, escort_name, escort_phone, long_journey, previous_fast_labour, previous_births";

/**
 * The plan for the card. Server first when there is signal (and the copy on the phone is refreshed), else the copy on the phone. A plan the
 * person saved offline that has not reached the server yet is kept: the phone's newer copy wins while the outbox still holds it.
 */
export async function loadBirthPlanState(subjectId: string, organisationId: string, nowMs: number, pendingOnPhone: boolean): Promise<BirthPlanState> {
  const cached = await readCachedBirthPlan(subjectId);
  try {
    const preg = await db().from("pregnancies").select("id").eq("patient_id", subjectId).eq("state", "active").maybeSingle();
    if (preg.error) throw new Error(preg.error.message ?? "pregnancy");
    const pregnancyId = (preg.data as { id?: string } | null)?.id ?? null;
    if (!pregnancyId) {
      // The server says there is no active pregnancy: the phone's copy is no longer live (the pregnancy ended or moved on), so clear it.
      if (cached) await clearCachedBirthPlan(subjectId).catch(() => {});
      return { pregnancyId: null, plan: null, fromCache: false };
    }
    if (pendingOnPhone && cached && cached.pregnancyId === pregnancyId) return { pregnancyId, plan: cached.plan, fromCache: true };
    const planRes = await db().from("birth_plans").select(PLAN_COLUMNS).eq("pregnancy_id", pregnancyId).maybeSingle();
    if (planRes.error) throw new Error(planRes.error.message ?? "birth plan");
    const plan = (planRes.data as BirthPlanFields | null) ?? null;
    await writeCachedBirthPlan(subjectId, { pregnancyId, organisationId, plan, savedAtMs: nowMs }).catch(() => {});
    return { pregnancyId, plan, fromCache: false };
  } catch {
    return { pregnancyId: cached?.pregnancyId ?? null, plan: cached?.plan ?? null, fromCache: cached !== null, loadFailed: cached === null };
  }
}

/** Saves the plan on the phone first, then queues it. Never throws for a missing signal; throws only when nothing could be written. */
export async function saveBirthPlan(input: { subjectId: string; organisationId: string; pregnancyId: string; plan: BirthPlanFields; nowMs: number }): Promise<void> {
  await writeCachedBirthPlan(input.subjectId, { pregnancyId: input.pregnancyId, organisationId: input.organisationId, plan: input.plan, savedAtMs: input.nowMs });
  const payload: BirthPlanPayload = { pregnancy_id: input.pregnancyId, organisation_id: input.organisationId, plan: input.plan };
  await enqueue({ kind: "birth_plan", subjectId: input.subjectId, payload, danger: false, recordedAt: new Date(input.nowMs).toISOString() });
}

/** The week card. Only a reviewed row is shown; with no signal or no row it is the calm "coming soon" state. */
export async function loadWeekCard(week: number | null): Promise<WeekCardState> {
  if (week === null) return weekCardState(null, []);
  try {
    const res = await db().from("pregnancy_content").select("kind, week, title, body_text, review_state, version").eq("kind", "week").eq("week", week);
    return weekCardState(week, res.error ? [] : ((res.data ?? []) as PregnancyContentRow[]));
  } catch {
    return weekCardState(week, []);
  }
}

export async function loadSchedule(subjectId: string): Promise<ScheduleEntry[]> {
  try {
    const res = await db()
      .from("antenatal_visits")
      .select("id, visit_number, target_week, gestational_week_at_visit, status, appointment_id")
      .eq("patient_id", subjectId)
      .order("visit_number", { ascending: true });
    return res.error ? [] : scheduleEntries((res.data ?? []) as AntenatalVisitRow[]);
  } catch {
    return [];
  }
}
