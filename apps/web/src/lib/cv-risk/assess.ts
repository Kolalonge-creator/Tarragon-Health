import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import {
  assessCvRisk,
  PROVISIONAL_CV_RISK_CONFIG,
  type CvRiskAssessment,
  type CvRiskConfig,
  type RiskLevel,
} from "@/lib/rules/cv-risk";

type Client = SupabaseClient<Database>;

/** Drug-name fragments that count as lipid-lowering therapy. */
const LIPID_LOWERING_PATTERNS = [
  "statin", // atorvastatin, simvastatin, rosuvastatin, pravastatin, …
  "ezetimibe",
  "fenofibrate",
  "bezafibrate",
  "gemfibrozil",
  "evolocumab",
  "alirocumab",
  "inclisiran",
];

function isLipidLoweringDrug(name: string): boolean {
  const n = name.toLowerCase();
  return LIPID_LOWERING_PATTERNS.some((p) => n.includes(p));
}

async function latestAnalyte(
  supabase: Client,
  patientId: string,
  code: string,
  limit = 2
): Promise<number[]> {
  const { data } = await supabase
    .from("lab_analyte_readings")
    .select("value, taken_at")
    .eq("patient_id", patientId)
    .eq("code", code)
    .order("taken_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((r) => Number(r.value));
}

/**
 * Gather the inputs a CV-risk assessment needs from the shared record and run
 * the config-driven engine. Returns null only when the patient record itself
 * can't be resolved. Uses the caller's own supabase client, so it respects
 * whatever RLS scope that client has.
 */
export async function loadCvRiskAssessment(
  supabase: Client,
  patientId: string,
  organisationId: string
): Promise<CvRiskAssessment | null> {
  const { data: patient } = await supabase
    .from("profiles")
    .select("date_of_birth, sex")
    .eq("id", patientId)
    .maybeSingle();
  if (!patient) return null;

  const [ldls, nonHdls, riskRow, carePlans, meds, cvProfileRow, configRow] =
    await Promise.all([
      latestAnalyte(supabase, patientId, "ldl_cholesterol", 1),
      latestAnalyte(supabase, patientId, "non_hdl_cholesterol", 2),
      supabase
        .from("patient_risk_scores")
        .select("score, risk_level")
        .eq("patient_id", patientId)
        .eq("score_type", "cvd_10yr")
        .order("computed_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("care_plans")
        .select("condition")
        .eq("patient_id", patientId)
        .eq("status", "active"),
      supabase
        .from("medications")
        .select("drug_name")
        .eq("patient_id", patientId)
        .eq("is_active", true),
      supabase
        .from("patient_cardiovascular_profile")
        .select(
          "established_ascvd, prior_mi, prior_stroke_tia, prior_pad, prior_revascularisation, familial_hypercholesterolaemia"
        )
        .eq("patient_id", patientId)
        .maybeSingle(),
      supabase
        .from("cv_risk_config")
        .select("config, is_active")
        .eq("organisation_id", organisationId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);

  const diabetes = (carePlans.data ?? []).some((c) => c.condition === "diabetes");
  const onLipidLoweringTherapy = (meds.data ?? []).some((m) =>
    isLipidLoweringDrug(m.drug_name)
  );

  const signedConfig = configRow.data?.config as CvRiskConfig | undefined;
  const config = signedConfig ?? PROVISIONAL_CV_RISK_CONFIG;
  const configSigned = Boolean(configRow.data?.is_active && signedConfig);

  return assessCvRisk(
    {
      age: patient.date_of_birth ? ageFromDateOfBirth(patient.date_of_birth) : null,
      sex: patient.sex === "male" || patient.sex === "female" ? patient.sex : null,
      ldlMgDl: ldls[0] ?? null,
      nonHdlMgDl: nonHdls[0] ?? null,
      previousNonHdlMgDl: nonHdls[1] ?? null,
      tenYearRiskPct: riskRow.data?.score != null ? Number(riskRow.data.score) : null,
      tenYearRiskLevel: (riskRow.data?.risk_level as RiskLevel | null) ?? null,
      diabetes,
      cvProfile: cvProfileRow.data ?? null,
      onLipidLoweringTherapy,
    },
    config,
    { configSigned }
  );
}
