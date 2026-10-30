import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@tarragon/shared";
import {
  lowCarbStopDraftArgs,
  proposeLowCarbMedicineReview,
  type LowCarbConfig,
  type LowCarbMedicine,
  type LowCarbReviewInput,
  type LowCarbReviewProposal,
  type LowCarbReviewResult,
  type LowCarbStepTable,
} from "@tarragon/clinical/lowcarb-programme";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";
import { readPatientMedicationsAudited } from "@/lib/clinical/medications-audited";
import { readPregnancySafety } from "@/lib/clinical/pregnancy-status";
import { LOWCARB_PROTOCOL_CODE } from "./programme";

/**
 * "Check the medicines" for someone on the low-carbohydrate programme (S50b, spec 6.10, INV-02, INV-01).
 *
 * Runs the pure evaluator under the signed-in clinician's own session on inputs read through audited, tie-gated reads. The only write is the
 * definer function `propose_care_plan_change`, which stores an unsigned DRAFT row that only a tied prescriber can sign, and only when the clinician
 * pressed "Create draft proposals". The platform proposes and never applies: no medicine, dose or time changes here, and nothing here is shown to
 * the patient. A dose change is never proposed as a number: the doctor decides the new dose.
 */

const MS_PER_DAY = 86_400_000;
const ADULT_AGE_YEARS = 18;
const DAYS_IN_YEAR = 365.25;
const OPEN_ALERT_STATUSES = ["open", "acknowledged", "snoozed"];

export type LowCarbReviewRun =
  | { kind: "result"; result: LowCarbReviewResult; created: { changeId: string; drugName: string }[]; notes: string[] }
  | { kind: "no_protocol" }
  | { kind: "error"; message: string };

const protocolRow = z.object({ id: z.string(), code: z.string(), version: z.number(), definition: z.record(z.string(), z.unknown()) });
const stepSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  match: z.object({ groups: z.array(z.string()) }),
  when: z.object({ avg_glucose_below_mmol: z.number().optional(), any_glucose_below_mmol: z.number().optional() }),
  action: z.enum(["stop", "review_dose"]),
  rationale: z.string(),
});
const tableSchema = z.object({ steps: z.array(stepSchema) });
const profileRow = z.object({ date_of_birth: z.string().nullable(), sex: z.string().nullable(), is_test: z.boolean().nullable() });
const alertRow = z.object({ level: z.string(), override_level: z.string().nullable(), status: z.string() });
const idResult = z.string();

type Client = SupabaseClient<Database>;
const fail = (message: string): LowCarbReviewRun => ({ kind: "error", message });

function ageYears(dob: string | null, now: Date): number | null {
  if (dob === null) return null;
  const t = Date.parse(dob);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / (DAYS_IN_YEAR * MS_PER_DAY));
}

function openTriageFrom(rows: { level: string; override_level: string | null; status: string }[]): LowCarbReviewInput["openTriage"] {
  const open = rows.filter((r) => OPEN_ALERT_STATUSES.includes(r.status)).map((r) => r.override_level ?? r.level);
  if (open.some((l) => l === "emergency" || l === "urgent_escalation")) return "red";
  return open.some((l) => l !== "routine") ? "amber" : "none";
}

