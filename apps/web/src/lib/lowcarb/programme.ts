import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import { lowCarbCheckins, type LowCarbCheckinLine, type LowCarbConfig } from "@tarragon/clinical/lowcarb-programme";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";

/**
 * The clinician's view of the low-carbohydrate programme for one patient (S50b, spec 6.10). One audited database function returns the enrolment, its
 * history and the signed rules; the check-in lines are computed by the pure function in @tarragon/clinical from readings read through the audited,
 * tie-gated vitals read (INV-10, INV-12). A refusal is "not available to you", never "no programme". No model is involved (INV-01).
 */

export const LOWCARB_PROTOCOL_CODE = "t2d_lowcarb_deprescribing";
const DAY_MS = 86_400_000;

const enrolmentSchema = z.object({
  id: z.string(),
  status: z.enum(["offered", "active", "paused", "stopped", "declined", "expired"]),
  offered_at: z.string(),
  accepted_at: z.string().nullable(),
  paused_at: z.string().nullable(),
  pause_code: z.string().nullable(),
  stopped_at: z.string().nullable(),
  stop_code: z.string().nullable(),
  supervision_accepted: z.boolean(),
  last_medicine_review_at: z.string().nullable(),
  config_version: z.number(),
});
const eventSchema = z.object({ kind: z.string(), code: z.string().nullable(), note: z.string().nullable().optional(), at: z.string() });
const programmeSchema = z.object({
  can_act: z.boolean(),
  guard_open: z.boolean(),
  config_signed: z.boolean(),
  config: z.record(z.string(), z.unknown()).nullable(),
  enrolment: enrolmentSchema.nullable(),
  events: z.array(eventSchema),
});

export type LowCarbProgramme = z.infer<typeof programmeSchema>;
export type LowCarbEnrolment = z.infer<typeof enrolmentSchema>;

export type LowCarbProgrammeResult =
  | { status: "ok"; programme: LowCarbProgramme; checkins: LowCarbCheckinLine[] | null }
  | { status: "denied" }
  | { status: "error"; message: string };

type Client = SupabaseClient<Database>;

export function configFrom(programme: LowCarbProgramme): LowCarbConfig | null {
  // The database only returns a SIGNED, validated config row; the cast is the shape the migration's validator enforces.
  return programme.config === null ? null : (programme.config as unknown as LowCarbConfig);
}

export async function loadLowCarbProgramme(supabase: Client, patientId: string, now: Date = new Date()): Promise<LowCarbProgrammeResult> {
  const { data, error } = await supabase.rpc("lowcarb_programme_for_patient", { p_patient: patientId });
  if (error) return error.code === "42501" ? { status: "denied" } : { status: "error", message: "Could not read the programme." };
  const parsed = programmeSchema.safeParse(data);
  if (!parsed.success) return { status: "error", message: "The programme record could not be read." };
  const programme = parsed.data;
  const config = configFrom(programme);
  if (config === null || programme.enrolment === null) return { status: "ok", programme, checkins: null };

  const since = new Date(now.getTime() - 14 * DAY_MS).toISOString();
  const [glucose, ketones, weight] = await Promise.all([
    readPatientVitalsAudited(supabase, patientId, { vitalType: "glucose", since, limit: 500 }),
    readPatientVitalsAudited(supabase, patientId, { vitalType: "ketones", since, limit: 500 }),
    readPatientVitalsAudited(supabase, patientId, { vitalType: "weight", since, limit: 100 }),
  ]);
  // An unreadable reading list is NOT "no check-ins": say so instead of showing every line overdue.
  if (glucose.status !== "ok" || ketones.status !== "ok" || weight.status !== "ok") return { status: "ok", programme, checkins: null };
  const readings = [
    ...glucose.rows.map((r) => ({ metric: "glucose" as const, at: r.taken_at })),
    ...ketones.rows.map((r) => ({ metric: "ketones" as const, at: r.taken_at })),
    ...weight.rows.map((r) => ({ metric: "weight" as const, at: r.taken_at })),
  ];
  return { status: "ok", programme, checkins: lowCarbCheckins({ now: now.toISOString(), readings }, config) };
}

