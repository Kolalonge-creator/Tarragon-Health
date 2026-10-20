import {
  anchorChangeConflicts,
  effectiveFromFor,
  isAnchorId,
  isValidTime,
  lagosLocalDate,
  parseScheduleSpec,
  planDayShift,
  type AnchorId,
  type ScheduleSpec,
} from "@tarragon/medicines";
import { loadDoseAnchorConfig } from "./anchor-config";
import { anchorProfileFor, refreshAnchorProfile, type DayShiftRow } from "./anchor-profile";
import { replanDoseReminders } from "./dose-reminders";
import { enqueue, flushOutbox, listOutbox, removePendingRow, type DosePayload } from "./outbox";
import { readLocalMedications, readLocalRecords } from "./offline-store";
import { supabase } from "./supabase";

/**
 * Changing the patient's anchor times and "my day has shifted" entries (S08z). Each change is written to the outbox at once (so it
 * works with no signal), applied on the phone straight away, and sent when there is a connection. The database has the final say
 * and may start a change TOMORROW when today already has answers on the anchors it touches; the phone applies the same rule so
 * what it shows is what the server will hold.
 *
 * Nothing here changes a medicine, a dose or a plan (INV-02): only when the patient's own reminders for things tied to their
 * day fall.
 */
export type SaveAnchorsResult =
  | { ok: true; effectiveFrom: string; startsTomorrow: boolean }
  | { ok: false; error: "bad_time" | "window_overlap" | "not_signed_in" };

export type ShiftResult =
  | { ok: true; startsOn: string; endsOn: string; startsTomorrow: boolean }
  | { ok: false; error: "dates" | "offsets" | "not_applicable" | "not_signed_in" };

interface MedRow {
  id: string;
  schedule_times: unknown;
  schedule_spec?: unknown;
}

/** The person's active medicines on this phone, with their schedule as the phone resolves it. */
async function localSpecs(subjectId: string): Promise<{ id: string; spec: ScheduleSpec }[]> {
  const meds = await readLocalMedications<MedRow>(subjectId);
  const profile = anchorProfileFor(subjectId);
  const out: { id: string; spec: ScheduleSpec }[] = [];
  for (const m of meds) {
    if (m.schedule_spec === null || m.schedule_spec === undefined) continue;
    const parsed = parseScheduleSpec(m.schedule_spec, profile);
    if (parsed.ok) out.push({ id: m.id, spec: parsed.spec });
  }
  return out;
}

/**
 * True when yesterday, today or tomorrow already has a logged answer on a medicine tied to one of these anchors (read from the
 * phone's copy and its unsent logs). The database asks the same question; a change over such a day starts tomorrow so the answer
 * keeps the slot it was recorded in.
 */
export async function anchorDayHasAnswers(subjectId: string, anchors: readonly string[], today: string): Promise<boolean> {
  const specs = await localSpecs(subjectId);
  const tied = new Set(specs.filter((s) => (s.spec.anchored ?? []).some((a) => anchors.includes(a.anchor))).map((s) => s.id));
  if (tied.size === 0) return false;
  const lo = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const hi = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const inRange = (d: string | null | undefined): boolean => typeof d === "string" && d >= lo && d <= hi;
  const mirrored = await readLocalRecords<{ medication_id: string; scheduled_for_date: string | null; scheduled_time: string | null }>("dose", subjectId, 200);
  if (mirrored.some((r) => tied.has(r.medication_id) && r.scheduled_time !== null && inRange(r.scheduled_for_date))) return true;
  const pending = await listOutbox("dose");
  return pending.some((r) => {
    const p = r.payload as DosePayload;
    return r.subjectId === subjectId && tied.has(p.medication_id) && p.scheduled_time !== null && inRange(p.scheduled_for_date);
  });
}

