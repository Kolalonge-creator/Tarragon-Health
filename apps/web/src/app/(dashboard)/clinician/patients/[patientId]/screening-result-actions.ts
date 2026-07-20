"use server";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { screeningResultSchema } from "@/lib/validation/screening-result";
import { computeNonHdl } from "@/lib/lipids/analytes";
import { flagCvRiskEscalations } from "@/lib/cv-risk/escalate";
import {
  createMlClientFromEnv,
  type AnalyteReadingIn,
  type Json,
} from "@tarragon/shared";

export type SubmitScreeningResultState = { error?: string; success?: boolean } | undefined;

/** Matches services/ml's CONTROL_WINDOW_DAYS-adjacent lookback for "latest" reads. */
const RECENT_LOOKBACK_DAYS = 365;

function ageFromDob(dateOfBirth: string): number {
  return Math.floor(
    (Date.now() - new Date(dateOfBirth).getTime()) / (365.25 * 24 * 60 * 60 * 1000)
  );
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
    return { error: "Patient is missing sex or date of birth — set these before recording a result" };
  }
  const organisationId = patient.organisation_id;
  const sex = patient.sex;
  const age = ageFromDob(patient.date_of_birth);

  const analytes: AnalyteReadingIn[] = [];
  if (input.screen_type_code === "hba1c" && input.hba1c_value !== undefined) {
    analytes.push({ code: "hba1c", value: input.hba1c_value, hba1c_unit: input.hba1c_unit });
  }
  if (input.screen_type_code === "psa" && input.psa_value !== undefined) {
    analytes.push({ code: "psa", value: input.psa_value });
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

  const mlClient = createMlClientFromEnv();
  if (!mlClient) {
    return { error: "ML service is not configured — cannot interpret this result" };
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
  if (!interpretation) {
    return { error: "ML service is unavailable — try again shortly" };
  }

  const { error: insertError } = await supabase.from("screening_results").insert({
    organisation_id: organisationId,
    patient_id: patientId,
    result_status: interpretation.result_status,
    result_summary: interpretation.summary,
    abnormal_flags: interpretation.abnormal_flags,
  });
  if (insertError) {
    return { error: insertError.message };
  }

  if (analytes.length > 0) {
    const unitFor = (code: AnalyteReadingIn["code"]): string =>
      code === "hba1c" ? "percent" : code === "psa" ? "ng/mL" : "mg/dL";
    // Store hba1c in its canonical percent value regardless of the unit the
    // form submitted, so history stays comparable across readings.
    // `code` is widened to string because Non-HDL is an app-derived analyte
    // (not part of the ML AnalyteCode union); the DB column is free text.
    const analyteReadingRows: {
      organisation_id: string;
      patient_id: string;
      code: string;
      value: number;
      unit: string;
    }[] = interpretation.analyte_results.map((result) => ({
      organisation_id: organisationId,
      patient_id: patientId,
      code: result.code,
      value: result.code === "hba1c" && result.value_percent !== null ? result.value_percent : result.value,
      unit: unitFor(result.code),
    }));
    // Persist computed Non-HDL (Total − HDL) as its own longitudinal analyte
    // so it trends alongside the measured lipids and feeds the CV-risk engine
    // — never a separate table, just a derived row (see lib/lipids/analytes).
    const nonHdl = computeNonHdl(
      input.total_cholesterol_mg_dl ?? null,
      input.hdl_cholesterol_mg_dl ?? null
    );
    if (input.screen_type_code === "lipid_panel" && nonHdl !== null) {
      analyteReadingRows.push({
        organisation_id: organisationId,
        patient_id: patientId,
        code: "non_hdl_cholesterol",
        value: nonHdl,
        unit: "mg/dL",
      });
    }
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
  if (!history || history.length === 0) return;

  const trajectory = await mlClient.hba1cTrajectory({
    readings: history.map((r) => ({
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
