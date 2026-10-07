import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { ageFromDateOfBirth } from "@tarragon/shared";
import { scoreCvdWho2019, type CvdInputs, type CvdInstrumentConfig, type CvdOutcome } from "@tarragon/clinical";
import { readPatientVitalsAudited } from "@/lib/clinical/vitals-audited";

/**
 * WHO 2019 cardiovascular risk assessment (S45, functions 3.2 and 3.3).
 *
 * The pure engine lives in `@tarragon/clinical`; this file gathers the inputs through the audited readers, picks the instrument version,
 * runs the engine and writes the result through `record_risk_assessment`, which only the service role may call. Every row names its
 * instrument version (INV-16), including a refusal. No coefficient lives in code: with an unsigned or empty version the engine answers
 * `not_scored_instrument_off` and that is what is recorded. Results are bands, never a percentage.
 */

const sexModel = z
  .object({
    baselineSurvival: z.number(),
    terms: z.array(z.object({ coef: z.number(), factors: z.array(z.object({ var: z.enum(["age", "sbp", "smoker", "diabetes", "total_chol_mmol", "bmi"]), center: z.number() })) })),
  })
  .nullable();
const modelPair = z.object({ male: sexModel, female: sexModel });

const instrumentConfigSchema = z.object({
  coefficientsVerified: z.boolean(),
  ageRange: z.object({ min: z.number(), max: z.number() }),
  bands: z.array(z.object({ code: z.string(), lowPct: z.number(), highPct: z.number().nullable(), tier: z.string() })).min(1),
  nonLabFurtherAssessmentAtOrAbovePct: z.number(),
  treatmentAlreadyIndicated: z.object({ systolicAtOrAbove: z.number(), diastolicAtOrAbove: z.number(), establishedCvd: z.boolean() }),
  models: z.object({ lab: modelPair, non_lab: modelPair }),
});

