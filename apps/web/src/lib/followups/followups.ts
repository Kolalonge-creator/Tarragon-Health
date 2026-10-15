import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";

/**
 * Two-tier model, items 3 and 4. Pure helpers and the Zod shapes for the monthly follow-up screens (clinician offers, the Member's
 * choice) and the pre-call summary. No clock and no I/O, so every rule here is unit tested. The numbers come from the versioned
 * PROPOSED configuration (`followups.policy`, `consultations.call_length`), never from this file.
 */

const TZ = "Africa/Lagos";
/** Lagos has no daylight saving: it is UTC+1 all year. */
const LAGOS_OFFSET = "+01:00";

export interface FollowupLimits {
  minSlots: number;
  maxSlots: number;
  leadHours: number;
  bulkMax: number;
  routineMin: number;
  routineMax: number;
}

export function followupLimits(): FollowupLimits {
  const offers = getProposedConfig<{ minSlots: number; maxSlots: number; minLeadMinutes: number; bulkMaxPatients: number }>("followups.policy").value;
  const length = getProposedConfig<{ routineMinutes: number; routineMinMinutes: number }>("consultations.call_length").value;
  return {
    minSlots: offers.minSlots,
    maxSlots: offers.maxSlots,
    leadHours: Math.ceil(offers.minLeadMinutes / 60),
    bulkMax: offers.bulkMaxPatients,
    routineMin: length.routineMinMinutes,
    routineMax: length.routineMinutes,
  };
}

/** "2026-10-13T09:30" typed in a datetime-local box means Lagos time. Returns an ISO instant, or null when it is not a real date and time. */
export function lagosLocalToIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:00${LAGOS_OFFSET}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  // reject a day that rolled over (31 February) or an hour out of range
  const back = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  if (back["year"] !== y || back["month"] !== mo || back["day"] !== d || back["hour"] !== h || back["minute"] !== mi) return null;
  return date.toISOString();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Tue 13 Oct, 09:30" in Lagos time. Built from fixed names so it reads the same on every machine (some ICU builds say "Sept"). */
