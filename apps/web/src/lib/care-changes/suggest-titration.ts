import { z } from "zod";
import {
  proposalToChangeArgs,
  proposeTitration,
  validateProtocolDefinition,
  type TitrationInput,
  type TitrationMedication,
  type TitrationReading,
  type TitrationResult,
  type TitrationStopReason,
} from "@tarragon/clinical/titration";
import type { Json } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";
import { readPatientMedicationsAudited } from "@/lib/clinical/medications-audited";
import { readMedicationDoseLogAudited } from "@/lib/clinical/dose-log";
import { readWeeklyAdherence } from "@/lib/clinical/weekly-adherence";

/**
 * "Suggest next step" for a patient's hypertension treatment (S24, spec 6.3, safety case 10).
 *
 * Runs the pure evaluator in @tarragon/clinical under the signed-in clinician's own session. Every input is read through an
 * audited, tie-gated read (INV-10, INV-12): a refusal is an error, never "no data". The only write is the definer function
 * `propose_care_plan_change`, which stores a DRAFT row that only a tied prescriber can sign; nothing here touches the record.
 * No model is involved (INV-01).
 */

export const HYPERTENSION_PROTOCOL_CODE = "htn_hearts_ng";
const MS_PER_DAY = 86_400_000;
const DAYS_IN_YEAR = 365.25;
/** How far back stopped medicines, skipped-dose reasons and the last change are looked for. A look-back, not a clinical threshold. */
const LOOKBACK_DAYS = 90;
/** Words that mark a stopped medicine or a skipped dose as a side effect, in the reasons clinicians and patients type. */
const ADULT_AGE_YEARS = 18;
const SIDE_EFFECT_WORDS = /side.?effect|adverse|reaction|intoleran|cough|swell|dizz|rash/i;
const OPEN_ALERT_STATUSES = ["open", "acknowledged", "snoozed"];

export type SuggestTitrationResult =
  | { kind: "proposed"; changeId: string; result: Extract<TitrationResult, { kind: "proposal" }> }
  | { kind: "no_proposal"; reasons: TitrationStopReason[] }
  | { kind: "no_protocol" }
  | { kind: "error"; message: string };

const protocolRow = z.object({ id: z.string(), code: z.string(), version: z.number(), definition: z.record(z.string(), z.unknown()) });
const vitalRow = z.object({
  systolic: z.number().nullable(),
  diastolic: z.number().nullable(),
  taken_at: z.string(),
  validation_status: z.string(),
});
const medRow = z.object({
  id: z.string(),
  drug_name: z.string(),
  dose: z.string().nullable(),
  frequency: z.string().nullable(),
  source: z.string(),
  is_active: z.boolean(),
  created_at: z.string(),
  stopped_at: z.string().nullable(),
  stopped_reason: z.string().nullable(),
  superseded_at: z.string().nullable().optional(),
});
const profileRow = z.object({ date_of_birth: z.string().nullable(), sex: z.string().nullable(), is_test: z.boolean().nullable() });
const alertRow = z.object({ level: z.string(), override_level: z.string().nullable(), status: z.string() });
const bpTarget = z.object({ systolic: z.number(), diastolic: z.number() });
const idResult = z.string();

const fail = (message: string): SuggestTitrationResult => ({ kind: "error", message });

function ageYears(dob: string | null, now: Date): number | null {
  if (dob === null) return null;
  const t = Date.parse(dob);
  return Number.isNaN(t) ? null : Math.floor((now.getTime() - t) / (DAYS_IN_YEAR * MS_PER_DAY));
}