/** A config that does not parse is treated as no config at all, so the caller records "instrument off" rather than guessing. */
export function parseInstrumentConfig(raw: unknown): CvdInstrumentConfig | null {
  const parsed = instrumentConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const MG_DL_PER_MMOL_L_CHOLESTEROL = 38.67;

export interface CvdRawFacts {
  dateOfBirth: string | null;
  sex: string | null;
  heightCm: number | null;
  systolic: number | null;
  diastolic: number | null;
  weightKg: number | null;
  totalCholesterolMgDl: number | null;
  smokingResponse: string | null;
  knownDiabetes: boolean;
  establishedCvd: boolean;
}

export function buildCvdInputs(f: CvdRawFacts): CvdInputs {
  const age = f.dateOfBirth ? ageFromDateOfBirth(f.dateOfBirth) : null;
  const bmi = f.heightCm && f.weightKg && f.heightCm > 0 ? Math.round((f.weightKg / Math.pow(f.heightCm / 100, 2)) * 10) / 10 : null;
  return {
    age,
    sex: f.sex === "male" || f.sex === "female" ? f.sex : null,
    systolic: f.systolic,
    diastolic: f.diastolic,
    // an unanswered smoking question is unknown, never "non-smoker"
    smoker: f.smokingResponse === null ? null : f.smokingResponse === "current",
    knownDiabetes: f.knownDiabetes,
    establishedCvd: f.establishedCvd,
    totalCholesterolMmol: f.totalCholesterolMgDl !== null ? Math.round((f.totalCholesterolMgDl / MG_DL_PER_MMOL_L_CHOLESTEROL) * 100) / 100 : null,
    bmi,
  };
}

export interface InstrumentVersion {
  id: string;
  signed: boolean;
  config: unknown;
}

export interface CvdDataSource {
  facts(patientId: string): Promise<CvdRawFacts | null>;
  instrument(): Promise<InstrumentVersion | null>;
  reassessmentReasons(patientId: string): Promise<string[]>;
  record(args: {
    patientId: string;
    versionId: string;
    outcome: CvdOutcome;
    inputs: CvdInputs;
    trigger: "initial" | "yearly" | "major_change" | "manual";
    reasons: string[];
    recordedBy: string | null;
  }): Promise<{ ok: true; id: string } | { ok: false; code: string }>;
}

export type CvdAssessmentResult =
  | { ok: true; id: string; outcome: CvdOutcome }
  | { ok: false; reason: "no_record" | "no_instrument" | "write_failed" };

export async function assessCvdWho2019(
  source: CvdDataSource,
  patientId: string,
  opts: { trigger?: "initial" | "yearly" | "major_change" | "manual"; recordedBy?: string | null } = {}
): Promise<CvdAssessmentResult> {
  const facts = await source.facts(patientId);
  if (!facts) return { ok: false, reason: "no_record" };
  const version = await source.instrument();
  if (!version) return { ok: false, reason: "no_instrument" };

  const inputs = buildCvdInputs(facts);
  const config = version.signed ? parseInstrumentConfig(version.config) : null;
  // An unsigned version never scores for a real person. The database enforces the same rule, this keeps the recorded reason honest.
  let outcome: CvdOutcome;
  if (config) {
    outcome = scoreCvdWho2019(inputs, config);
  } else {
    // Still apply the clinical refusals that need no coefficients, using a permissive shell, so the reason on file is the real one.
    const shell = parseInstrumentConfig(version.config);
    outcome = shell ? scoreCvdWho2019(inputs, { ...shell, coefficientsVerified: false }) : { status: "not_scored_instrument_off" };
  }

  const reasons = await source.reassessmentReasons(patientId);
  const trigger = opts.trigger ?? (reasons.includes("yearly") ? "yearly" : reasons.length > 0 ? "major_change" : "manual");
  let written = await source.record({ patientId, versionId: version.id, outcome, inputs, trigger, reasons, recordedBy: opts.recordedBy ?? null });
  if (!written.ok && outcome.status === "scored") {
    // The database said not live (guard off, or an unsigned version for a real person): record the refusal instead of losing the run.
    outcome = { status: "not_scored_instrument_off" };
    written = await source.record({ patientId, versionId: version.id, outcome, inputs, trigger, reasons, recordedBy: opts.recordedBy ?? null });
  }
  return written.ok ? { ok: true, id: written.id, outcome } : { ok: false, reason: "write_failed" };
}

type Client = SupabaseClient<Database>;

/** The real data source. `user` reads under the caller's own session; `service` is the service-role client used only for the write. */
export function supabaseCvdDataSource(user: Client, service: Client): CvdDataSource {
  return {
    async facts(patientId) {
      const { data: p } = await user.from("profiles").select("date_of_birth, sex, height_cm").eq("id", patientId).maybeSingle();
      if (!p) return null;
      const [bp, weight, chol, smoking, plans, cvProfile] = await Promise.all([
        readPatientVitalsAudited(user, patientId, { vitalType: "blood_pressure", limit: 1 }),
        readPatientVitalsAudited(user, patientId, { vitalType: "weight", limit: 1 }),
        user.from("lab_analyte_readings").select("value").eq("patient_id", patientId).eq("code", "total_cholesterol").order("taken_at", { ascending: false }).limit(1).maybeSingle(),
        user.from("risk_assessment_responses").select("response").eq("profile_id", patientId).eq("question_key", "smoking_status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
        user.from("care_plans").select("condition").eq("patient_id", patientId).eq("status", "active"),
        user.from("patient_cardiovascular_profile").select("established_ascvd").eq("patient_id", patientId).maybeSingle(),
      ]);
      // A reading that could not be read is missing data, not a normal one.
      const bpRow = bp.status === "ok" ? bp.rows[0] : undefined;
      const weightRow = weight.status === "ok" ? weight.rows[0] : undefined;
      return {
        dateOfBirth: p.date_of_birth,
        sex: p.sex,
        heightCm: p.height_cm !== null && p.height_cm !== undefined ? Number(p.height_cm) : null,
        systolic: bpRow?.systolic ?? null,
        diastolic: bpRow?.diastolic ?? null,
        weightKg: weightRow?.weight_kg !== null && weightRow?.weight_kg !== undefined ? Number(weightRow.weight_kg) : null,
        totalCholesterolMgDl: chol.data?.value !== undefined && chol.data !== null ? Number(chol.data.value) : null,
        smokingResponse: typeof smoking.data?.response === "string" ? smoking.data.response : null,
        knownDiabetes: (plans.data ?? []).some((c) => c.condition === "diabetes"),
        establishedCvd: cvProfile.data?.established_ascvd === true,
      };
    },
    async instrument() {
      const { data } = await user
        .from("risk_instrument_versions")
        .select("id, config, is_active, approved_by")
        .eq("code", "who_cvd_2019_wssa")
        .order("version", { ascending: false });
      const rows = data ?? [];
      const active = rows.find((r) => r.is_active && r.approved_by);
      const chosen = active ?? rows[0];
      return chosen ? { id: chosen.id, signed: Boolean(active), config: chosen.config } : null;
    },
    async reassessmentReasons(patientId) {
      const { data } = await user.rpc("my_risk_reassessment_due");
      void patientId;
      return data ?? [];
    },
    async record(a) {
      const o = a.outcome;
      const { data, error } = await service.rpc("record_risk_assessment", {
        p_patient: a.patientId,
        p_version_id: a.versionId,
        p_status: o.status,
        p_model: o.status === "scored" ? o.model : null,
        p_inputs: a.inputs as unknown as Database["public"]["Tables"]["risk_assessments"]["Row"]["inputs"],
        p_band_code: o.status === "scored" ? o.bandCode : null,
        p_trigger: a.trigger,
        p_reasons: a.reasons,
        p_recorded_by: a.recordedBy ?? undefined,
      });
      if (error || !data) return { ok: false, code: error?.message ?? "no_id" };
      return { ok: true, id: data };
    },
  };
}
