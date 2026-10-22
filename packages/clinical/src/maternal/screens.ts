import type { BirthPlanFlags } from "./contractions";
import type { KickEvaluation } from "./kick-counter";
import type { ContractionEvaluation, Contraction } from "./contractions";

/**
 * Pure helpers shared by the web and phone pregnancy screens (S67 follow-up, OQ-346). No clock, no I/O, no clinical number:
 * thresholds stay in the PROPOSED `maternal.rules` config and the rules in the sibling files. This file only shapes what a screen
 * shows and what it writes.
 */

/** Plan-note money: whole naira typed by the person, stored as integer kobo (a note, never a balance, INV-09/INV-15). */
export function nairaTextToKobo(text: string): { ok: true; kobo: number | null } | { ok: false } {
  const cleaned = text.replace(/[\s,]/g, "").replace(/^₦/, "");
  if (cleaned === "") return { ok: true, kobo: null };
  if (!/^\d{1,10}$/.test(cleaned)) return { ok: false };
  const kobo = Number(cleaned) * 100;
  return kobo <= 100_000_000_000 ? { ok: true, kobo } : { ok: false };
}

/** Kobo back to whole-naira text for the form. */
export function koboToNairaText(kobo: number | null | undefined): string {
  return typeof kobo === "number" && Number.isFinite(kobo) ? String(Math.round(kobo / 100)) : "";
}

/** E.164 only (`+` then 8 to 15 digits, not starting 0). Empty means "not given". Spaces and dashes are tolerated and removed. */
export function phoneToE164(text: string): { ok: true; phone: string | null } | { ok: false } {
  const cleaned = text.replace(/[\s-]/g, "");
  if (cleaned === "") return { ok: true, phone: null };
  return /^\+[1-9][0-9]{7,14}$/.test(cleaned) ? { ok: true, phone: cleaned } : { ok: false };
}

export interface BirthPlanRowLike {
  long_journey: boolean;
  previous_fast_labour: boolean;
  previous_births: number;
}

/** What the contraction timer reads from the birth plan (it picks the earlier pattern). Null when there is no plan. */
export function birthPlanFlags(plan: BirthPlanRowLike | null | undefined): BirthPlanFlags | null {
  if (!plan) return null;
  return { longJourney: plan.long_journey, previousFastLabour: plan.previous_fast_labour, previousBirths: plan.previous_births };
}

export interface PregnancyContentRow {
  kind: string;
  week: number | null;
  title: string;
  body_text: string;
  review_state: string;
  version: number;
}

export type WeekCardState =
  | { kind: "unknown_week" }
  | { kind: "coming_soon"; week: number }
  | { kind: "content"; week: number; title: string; body: string };

/**
 * The week card. Only a row the CMO has marked reviewed is ever shown (the database also refuses to return a draft to a patient;
 * this is the second check). With no reviewed row for the week the answer is "coming soon" and nothing is invented.
 */
export function weekCardState(week: number | null, rows: readonly PregnancyContentRow[]): WeekCardState {
  if (week === null) return { kind: "unknown_week" };
  const match = rows
    .filter((r) => r.kind === "week" && r.week === week && r.review_state === "cmo_reviewed")
    .sort((a, b) => b.version - a.version)[0];
  return match ? { kind: "content", week, title: match.title, body: match.body_text } : { kind: "coming_soon", week };
}

export type VisitStatus = "scheduled" | "completed" | "missed" | "cancelled";
export interface AntenatalVisitRow {
  id: string;
  visit_number: number | null;
  target_week: number | null;
  gestational_week_at_visit: number | null;
  status: VisitStatus;
  /** Set when the visit is booked as an appointment. */
  appointment_id?: string | null;
}
export interface ScheduleEntry {
  id: string;
  visitNumber: number;
  week: number | null;
  status: VisitStatus;
  /** A booked appointment exists for this visit. */
  booked: boolean;
}

/**
 * Visits in order, from the generated rows. This invents no rule about lateness: "missed" is shown only when the server's own status
 * says so, and a planned visit is shown as "due around week N" or "booked". Any lateness threshold would have to come from the
 * PROPOSED config, so there is none here.
 */
