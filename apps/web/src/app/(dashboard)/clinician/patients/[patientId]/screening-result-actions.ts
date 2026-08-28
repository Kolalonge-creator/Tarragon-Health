"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { screeningResultSchema, type ScreeningResultInput } from "@/lib/validation/screening-result";
import { computeNonHdl } from "@/lib/lipids/analytes";
import { flagCvRiskEscalations } from "@/lib/cv-risk/escalate";
import { flagTrendReviewEscalations } from "@/lib/clinical/trend-escalation";
import {
  createMlClientFromEnv,
  type AnalyteReadingIn,
  type Json,
  type LabInterpretationResponse,
} from "@tarragon/shared";

type AnalyteReadingRow = {
  organisation_id: string;
  patient_id: string;
  code: string;
  value: number;
  unit: string;
};

export type SubmitScreeningResultState = { error?: string; success?: boolean } | undefined;

/** Matches services/ml's CONTROL_WINDOW_DAYS-adjacent lookback for "latest" reads. */
const RECENT_LOOKBACK_DAYS = 365;

function ageFromDob(dateOfBirth: string): number {
  return Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
}

/**
 * The single classification path for a screening/lab result — shared by
 * submitScreeningResult and recordScreeningResultCorrection so a correction
 * is classified exactly the same way a fresh result is: through the
 * protocol-governed ML service, never a clinician's own direct assertion of
 * result_status (see the trust-boundary note on record_result_correction()
 * in its migration).
 */
async function classifyScreeningInput(
  mlClient: NonNullable<ReturnType<typeof createMlClientFromEnv>>,
  input: ScreeningResultInput,
  sex: "male" | "female",
  age: number
): Promise<{ interpretation: LabInterpretationResponse; analytes: AnalyteReadingIn[] } | null> {
  const analytes: AnalyteReadingIn[] = [];
  if (input.screen_type_code === "hba1c" && input.hba1c_value !== undefined) {
    analytes.push({ code: "hba1c", value: input.hba1c_value, hba1c_unit: input.hba1c_unit });
  }
  if (input.screen_type_code === "psa" && input.psa_value !== undefined) {
    analytes.push({ code: "psa", value: input.psa_value });
  }
  if (input.screen_type_code === "ogtt_fpg" && input.ogtt_fpg_value !== undefined) {
    // OGTT/fasting plasma glucose is the same measurement, same canonical
    // unit, as the platform's existing 'fasting_glucose' analyte code —
    // reused rather than adding a new ML-side AnalyteCode.
    analytes.push({ code: "fasting_glucose", value: input.ogtt_fpg_value });
  }
  if (input.screen_type_code === "lipid_panel") {
    if (input.total_cholesterol_mg_dl !== undefined) {
      analytes.push({ code: "total_cholesterol", value: input.total_cholesterol_mg_dl });
    }
    if (input.hdl_cholesterol_mg_dl !== undefined) {
      analytes.push({ code: "hdl_cholesterol", value: input.hdl_cholesterol_mg_dl });
    }
    if (input.ldl_cholesterol_mg_dl !== undefined) {
      analytes.push({ code: "ldl_cholesterol", value: input.ldl_cholesterol_mg_dl });
    }
    if (input.triglycerides_mg_dl !== undefined) {
      analytes.push({ code: "triglycerides", value: input.triglycerides_mg_dl });
    }
  }

  const interpretation = await mlClient.interpretLabs({
    screen_type_code: input.screen_type_code,
    sex,
    age,
    analytes: analytes.length > 0 ? analytes : undefined,
    qualitative_result: input.qualitative_result,
    genotype: input.genotype,
    procedural_status: input.procedural_status,
  });
  if (!interpretation) return null;

  return { interpretation, analytes };
}

/**
 * Store hba1c in its canonical percent value regardless of the unit the
 * form submitted, so history stays comparable across readings. `code` is
 * widened to string because Non-HDL is an app-derived analyte (not part of
 * the ML AnalyteCode union); the DB column is free text. Also computes and
 * appends the derived Non-HDL (Total − HDL) row for a lipid panel — never a
 * separate table, just a derived row (see lib/lipids/analytes).
 */