/** The blood pressure target the clinician recorded on an active care plan: their number, not one this code chooses. */
function targetFrom(plans: { target_ranges: Json; status: string }[]): { systolic: number; diastolic: number } | null {
  for (const plan of plans) {
    if (plan.status !== "active") continue;
    const ranges = plan.target_ranges as Record<string, unknown> | null;
    const bp = ranges?.blood_pressure as Record<string, unknown> | undefined;
    const parsed = bpTarget.safeParse({ systolic: bp?.systolic_max ?? bp?.systolic, diastolic: bp?.diastolic_max ?? bp?.diastolic });
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** The worst open alert level, as the evaluator's three-state triage input. An emergency or urgent alert is red. */
function openTriageFrom(rows: { level: string; override_level: string | null; status: string }[]): TitrationInput["openTriage"] {
  const open = rows.filter((r) => OPEN_ALERT_STATUSES.includes(r.status)).map((r) => r.override_level ?? r.level);
  if (open.some((l) => l === "emergency" || l === "urgent_escalation")) return "red";
  return open.some((l) => l !== "routine") ? "amber" : "none";
}

export async function suggestTitration(patientId: string): Promise<SuggestTitrationResult> {
  try {
    const supabase = await createClient();

    const proto = await supabase.rpc("get_approved_protocol", { p_code: HYPERTENSION_PROTOCOL_CODE });
    if (proto.error) return fail("Could not read the protocol.");
    if (proto.data === null || proto.data === undefined) return { kind: "no_protocol" };
    const parsedProto = protocolRow.safeParse(proto.data);
    if (!parsedProto.success) return fail("The protocol could not be read.");
    // The function returns approved rows only; the definition's own status is aligned to that row, never taken from the JSON.
    const checked = validateProtocolDefinition({
      ...parsedProto.data.definition,
      code: parsedProto.data.code,
      version: parsedProto.data.version,
      status: "approved",
    });
    if (!checked.ok) return fail(`The approved protocol is malformed and was refused: ${checked.errors.join("; ")}`);
    const protocol = checked.definition;

    const now = new Date();
    const since = new Date(now.getTime() - protocol.params.windowDays * MS_PER_DAY).toISOString();
    const lookback = new Date(now.getTime() - LOOKBACK_DAYS * MS_PER_DAY).toISOString();

    const [profile, vitals, meds, adherence, doseLog, pregnancy, plans, alerts] = await Promise.all([
      supabase.from("profiles").select("date_of_birth, sex, is_test").eq("id", patientId).maybeSingle(),
      readPatientVitalsAudited(supabase, patientId, { vitalType: "blood_pressure", since, limit: 500, ascending: false }),
      readPatientMedicationsAudited(supabase, patientId),
      readWeeklyAdherence(supabase, patientId),
      readMedicationDoseLogAudited(supabase, patientId),
      supabase.from("patient_pregnancy").select("is_pregnant").eq("patient_id", patientId).maybeSingle(),
      supabase.from("care_plans").select("target_ranges, status").eq("patient_id", patientId).order("created_at", { ascending: false }),
      supabase.from("clinician_alerts").select("level, override_level, status").eq("patient_id", patientId).is("closed_at", null),
    ]);

    if (profile.error || !profile.data) return fail("Could not read the patient.");
    const prof = profileCheck(profile.data);
    if (!prof) return fail("The patient record could not be read.");
    // The evaluator has no age rule, and a protocol written for adults must never be applied to a child or to a patient whose age is unknown.
    // 18 is the platform's adult age (the triage rule set's minAdultAgeYears and the written-question gate); an unknown date of birth is not an adult.
    const age = ageYears(prof.date_of_birth, now);
    if (age === null || age < ADULT_AGE_YEARS) {
      return fail("Next-step suggestions are for adults only. This patient is under 18 or has no date of birth on file, so the care team decides by hand.");
    }
    if (vitals.status !== "ok") return fail(vitals.status === "denied" ? "Readings are not available to you." : "Could not read the readings.");
    if (meds.status !== "ok") return fail(meds.status === "denied" ? "Medicines are not available to you." : "Could not read the medicines.");
    if (plans.error) return fail("Could not read the care plan.");
    if (alerts.error) return fail("Could not read the open alerts.");

    const target = targetFrom(plans.data ?? []);
    if (target === null) return fail("No blood pressure target is recorded on an active care plan. Set one first.");

    const readings: TitrationReading[] = [];
    for (const raw of vitals.rows) {
      const v = vitalRow.safeParse(raw);
      if (!v.success) return fail("A reading could not be read.");
      if (v.data.systolic === null || v.data.diastolic === null) continue;
      readings.push({ systolic: v.data.systolic, diastolic: v.data.diastolic, takenAt: v.data.taken_at, validated: v.data.validation_status === "valid" });
    }

    const medRows: z.infer<typeof medRow>[] = [];
    for (const raw of meds.rows) {
      const m = medRow.safeParse(raw);
      if (!m.success) return fail("A medicine could not be read.");
      medRows.push(m.data);
    }
    const current: TitrationMedication[] = medRows
      .filter((m) => m.is_active && m.stopped_at === null && !m.superseded_at)
      .map((m) => ({
        id: m.id,
        drugName: m.drug_name,
        dose: m.dose ?? "",
        frequency: m.frequency ?? "",
        startedAt: m.created_at,
        clinicianIssued: m.source === "clinician",
      }));
    // Any medicine started or stopped inside the look-back is a change; the evaluator applies the protocol's own review window to it.
    const changeTimes = medRows.flatMap((m) => [m.created_at, m.stopped_at]).filter((t): t is string => t !== null && t >= lookback);
    const lastChangeAt = changeTimes.length > 0 ? changeTimes.reduce((a, b) => (a > b ? a : b)) : null;

    // Side effects have no store of their own yet: a stopped medicine or a skipped dose whose reason names one is taken as reported.
    const stoppedForSideEffect = medRows.some((m) => m.stopped_reason !== null && (m.stopped_at ?? "") >= lookback && SIDE_EFFECT_WORDS.test(m.stopped_reason));
    const skippedForSideEffect =
      doseLog.status === "ok" && doseLog.rows.some((d) => d.logged_at >= lookback && d.reason !== null && SIDE_EFFECT_WORDS.test(d.reason));
    // An unreadable dose log is not "no side effects": it is treated as reported, so a person looks before anything is suggested.
    const sideEffectsReported = stoppedForSideEffect || skippedForSideEffect || doseLog.status !== "ok";

    const alertRows: z.infer<typeof alertRow>[] = [];
    for (const raw of alerts.data ?? []) {
      const a = alertRow.safeParse(raw);
      if (!a.success) return fail("An open alert could not be read.");
      alertRows.push(a.data);
    }

    // Unknown is not "no": a female patient with no pregnancy row, or an unreadable one, is unknown and stops the proposal.
    const pregnancyStatus: TitrationInput["patient"]["pregnancy"] =
      prof.sex === "male" ? "no" : pregnancy.error || !pregnancy.data ? "unknown" : pregnancy.data.is_pregnant ? "yes" : "no";

    const input: TitrationInput = {
      now: now.toISOString(),
      isTest: prof.is_test === true,
      patient: { ageYears: age, pregnancy: pregnancyStatus },
      target,
      readings,
      currentMedications: current,
      adherencePercent: adherence.status === "ok" ? adherence.adherence.percent : null,
      openTriage: openTriageFrom(alertRows),
      sideEffectsReported,
      lastChangeAt,
    };

    const result = proposeTitration(input, protocol);
    if (result.kind === "no_proposal") return result;

    const args = proposalToChangeArgs(result, patientId, parsedProto.data.id);
    const saved = await supabase.rpc("propose_care_plan_change", {
      p_patient: args.p_patient,
      p_kind: args.p_kind,
      p_proposal: args.p_proposal as unknown as Json,
      p_rationale: args.p_rationale,
      p_proposed_by: args.p_proposed_by,
      p_protocol_id: args.p_protocol_id,
      p_engine_inputs: args.p_engine_inputs as unknown as Json,
    });
    if (saved.error) return fail(saved.error.message);
    const id = idResult.safeParse(saved.data);
    if (!id.success) return fail("The draft could not be saved.");
    return { kind: "proposed", changeId: id.data, result };
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Could not suggest a next step.");
  }
}

function profileCheck(raw: unknown): z.infer<typeof profileRow> | null {
  const p = profileRow.safeParse(raw);
  return p.success ? p.data : null;
}