async function afterChange(subjectId: string): Promise<void> {
  await refreshAnchorProfile(subjectId);
  void flushOutbox().catch(() => undefined);
  try {
    const { data } = await supabase.auth.getSession();
    const me = data.session?.user.id;
    // The rolling reminder plan is rebuilt so the new times take effect now. It never raises a permission prompt.
    if (me) await replanDoseReminders(me);
  } catch {
    // A plan that cannot be rebuilt right now is rebuilt on the next launch or foreground; the Today list is always right.
  }
}

/** Saves the times the patient chose for one or more anchors. Works offline. */
export async function saveAnchorTimes(
  subjectId: string,
  times: Partial<Record<AnchorId, string>>,
  nowMs: number = Date.now()
): Promise<SaveAnchorsResult> {
  const entries = Object.entries(times) as [string, string][];
  if (entries.length === 0 || entries.some(([k, v]) => !isAnchorId(k) || !isValidTime(v))) return { ok: false, error: "bad_time" };
  const today = lagosLocalDate(nowMs);
  const profile = anchorProfileFor(subjectId);
  const specs = await localSpecs(subjectId);
  for (const [anchor, time] of entries) {
    if (anchorChangeConflicts(specs, profile, anchor as AnchorId, time).length > 0) return { ok: false, error: "window_overlap" };
  }
  const hasAnswers = await anchorDayHasAnswers(subjectId, entries.map(([k]) => k), today);
  const effectiveFrom = effectiveFromFor(today, hasAnswers);
  try {
    await enqueue({ kind: "anchor_times", subjectId, payload: { times: Object.fromEntries(entries), effective_from: effectiveFrom } });
  } catch {
    return { ok: false, error: "not_signed_in" };
  }
  await afterChange(subjectId);
  return { ok: true, effectiveFrom, startsTomorrow: effectiveFrom !== today };
}

/** Starts a "my day has shifted" entry. Works offline. */
export async function startDayShift(
  subjectId: string,
  input: { startsOn: string; endsOn: string; offsets: Partial<Record<AnchorId, number>> },
  nowMs: number = Date.now()
): Promise<ShiftResult> {
  const today = lagosLocalDate(nowMs);
  const anchors = Object.entries(input.offsets).filter(([, m]) => typeof m === "number" && m !== 0).map(([k]) => k);
  const hasAnswers = anchors.length > 0 ? await anchorDayHasAnswers(subjectId, anchors, today) : false;
  const plan = planDayShift(input, today, hasAnswers, loadDoseAnchorConfig().maxShiftDays);
  if (!plan.ok) return { ok: false, error: plan.error };
  try {
    await enqueue({ kind: "day_shift", subjectId, payload: { starts_on: plan.startsOn, ends_on: plan.endsOn, offsets: plan.offsets as Record<string, number> } });
  } catch {
    return { ok: false, error: "not_signed_in" };
  }
  await afterChange(subjectId);
  return { ok: true, startsOn: plan.startsOn, endsOn: plan.endsOn, startsTomorrow: plan.startsOn !== (input.startsOn < today ? today : input.startsOn) };
}

/**
 * Ends a shift: from today (or tomorrow when today has answers on its anchors), days already lived keep their shifted times.
 * A shift still waiting in the outbox that has not been sent is simply removed; one the server holds is ended with an
 * end entry. Works offline.
 */
export async function endDayShift(subjectId: string, shift: DayShiftRow, nowMs: number = Date.now()): Promise<{ ok: boolean }> {
  const today = lagosLocalDate(nowMs);
  // Still only on this phone: take it back.
  if ((await removePendingRow(shift.id).catch(() => false)) === true) {
    await afterChange(subjectId);
    return { ok: true };
  }
  const hasAnswers = await anchorDayHasAnswers(subjectId, Object.keys(shift.offsets), today);
  let from = effectiveFromFor(today, hasAnswers);
  if (from < shift.starts_on) from = shift.starts_on;
  try {
    await enqueue({ kind: "day_shift_end", subjectId, payload: { shift_id: shift.id, cancelled_from: from } });
  } catch {
    return { ok: false };
  }
  await afterChange(subjectId);
  return { ok: true };
}