function buildAnalyteReadingRows(
  organisationId: string,
  patientId: string,
  input: ScreeningResultInput,
  interpretation: LabInterpretationResponse
): AnalyteReadingRow[] {
  const unitFor = (code: AnalyteReadingIn["code"]): string =>
    code === "hba1c" ? "percent" : code === "psa" ? "ng/mL" : "mg/dL";

  const rows: AnalyteReadingRow[] = interpretation.analyte_results.map((result) => ({
    organisation_id: organisationId,
    patient_id: patientId,
    code: result.code,
    value: result.code === "hba1c" && result.value_percent !== null ? result.value_percent : result.value,
    unit: unitFor(result.code),
  }));

  const nonHdl = computeNonHdl(
    input.total_cholesterol_mg_dl ?? null,
    input.hdl_cholesterol_mg_dl ?? null
  );
  if (input.screen_type_code === "lipid_panel" && nonHdl !== null) {
    rows.push({
      organisation_id: organisationId,
      patient_id: patientId,
      code: "non_hdl_cholesterol",
      value: nonHdl,
      unit: "mg/dL",
    });
  }
  return rows;
}

/**
 * Records a completed screening/lab result for a patient: interprets it via
 * the ML service (`/interpret/labs`), writes `screening_results` (the
 * existing `handle_abnormal_screening_result` trigger handles the Cat 1
 * escalation automatically — nothing else to do here), and persists each
 * submitted analyte value to `lab_analyte_readings` for future trend
 * analysis. Opportunistically also computes CVD risk (when a lipid panel
 * plus existing BP/smoking-status data are available) and HbA1c trajectory
 * (when enough history exists) — both best-effort, never blocking the
 * primary result recording.
 */
export async function submitScreeningResult(
  patientId: string,
  _prevState: SubmitScreeningResultState,
  formData: FormData
): Promise<SubmitScreeningResultState> {
  const raw = Object.fromEntries(formData.entries());
  const parsed = screeningResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const { data: patient } = await supabase
    .from("profiles")
    .select("organisation_id, sex, date_of_birth")
    .eq("id", patientId)
    .eq("role", "patient")
    .maybeSingle();
  if (!patient?.organisation_id) {
    return { error: "Patient not found or has no organisation on file" };
  }
  if (!patient.sex || !patient.date_of_birth) {
    return { error: "Patient is missing sex or date of birth, set these before recording a result" };
  }
  const organisationId = patient.organisation_id;
  const sex = patient.sex;
  const age = ageFromDob(patient.date_of_birth);

  const mlClient = createMlClientFromEnv();
  if (!mlClient) {
    return { error: "ML service is not configured, cannot interpret this result" };
  }

  const classified = await classifyScreeningInput(mlClient, input, sex, age);
  if (!classified) {
    return { error: "ML service is unavailable, try again shortly" };
  }
  const { interpretation, analytes } = classified;

  const { error: insertError } = await supabase.from("screening_results").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    result_status: interpretation.result_status,
    result_summary: interpretation.summary,
    abnormal_flags: interpretation.abnormal_flags,
    // Drives the abnormal-result trigger's sensitive-positive gate — a
    // positive HIV/hep/cancer result is doctor-delivered, never auto-messaged.
    screen_type_code: input.screen_type_code,
    // Ties this result to a specific Screen-tier order when recorded via the
    // order-scoped checklist; null for the standalone "record a result"
    // form. Drives private.check_screen_order_completeness — see the
    // lab_order_id comment on screeningResultSchema.
    lab_order_id: input.lab_order_id ?? null,
  });
  if (insertError) {
    return { error: insertError.message };
  }

  if (analytes.length > 0) {
    const analyteReadingRows = buildAnalyteReadingRows(organisationId, patientId, input, interpretation);
    const { error: readingsError } = await supabase
      .from("lab_analyte_readings")
      .insert(analyteReadingRows);
    if (readingsError) {
      return { error: readingsError.message };
    }
  }

  await Promise.all([
    maybeComputeCvdRisk(mlClient, {
      organisationId,
      patientId,
      sex,
      age,
      analytes,
    }),
    maybeComputeHba1cTrajectory(mlClient, { organisationId, patientId, hasHba1cResult: analytes.some((a) => a.code === "hba1c") }),
  ]);

  // After a lipid panel (and once the fresh CVD risk above has been written),
  // run the config-driven CV-risk assessment and flag any escalation for
  // clinician review — untreated high-risk/secondary prevention, very high
  // LDL/Non-HDL, or a worsening trend. Best-effort: never blocks the result.
  if (input.screen_type_code === "lipid_panel") {
    try {
      await flagCvRiskEscalations(patientId, organisationId);
    } catch {
      // A missing config or transient error must not fail result recording.
    }
  }

  // §7.7 trend-aware interpretation — a persistent, real movement in any
  // recorded analyte (lipids excluded, already covered above) prompts a
  // review even when today's single reading isn't abnormal on its own.
  // Best-effort for the same reason as flagCvRiskEscalations above.
  if (analytes.length > 0) {
    try {
      await flagTrendReviewEscalations(patientId, organisationId, sex);
    } catch {
      // A transient error must not fail result recording.
    }
  }

  return { success: true };
}

