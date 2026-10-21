import { lowCarbCheckins, parseLowCarbGate, type LowCarbCheckinLine, type LowCarbConfig } from "@tarragon/clinical/lowcarb-programme";
import type { MessageKey } from "@tarragon/i18n";
import { isOfflineError } from "./care-changes";
import { supabase } from "./supabase";

/**
 * The patient's side of the supported eating programme on the phone (S50b). Same database doors as the web screen:
 * `my_lowcarb_gate` (ok or unavailable, ONE identical answer for every closed case), `respond_lowcarb_offer` and `stop_lowcarb_programme`.
 *
 * Two rules this file exists to keep:
 *  - A failed load is an ERROR, never "unavailable". Unavailable means the database answered and the person has nothing here; an error means we
 *    could not ask. Showing an error as "nothing here" would hide the low-sugar card and the Stop button from someone on the programme.
 *  - Nothing clinical is cached. Answering and stopping need a connection and are never queued; readings are logged through the existing offline
 *    outbox on the vitals screen, which is the only place this app holds a reading until it syncs.
 */

export type LowCarbStatus = "offered" | "active" | "paused";

export type LowCarbView =
  | { kind: "unavailable" }
  | { kind: "error"; offline: boolean }
  | { kind: "ok"; enrolmentId: string; status: LowCarbStatus; lowLine: number | null; checkins: LowCarbCheckinLine[] | null };

type Rule = { per_week: number; max_gap_days: number };
const isRule = (v: unknown): v is Rule =>
  typeof v === "object" && v !== null && typeof (v as Rule).per_week === "number" && typeof (v as Rule).max_gap_days === "number";

/** Reads the `ok` payload. Anything that does not have every field is "unavailable": a half-readable answer is never shown as a programme. */
export function parseLowCarbOk(data: unknown): { enrolmentId: string; status: LowCarbStatus; lowLine: number | null; rules: { glucose: Rule; ketones: Rule; weight: Rule } | null } | null {
  if (parseLowCarbGate(data).state !== "ok") return null;
  const o = data as Record<string, unknown>;
  const ci = o.check_ins as Record<string, unknown> | undefined;
  if (typeof o.enrolment_id !== "string" || (o.status !== "offered" && o.status !== "active" && o.status !== "paused")) return null;
  // With no signed rules live the numbers are null; someone already on the programme still gets the screen (without the number or the check-in lines).
  const lowLine = typeof o.low_glucose_below_mmol === "number" ? o.low_glucose_below_mmol : null;
  const rules = ci && isRule(ci.glucose) && isRule(ci.ketones) && isRule(ci.weight) ? { glucose: ci.glucose, ketones: ci.ketones, weight: ci.weight } : null;
  return { enrolmentId: o.enrolment_id, status: o.status, lowLine, rules };
}

export async function loadLowCarb(patientId: string, now: Date = new Date()): Promise<LowCarbView> {
  const gate = await supabase.rpc("my_lowcarb_gate");
  if (gate.error) return { kind: "error", offline: isOfflineError(gate.error) };
  // Not an ok answer: the one closed answer. An ok answer we cannot read is an ERROR, never "nothing here".
  if (parseLowCarbGate(gate.data).state !== "ok") return { kind: "unavailable" };
  const ok = parseLowCarbOk(gate.data);
  if (!ok) return { kind: "error", offline: false };

  let checkins: LowCarbCheckinLine[] | null = null;
  if (ok.status === "active" && ok.rules) {
    const since = new Date(now.getTime() - 14 * 86_400_000).toISOString();
    const rows = await supabase
      .from("vitals_readings")
      .select("vital_type, taken_at")
      .eq("patient_id", patientId)
      .in("vital_type", ["glucose", "ketones", "weight"])
      .gte("taken_at", since)
      .order("taken_at", { ascending: false })
      .limit(600);
    // An unreadable reading list is not "no check-ins": show no lines rather than a wall of "overdue".
    if (!rows.error && Array.isArray(rows.data)) {
      const readings = rows.data.flatMap((r) =>
        r.vital_type === "glucose" || r.vital_type === "ketones" || r.vital_type === "weight" ? [{ metric: r.vital_type, at: r.taken_at }] : [],
      );
      checkins = lowCarbCheckins({ now: now.toISOString(), readings }, { check_ins: ok.rules } as unknown as LowCarbConfig);
    }
  }
  return { kind: "ok", enrolmentId: ok.enrolmentId, status: ok.status, lowLine: ok.lowLine, checkins };
}

/** For the quiet link on the medicines screen: true only when the database says ok. An error shows no link (the screen itself asks again). */
export async function hasLowCarbProgramme(): Promise<boolean> {
  const { data, error } = await supabase.rpc("my_lowcarb_gate");
  // Only the database's own ok decides the link, so a half-readable ok still shows it (the screen then says it could not load).
  return !error && parseLowCarbGate(data).state === "ok";
}

export type LowCarbAnswer = { ok: true; outcome: "active" | "declined" | "unavailable" | "stopped" } | { ok: false; key: MessageKey };

export async function respondToLowCarbOffer(enrolmentId: string, accept: boolean): Promise<LowCarbAnswer> {
  if (!enrolmentId) return { ok: false, key: "lowcarb.error.action" };
  const { data, error } = await supabase.rpc("respond_lowcarb_offer", { p_enrolment: enrolmentId, p_accept: accept });
  if (error) return { ok: false, key: isOfflineError(error) ? "lowcarb.offline" : "lowcarb.error.action" };
  if (data === "active" || data === "declined" || data === "unavailable") return { ok: true, outcome: data };
  return { ok: false, key: "lowcarb.error.action" };
}

export async function stopLowCarbProgramme(enrolmentId: string): Promise<LowCarbAnswer> {
  if (!enrolmentId) return { ok: false, key: "lowcarb.error.action" };
  const { error } = await supabase.rpc("stop_lowcarb_programme", { p_enrolment: enrolmentId });
  if (error) return { ok: false, key: isOfflineError(error) ? "lowcarb.offline" : "lowcarb.error.action" };
  return { ok: true, outcome: "stopped" };
}

/**
 * Which cards the screen shows for a view. Pure, so the rules are tested: an error is its own state and never "unavailable"; the low-sugar card, the contact
 * card and the Stop button show for anyone on the programme (active or paused), never for a bare offer, and never depend on anything but the database's answer.
 */
export function lowCarbPanels(view: LowCarbView | null): {
  loading: boolean;
  error: boolean;
  unavailable: boolean;
  offer: boolean;
  checkin: boolean;
  paused: boolean;
  lowCard: boolean;
  contact: boolean;
  stop: boolean;
} {
  const ok = view?.kind === "ok" ? view : null;
  const running = ok !== null && ok.status !== "offered";
  return {
    loading: view === null,
    error: view?.kind === "error",
    unavailable: view?.kind === "unavailable",
    offer: ok?.status === "offered",
    checkin: ok?.status === "active",
    paused: ok?.status === "paused",
    lowCard: running,
    contact: running,
    stop: running,
  };
}