export function formatLagos(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const y = Number(parts["year"]);
  const m = Number(parts["month"]);
  const d = Number(parts["day"]);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[m - 1]}, ${parts["hour"]}:${parts["minute"]}`;
}

export const uuidSchema = z.string().uuid();

export type OfferFormInput = { patients: string[]; times: string[]; kind: string; minutes: string };
export type OfferFormResult =
  | { ok: true; patients: string[]; starts: string[]; kind: "monthly" | "yearly_results"; minutes: number | null }
  | { ok: false; error: "no_members" | "too_many_members" | "times" | "bad_time" | "minutes" };

/** Parses the offer form. Blank time boxes are ignored; whatever is left must be 2 to 6 different, valid times. */
export function parseOfferForm(input: OfferFormInput, limits: FollowupLimits = followupLimits()): OfferFormResult {
  const patients = [...new Set(input.patients.map((p) => p.trim()).filter((p) => p.length > 0))];
  if (patients.length === 0 || !patients.every((p) => uuidSchema.safeParse(p).success)) return { ok: false, error: "no_members" };
  if (patients.length > limits.bulkMax) return { ok: false, error: "too_many_members" };
  const typed = input.times.map((x) => x.trim()).filter((x) => x.length > 0);
  const starts: string[] = [];
  for (const raw of typed) {
    const iso = lagosLocalToIso(raw);
    if (!iso) return { ok: false, error: "bad_time" };
    starts.push(iso);
  }
  const distinct = [...new Set(starts)];
  if (distinct.length < limits.minSlots || distinct.length > limits.maxSlots) return { ok: false, error: "times" };
  const kind = input.kind === "yearly_results" ? "yearly_results" : "monthly";
  let minutes: number | null = null;
  if (input.minutes.trim().length > 0) {
    const n = Number(input.minutes);
    if (!Number.isInteger(n) || n < limits.routineMin || n > limits.routineMax) return { ok: false, error: "minutes" };
    minutes = n;
  }
  return { ok: true, patients, starts: distinct.sort(), kind, minutes };
}

/** The database raises plain messages for its own refusals (SQLSTATE P0001); show those, and a generic line for anything else. */
export function describeFollowupError(error: { message?: string; code?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "P0001" && typeof error.message === "string" && error.message.length > 0 && error.message.length < 240) return error.message;
  if (error.code === "42501") return "You do not have access to do that.";
  return fallback;
}

// ----- shapes the database functions return --------------------------------------------------------------------------

export const dueRowSchema = z.object({
  patient_id: z.string().uuid(),
  first_name: z.string().nullable(),
  kind: z.enum(["due", "missed"]),
  entitlement_id: z.string().uuid(),
  month_index: z.number(),
  period_end: z.string(),
});
export type DueRow = z.infer<typeof dueRowSchema>;
export const dueListSchema = z.array(dueRowSchema);

export const sentOfferSchema = z.object({
  offer_id: z.string().uuid(),
  patient_id: z.string().uuid(),
  first_name: z.string().nullable(),
  status: z.enum(["open", "picked", "withdrawn", "expired"]),
  kind: z.enum(["monthly", "yearly_results"]),
  call_minutes: z.number(),
  expires_at: z.string(),
  longer_requested: z.boolean(),
  closed_reason: z.string().nullable(),
  booked_for: z.string().nullable(),
  slots: z.array(z.object({ starts_at: z.string(), state: z.string() })),
});
export type SentOffer = z.infer<typeof sentOfferSchema>;
export const sentOffersSchema = z.array(sentOfferSchema);

export const bulkResultSchema = z.object({
  offered: z.number(),
  results: z.array(z.object({ patient_id: z.string().uuid(), status: z.enum(["offered", "refused"]), reason: z.string().optional() })),
  fewer_times_than_people: z.boolean(),
});
export const singleOfferResultSchema = z.object({ status: z.literal("offered"), offer_id: z.string().uuid(), minutes: z.number(), slots: z.number() });

export const myFollowupsSchema = z.object({
  entitlement: z
    .object({
      current: z
        .object({ month_index: z.number(), state: z.string(), period_end: z.string(), appointment_id: z.string().uuid().nullable(), encounter_id: z.string().uuid().nullable().optional() })
        .nullable(),
      consumed: z.number(),
      lapsed: z.number(),
      remaining: z.number(),
    })
    .nullable(),
  offers: z.array(
    z.object({
      offer_id: z.string().uuid(),
      expires_at: z.string(),
      call_minutes: z.number(),
      kind: z.enum(["monthly", "yearly_results"]),
      longer_requested: z.boolean(),
      slots: z.array(z.object({ slot_id: z.string().uuid(), starts_at: z.string(), ends_at: z.string() })),
    }),
  ),
});
export type MyFollowups = z.infer<typeof myFollowupsSchema>;

export const pickResultSchema = z.object({
  status: z.enum(["booked", "unavailable", "expired", "picked", "withdrawn", "open"]),
  appointment_id: z.string().uuid().optional(),
  starts_at: z.string().optional(),
  minutes: z.number().optional(),
  encounter_id: z.string().uuid().nullable().optional(),
});
export type PickResult = z.infer<typeof pickResultSchema>;

/** What the Member sees for the open offer: only times still ahead, soonest first; an offer with none left reads as nothing waiting. */
export function visibleOfferSlots(offer: MyFollowups["offers"][number], now: Date): MyFollowups["offers"][number]["slots"] {
  return offer.slots.filter((s) => new Date(s.starts_at).getTime() > now.getTime()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

// ----- pre-call summary --------------------------------------------------------------------------------------------

const sectionObject = z.record(z.string(), z.unknown());
export const precallSchema = z.object({
  status: z.enum(["ok", "partial", "denied"]),
  encounter: z
    .object({
      id: z.string().uuid(),
      scheduled_at: z.string().nullable(),
      planned_minutes: z.number().nullable(),
      extended_minutes: z.number(),
      longer_requested: z.boolean(),
    })
    .optional(),
  since_last_call: z.string().nullable().optional(),
  since: z.string().optional(),
  summary: z
    .object({
      patient_first_name: z.string().nullable().optional(),
      medications: z
        .object({
          active: z.array(z.object({ id: z.string(), drug_name: z.string(), dose: z.string().nullable().optional(), frequency: z.string().nullable().optional() })),
          adherence: z.object({ percent: z.number().nullable().optional() }).passthrough().nullable().optional(),
        })
        .optional(),
      conditions: z.array(z.object({ condition_name: z.string(), status: z.string().nullable().optional() })).optional(),
      allergies: z.array(z.object({ allergen: z.string() })).optional(),
      pending_proposals: z.array(sectionObject).optional(),
    })
    .passthrough()
    .optional(),
  vitals_trend: z
    .array(
      z.object({
        type: z.string(),
        readings: z.number(),
        first_value: z.number().nullable(),
        last_value: z.number().nullable(),
        average: z.number().nullable(),
        average_diastolic: z.number().nullable().optional(),
      }),
    )
    .optional(),
  results_since: z.array(z.object({ id: z.string(), panel_code: z.string().nullable(), release_state: z.string(), received_at: z.string() })).optional(),
  medicines_started_since: z.array(z.object({ drug_name: z.string(), dose: z.string().nullable().optional(), created_at: z.string() })).optional(),
  medicine_changes_since: z.array(sectionObject).optional(),
  open_tasks: z.array(z.object({ type: z.string(), state: z.string(), due_at: z.string().nullable(), priority_class: z.number().nullable().optional() })).optional(),
});
export type Precall = z.infer<typeof precallSchema>;

export interface PrecallView {
  planned: number | null;
  extended: number;
  longerRequested: boolean;
  sinceLabel: { kind: "since"; when: string } | { kind: "none" };
  vitals: { type: string; count: number; first: string; last: string; average: string }[];
  results: { panel: string; when: string; state: string }[];
  medicines: { active: { name: string; dose: string }[]; adherencePercent: number | null; started: { name: string; dose: string }[]; changes: number };
  tasks: { type: string; when: string }[];
  conditions: string[];
  allergies: string[];
  proposals: number;
}

const num = (n: number | null | undefined): string => (n === null || n === undefined ? "-" : String(Math.round(n * 10) / 10));

/** The doctor's view, in the order they need it: what changed since the last call first. Nothing here is computed from a clock. */
export function buildPrecallView(p: Precall): PrecallView {
  const meds = p.summary?.medications;
  return {
    planned: p.encounter?.planned_minutes ?? null,
    extended: p.encounter?.extended_minutes ?? 0,
    longerRequested: p.encounter?.longer_requested ?? false,
    sinceLabel: p.since_last_call ? { kind: "since", when: formatLagos(p.since_last_call) } : { kind: "none" },
    vitals: (p.vitals_trend ?? []).map((v) => ({
      type: v.type.replace(/_/g, " "),
      count: v.readings,
      first: num(v.first_value),
      last: num(v.last_value),
      average: v.average_diastolic ? `${num(v.average)}/${num(v.average_diastolic)}` : num(v.average),
    })),
    results: (p.results_since ?? []).map((r) => ({ panel: r.panel_code ?? "-", when: formatLagos(r.received_at), state: r.release_state.replace(/_/g, " ") })),
    medicines: {
      active: (meds?.active ?? []).map((m) => ({ name: m.drug_name, dose: m.dose ?? "" })),
      adherencePercent: meds?.adherence?.percent ?? null,
      started: (p.medicines_started_since ?? []).map((m) => ({ name: m.drug_name, dose: m.dose ?? "" })),
      changes: (p.medicine_changes_since ?? []).length,
    },
    tasks: (p.open_tasks ?? []).map((k) => ({ type: k.type.replace(/_/g, " "), when: k.due_at ? formatLagos(k.due_at) : "-" })),
    conditions: (p.summary?.conditions ?? []).map((c) => c.condition_name),
    allergies: (p.summary?.allergies ?? []).map((a) => a.allergen),
    proposals: (p.summary?.pending_proposals ?? []).length,
  };
}

/** How many minutes a doctor may still add to this call, never negative. */
export function remainingExtension(maxTotal: number, alreadyAdded: number): number {
  return Math.max(0, maxTotal - alreadyAdded);
}

export function callLengthLimits(): { maxExtension: number } {
  return { maxExtension: getProposedConfig<{ maxExtensionMinutes: number }>("consultations.call_length").value.maxExtensionMinutes };
}