export type SetFollowUpActionState = { error?: string; success?: boolean } | undefined;

/**
 * Records the clinician's named next step for a result — separate from
 * submitScreeningResult because the result's abnormal/critical status isn't
 * known until the ML interpretation above has already run; this is a
 * deliberate second step taken once the clinician has seen the outcome, same
 * shape as markResultDocumentReviewed's own review-note field.
 *
 * Gated on an active clinical_staff record, not just is_org_staff — deciding
 * what should happen next about a result is a clinical judgement call under
 * the Clinical Tier Ladder (CLAUDE.md), so a Care Coordinator must not be
 * able to set this even though screening_results_update's RLS admits any
 * org-staff session. App-layer gate, matching the established
 * Care-Coordinator-write-access convention.
 */
export async function setScreeningResultFollowUpAction(
  resultId: string,
  _prevState: SetFollowUpActionState,
  formData: FormData
): Promise<SetFollowUpActionState> {
  const followUpAction = String(formData.get("follow_up_action") ?? "").trim();
  if (!followUpAction) {
    return { error: "Enter a follow-up action" };
  }
  if (followUpAction.length > 500) {
    return { error: "Keep the follow-up action under 500 characters" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in" };

  const { data: staff } = await supabase
    .from("clinical_staff")
    .select("id")
    .eq("profile_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!staff) {
    return { error: "Only an active Tarragon care-team doctor can set a follow-up action." };
  }

  const { error } = await supabase
    .from("screening_results")
    .update({ follow_up_action: followUpAction })
    .eq("id", resultId);
  if (error) return { error: error.message };

  return { success: true };
}

export type RecordResultCorrectionState = { error?: string; success?: boolean } | undefined;

/**
 * Files a correction for an existing screening result — §7.15. Reuses the
 * exact same classifyScreeningInput path as submitScreeningResult, locked
 * to the original result's own screen_type_code, so a correction is
 * classified by the same protocol-governed ML service a fresh result would
 * be — never a clinician's own direct assertion of result_status (see the
 * trust-boundary note on record_result_correction() in its migration).
 *
 * The DB RPC does the rest: the original row is retained and never
 * mutated, the new row is linked back to it, every existing screening_
 * results trigger reacts to it like a fresh result, and — when the
 * correction walks a previously abnormal/critical result back to
 * normal/borderline, the one direction the standard abnormal-result
 * trigger doesn't itself cover — a stand-down review alert is raised so
 * whatever the original alert already set in motion gets reconciled by a
 * human rather than going silently stale.
 */
export async function recordScreeningResultCorrection(
  patientId: string,
  originalResultId: string,
  _prevState: RecordResultCorrectionState,
  formData: FormData
): Promise<RecordResultCorrectionState> {
  const correctionReason = String(formData.get("correction_reason") ?? "").trim();
  if (!correctionReason) {
    return { error: "Enter a reason for this correction" };
  }
  if (correctionReason.length > 500) {
    return { error: "Keep the correction reason under 500 characters" };
  }

  const raw = Object.fromEntries(formData.entries());
  const parsed = screeningResultSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const input = parsed.data;

  const supabase = await createClient();
  const [{ data: patient }, { data: original }] = await Promise.all([
    supabase
      .from("profiles")
      .select("organisation_id, sex, date_of_birth")
      .eq("id", patientId)
      .eq("role", "patient")
      .maybeSingle(),
    supabase.from("screening_results").select("screen_type_code").eq("id", originalResultId).maybeSingle(),
  ]);
  if (!patient?.organisation_id) {
    return { error: "Patient not found or has no organisation on file" };
  }
  if (!patient.sex || !patient.date_of_birth) {
    return { error: "Patient is missing sex or date of birth, set these before recording a result" };
  }
  if (!original) {
    return { error: "Original result not found" };
  }
  if (original.screen_type_code !== input.screen_type_code) {
    return { error: "A correction must be filed for the same screening type as the original result" };
  }

  const organisationId = patient.organisation_id;
  const sex = patient.sex;
  const age = ageFromDob(patient.date_of_birth);

  const mlClient = createMlClientFromEnv();
  if (!mlClient) {
    return { error: "ML service is not configured, cannot interpret this result" };
  }

  const classified = await classifyScreeningInput(mlClient, input, sex, age);
  if (!classified) {
    return { error: "ML service is unavailable, try again shortly" };
  }
  const { interpretation, analytes } = classified;

  const { data: correctionId, error: rpcError } = await supabase.rpc("record_result_correction", {
    p_original_result_id: originalResultId,
    p_result_status: interpretation.result_status,
    p_result_summary: interpretation.summary,
    p_abnormal_flags: interpretation.abnormal_flags,
    p_correction_reason: correctionReason,
  });
  if (rpcError) {
    return { error: rpcError.message };
  }

  // A corrected analyte value gets its own fresh reading row — a genuine
  // new data point ("this is what we now know, as of now"), not a rewrite
  // of trend history, matching screening_results' own append-only
  // discipline. Best-effort: the correction itself is already durably
  // recorded via the RPC above even if this secondary write fails.
  if (analytes.length > 0 && correctionId) {
    const rows = buildAnalyteReadingRows(organisationId, patientId, input, interpretation);
    await supabase.from("lab_analyte_readings").insert(rows);
  }

  return { success: true };
}

async function maybeComputeCvdRisk(
  mlClient: NonNullable<ReturnType<typeof createMlClientFromEnv>>,
  params: {
    organisationId: string;
    patientId: string;
    sex: "male" | "female";
    age: number;
    analytes: AnalyteReadingIn[];
  }
): Promise<void> {
  const totalCholesterol = params.analytes.find((a) => a.code === "total_cholesterol")?.value;
  const hdlCholesterol = params.analytes.find((a) => a.code === "hdl_cholesterol")?.value;
  if (totalCholesterol === undefined || hdlCholesterol === undefined) return;

  const supabase = await createClient();
  const since = new Date(Date.now() - RECENT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: latestBp }, { data: smokingResponse }] = await Promise.all([
    supabase
      .from("vitals_readings")
      .select("systolic")
      .eq("patient_id", params.patientId)
      .eq("vital_type", "blood_pressure")
      .gte("taken_at", since)
      .order("taken_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("risk_assessment_responses")
      .select("response")
      .eq("profile_id", params.patientId)
      .eq("question_key", "smoking_status")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!latestBp?.systolic || !smokingResponse) return;

  const isSmoker = smokingResponse.response === "current";

  const risk = await mlClient.cvdRisk({
    age: params.age,
    sex: params.sex,
    is_smoker: isSmoker,
    systolic_bp: latestBp.systolic,
    total_cholesterol_mg_dl: totalCholesterol,
    hdl_cholesterol_mg_dl: hdlCholesterol,
  });
  if (!risk) return;

  // patient_risk_scores is staff-only-write by RLS — system computation,
  // same reasoning as the BP-control write in patient/actions.ts.
  await createServiceRoleClient()
    .from("patient_risk_scores")
    .insert({
      organisation_id: params.organisationId,
      patient_id: params.patientId,
      score_type: "cvd_10yr",
      score: risk.cvd_risk_10yr_percent,
      risk_level: risk.risk_level,
      model_version: risk.model,
      inputs: risk as unknown as Json,
    });
}

async function maybeComputeHba1cTrajectory(
  mlClient: NonNullable<ReturnType<typeof createMlClientFromEnv>>,
  params: { organisationId: string; patientId: string; hasHba1cResult: boolean }
): Promise<void> {
  if (!params.hasHba1cResult) return;

  const supabase = await createClient();
  const { data: history } = await supabase
    .from("lab_analyte_readings")
    .select("value, taken_at")
    .eq("patient_id", params.patientId)
    .eq("code", "hba1c")
    .order("taken_at", { ascending: true });
  // value is nullable since non-numeric results share this table; an HbA1c row
  // should never be one, so a null is dropped rather than coerced into a zero
  // that would bend the trajectory.
  const numericHistory = (history ?? []).filter(
    (r): r is typeof r & { value: number } => r.value !== null,
  );
  if (numericHistory.length === 0) return;

  const trajectory = await mlClient.hba1cTrajectory({
    readings: numericHistory.map((r) => ({
      on: r.taken_at.slice(0, 10),
      value_percent: r.value,
    })),
  });
  if (!trajectory) return;

  await createServiceRoleClient()
    .from("patient_risk_scores")
    .insert({
      organisation_id: params.organisationId,
      patient_id: params.patientId,
      score_type: "hba1c_trajectory",
      score: trajectory.latest_value_percent,
      model_version: "hba1c_trajectory_v1",
      inputs: trajectory as unknown as Json,
    });
}