export async function runLowCarbMedicineReview(
  supabase: Client,
  args: { patientId: string; config: LowCarbConfig; programmeActive: boolean; lastMedicineReviewAt: string | null; createDrafts: boolean },
  now: Date = new Date(),
): Promise<LowCarbReviewRun> {
  try {
    const { patientId, config } = args;
    // The approved table first. A draft is readable only by the people the database lets read it (the CMO, admin) and only ever drives a test patient.
    const approved = await supabase.rpc("get_approved_protocol", { p_code: LOWCARB_PROTOCOL_CODE });
    if (approved.error) return fail("Could not read the diabetes step table.");
    let protocolId: string | null = null;
    let table: LowCarbStepTable | null = null;
    if (approved.data !== null && approved.data !== undefined) {
      const row = protocolRow.safeParse(approved.data);
      const steps = row.success ? tableSchema.safeParse(row.data.definition) : null;
      if (!row.success || !steps?.success) return fail("The approved diabetes step table is malformed and was refused.");
      protocolId = row.data.id;
      table = { code: row.data.code, version: row.data.version, status: "approved", steps: steps.data.steps };
    } else {
      const draft = await supabase.from("protocols").select("id, code, version, definition").eq("code", LOWCARB_PROTOCOL_CODE).eq("status", "draft").maybeSingle();
      if (!draft.error && draft.data) {
        const steps = tableSchema.safeParse(draft.data.definition);
        if (steps.success) {
          protocolId = draft.data.id;
          table = { code: draft.data.code, version: draft.data.version, status: "draft", placeholder: true, steps: steps.data.steps };
        }
      }
    }
    if (table === null || protocolId === null) return { kind: "no_protocol" };

    const since = new Date(now.getTime() - config.medicine_review.window_days * MS_PER_DAY).toISOString();
    const [profile, glucose, meds, pregnancy, reproductive, alerts] = await Promise.all([
      supabase.from("profiles").select("date_of_birth, sex, is_test").eq("id", patientId).maybeSingle(),
      readPatientVitalsAudited(supabase, patientId, { vitalType: "glucose", since, limit: 500 }),
      readPatientMedicationsAudited(supabase, patientId, { active: true }),
      // OQ-555 follow-up: pregnancy and the latest delivery come as ONE three-state answer decided in the database, so an unreadable status is never "no record".
      readPregnancySafety(supabase, patientId),
      supabase.from("reproductive_health_profiles").select("life_stage").eq("patient_id", patientId).maybeSingle(),
      supabase.from("clinician_alerts").select("level, override_level, status").eq("patient_id", patientId).is("closed_at", null),
    ]);
    const prof = profileRow.safeParse(profile.data);
    if (profile.error || !prof.success) return fail("Could not read the patient.");
    const age = ageYears(prof.data.date_of_birth, now);
    if (age === null || age < ADULT_AGE_YEARS) return fail("This programme is for adults only.");
    if (glucose.status !== "ok") return fail(glucose.status === "denied" ? "Readings are not available to you." : "Could not read the readings.");
    if (meds.status !== "ok") return fail(meds.status === "denied" ? "Medicines are not available to you." : "Could not read the medicines.");
    if (alerts.error) return fail("Could not read the open alerts.");

    const alertRows: z.infer<typeof alertRow>[] = [];
    for (const raw of alerts.data ?? []) {
      const a = alertRow.safeParse(raw);
      if (!a.success) return fail("An open alert could not be read.");
      alertRows.push(a.data);
    }
    // Unknown is not "no": an unreadable pregnancy status, or a female patient with none on record, stops the proposal.
    // Any positive source is a yes, as in the database screen (pregnant, the postpartum life stage, a delivery inside the postnatal year). The status and the
    // delivery come from the database's three-state answer; a clinician who may not look gets 'unknown', which refuses.
    const postnatalYear = pregnancy.lastDeliveryDate ? now.getTime() - Date.parse(pregnancy.lastDeliveryDate) < config.eligibility.postnatal_months * 30.5 * MS_PER_DAY : false;
    const stage = reproductive.data?.life_stage;
    const anyYes = pregnancy.status === "pregnant" || stage === "pregnant" || stage === "postpartum" || postnatalYear;
    const anyRead = pregnancy.status !== "unknown" && pregnancy.hasRecord && !reproductive.error;
    const pregnancyStatus: LowCarbReviewInput["pregnancy"] = anyYes ? "yes" : prof.data.sex === "male" ? "no" : anyRead ? "no" : "unknown";

    const medicines: LowCarbMedicine[] = meds.rows
      .filter((m) => m.is_active && m.stopped_at === null && !m.superseded_at)
      .map((m) => ({ id: m.id, drugName: m.drug_name, dose: m.dose ?? "", frequency: m.frequency ?? "", clinicianIssued: m.source === "clinician", indication: m.indication ?? null }));
    const readings = glucose.rows.flatMap((r) => (r.glucose_mmol_l === null ? [] : [{ mmol: Number(r.glucose_mmol_l), at: r.taken_at }]));

    const input: LowCarbReviewInput = {
      now: now.toISOString(),
      isTest: prof.data.is_test === true,
      programmeActive: args.programmeActive,
      pregnancy: pregnancyStatus,
      openTriage: openTriageFrom(alertRows),
      glucose: readings,
      medicines,
      lastMedicineReviewAt: args.lastMedicineReviewAt,
    };
    const result = proposeLowCarbMedicineReview(input, table, config);
    const notes: string[] = [];
    const created: { changeId: string; drugName: string }[] = [];
    if (result.kind === "review" && args.createDrafts) {
      const snapshot = {
        now: input.now,
        protocol: { code: table.code, version: table.version, status: table.status },
        config_review: config.medicine_review,
        triggers: result.triggers,
        reading_count: result.readingCount,
        average_glucose: result.averageGlucose,
        medicines,
      };
      for (const p of result.proposals.filter((x: LowCarbReviewProposal) => x.proposable)) {
        const a = lowCarbStopDraftArgs(p, patientId, protocolId, snapshot);
        const saved = await supabase.rpc("propose_care_plan_change", {
          p_patient: a.p_patient,
          p_kind: a.p_kind,
          p_proposal: a.p_proposal as unknown as Json,
          p_rationale: a.p_rationale,
          p_proposed_by: a.p_proposed_by,
          p_protocol_id: a.p_protocol_id,
          p_engine_inputs: a.p_engine_inputs as unknown as Json,
        });
        if (saved.error) {
          notes.push(`${p.drugName}: ${saved.error.message}`);
          continue;
        }
        const id = idResult.safeParse(saved.data);
        if (id.success) created.push({ changeId: id.data, drugName: p.drugName });
        else notes.push(`${p.drugName}: the draft could not be saved.`);
      }
    }
    return { kind: "result", result, created, notes };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not check the medicines.");
  }
}

export const REVIEW_STOP_WORDS: Record<string, string> = {
  protocol_not_approved_for_real_patient: "The diabetes step table has not been approved, so no medicine suggestion is made for a real patient. Review the medicines by hand.",
  programme_not_active: "The programme is not running.",
  pregnancy_or_unknown: "Pregnancy is present or could not be checked, so no suggestion is made.",
  open_red_triage: "There is an open red alert. Deal with that first.",
  open_amber_triage: "There is an open amber alert. Deal with that first.",
  too_few_readings: "Too few sugar readings in the last week to suggest anything.",
  step_table_invalid: "The diabetes step table names a medicine group that does not exist, so no suggestion is made. Fix the table and review the medicines by hand.",
  no_trigger: "Sugars are not low enough for a medicine suggestion. The standing review is not due yet.",
};

export const REVIEW_TRIGGER_WORDS: Record<string, string> = {
  average_glucose_low: "Average sugar over the last week is below the review line.",
  a_low_reading: "A low sugar reading in the last week.",
  standing_review_due: "The standing medicine review is due.",
};