/** Plain words for the codes the database stores. The clinician sees these; the patient never does. */
const PAUSE_WORDS: Record<string, string> = {
  low_glucose: "A low sugar reading",
  high_ketones: "A high ketone reading",
  triage_event: "A red or amber result from the safety check",
  no_longer_eligible: "No longer meets the programme screen",
  clinician: "Paused by a clinician",
};
const STOP_WORDS: Record<string, string> = {
  patient_choice: "The patient chose to stop",
  clinician: "Stopped by a clinician",
  repeated_pauses: "Paused too often in 30 days",
  check_ins_lapsed: "Check-ins lapsed",
  no_longer_eligible: "No longer meets the programme screen",
  withdrawn: "The offer was withdrawn",
};
const REVIEW_WORDS: Record<string, string> = {
  average_glucose_low: "Average sugar is below the review line",
  low_normal_glucose: "A reading below the review line",
};

export function describeLowCarbEvent(kind: string, code: string | null): string {
  switch (kind) {
    case "offered":
      return "Programme offered";
    case "accepted":
      return "Patient accepted";
    case "declined":
      return "Patient declined";
    case "resumed":
      return "Resumed by a clinician";
    case "expired":
      return "Offer lapsed";
    case "review_completed":
      return "Medicine review recorded";
    case "paused":
      return `Paused: ${PAUSE_WORDS[code ?? ""] ?? "see the record"}`;
    case "stopped":
      return `Stopped: ${STOP_WORDS[code ?? ""] ?? "see the record"}`;
    case "review_raised": {
      const c = code ?? "";
      if (c.startsWith("paused_")) return `Medicine review opened after a pause (${PAUSE_WORDS[c.slice(7)] ?? "see the record"})`;
      if (c.startsWith("stopped_")) return "Medicine review opened after the programme stopped";
      return `Medicine review opened: ${REVIEW_WORDS[c] ?? "see the record"}`;
    }
    default:
      return kind;
  }
}

export function describeLowCarbReasons(reasons: readonly string[]): string[] {
  const words: Record<string, string> = {
    rules_unavailable: "The programme rules have not been signed yet.",
    age_unknown: "No date of birth is on file.",
    under_age: "Under 18.",
    not_type_2: "Not type 2 diabetes.",
    type_unconfirmed: "Type 2 diabetes has not been confirmed by a clinician.",
    pregnancy_or_postnatal: "Pregnancy or the year after a birth.",
    health_condition: "A health condition on record rules this out.",
    eating_disorder_screen: "A positive eating-disorder screen.",
    recent_severe_low_sugar: "A severe low sugar reading in the look-back period.",
    admission_not_ruled_out: "Recent severe low sugar or hospital admission is not ruled out.",
    recent_triage_event: "A red or amber result in the last few days. Try again later.",
    condition_type_1_diabetes: "A type 1 diabetes record.",
    condition_kidney_disease: "Kidney disease on record.",
    condition_pancreatitis: "Pancreatitis on record.",
    condition_liver_disease: "Liver disease on record.",
    condition_ketoacidosis_history: "A history of ketoacidosis.",
    medicine_sglt2_inhibitor: "Takes an SGLT2 inhibitor.",
    supervision_insulin: "Takes insulin: a doctor must accept supervision.",
    supervision_sulfonylurea: "Takes a sulfonylurea: a doctor must accept supervision.",
    supervision_meglitinide: "Takes a meglitinide: a doctor must accept supervision.",
    supervision_unclassified: "Takes a medicine that looks diabetes-related but is not on the platform's list: a doctor must accept supervision.",
    none: "",
  };
  return reasons.map((r) => words[r] ?? "This person does not meet the programme screen.").filter((w) => w !== "");
}

export type { Json };