export function scheduleEntries(rows: readonly AntenatalVisitRow[]): ScheduleEntry[] {
  return rows
    .map((r, index): ScheduleEntry => {
      const week = r.target_week ?? r.gestational_week_at_visit;
      return {
        id: r.id,
        visitNumber: r.visit_number ?? index + 1,
        week,
        status: r.status,
        booked: typeof r.appointment_id === "string" && r.appointment_id.length > 0,
      };
    })
    .sort((a, b) => a.visitNumber - b.visitNumber);
}

/** The words a finished kick session earns, as the stored result. */
export function kickResultForStorage(evaluation: Pick<KickEvaluation, "state">): "target_reached" | "contact_today" | "stopped" {
  return evaluation.state === "counting" ? "stopped" : evaluation.state;
}

/** Contractions as the stored timings: seconds from the first start, and duration in seconds. */
export function contractionTimings(contractions: readonly Contraction[], startedAtMs: number, nowMs: number): { s: number; d: number }[] {
  return contractions
    .map((c) => ({
      s: Math.max(0, Math.round((c.startMs - startedAtMs) / 1000)),
      d: Math.max(0, Math.round(((c.endMs ?? nowMs) - c.startMs) / 1000)),
    }))
    .slice(0, 300);
}

/** The one place a screen decides which fixed card to show for a contraction evaluation. Never a "wait" state. */
export function contractionCard(evaluation: Pick<ContractionEvaluation, "state" | "reason">): "none" | "go_now_sign" | "go_now_pattern" {
  if (evaluation.state !== "go_now") return "none";
  return evaluation.reason === "pattern" ? "go_now_pattern" : "go_now_sign";
}

export interface BirthPlanForm {
  place: string;
  transport: string;
  /** Whole naira as typed. */
  money: string;
  donorName: string;
  donorPhone: string;
  escortName: string;
  escortPhone: string;
  longJourney: boolean;
  previousFastLabour: boolean;
  previousBirths: string;
}

export interface BirthPlanFields {
  place_of_birth: string | null;
  transport_plan: string | null;
  money_plan_kobo: number | null;
  money_plan_note: string | null;
  blood_donor_name: string | null;
  blood_donor_phone: string | null;
  escort_name: string | null;
  escort_phone: string | null;
  long_journey: boolean;
  previous_fast_labour: boolean;
  previous_births: number;
}

/** Form text to the stored plan row. The money is a plan note in kobo (never a balance); phones must be E.164 or empty. */
export function buildBirthPlanFields(
  form: BirthPlanForm,
  /** The plan already saved, so a save from this form keeps the note it holds instead of writing null over it. */
  existing?: Pick<BirthPlanFields, "money_plan_note"> | null,
): { ok: true; plan: BirthPlanFields } | { ok: false; errors: { money: boolean; donorPhone: boolean; escortPhone: boolean } } {
  const money = nairaTextToKobo(form.money);
  const donor = phoneToE164(form.donorPhone);
  const escort = phoneToE164(form.escortPhone);
  if (!money.ok || !donor.ok || !escort.ok) return { ok: false, errors: { money: !money.ok, donorPhone: !donor.ok, escortPhone: !escort.ok } };
  const births = Math.min(20, Math.max(0, Math.trunc(Number(form.previousBirths) || 0)));
  const clean = (v: string): string | null => v.trim() || null;
  return {
    ok: true,
    plan: {
      place_of_birth: clean(form.place),
      transport_plan: clean(form.transport),
      money_plan_kobo: money.kobo,
      money_plan_note: existing?.money_plan_note ?? null,
      blood_donor_name: clean(form.donorName),
      blood_donor_phone: donor.phone,
      escort_name: clean(form.escortName),
      escort_phone: escort.phone,
      long_journey: form.longJourney,
      previous_fast_labour: form.previousFastLabour,
      previous_births: births,
    },
  };
}

/** The saved plan back into form text. */
export function birthPlanToForm(plan: BirthPlanFields | null | undefined): BirthPlanForm {
  return {
    place: plan?.place_of_birth ?? "",
    transport: plan?.transport_plan ?? "",
    money: koboToNairaText(plan?.money_plan_kobo),
    donorName: plan?.blood_donor_name ?? "",
    donorPhone: plan?.blood_donor_phone ?? "",
    escortName: plan?.escort_name ?? "",
    escortPhone: plan?.escort_phone ?? "",
    longJourney: plan?.long_journey ?? false,
    previousFastLabour: plan?.previous_fast_labour ?? false,
    previousBirths: String(plan?.previous_births ?? 0),
  };
}
