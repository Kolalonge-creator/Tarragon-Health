/**
 * Rule-based screening interpretation — the ADVISORY-ML fallback.
 *
 * WHY THIS EXISTS. `submitScreeningResult` is the only write path into
 * `public.screening_results`, and that table's insert trigger
 * (`private.handle_abnormal_screening_result`) is what raises the Category
 * 2 -> 1 upgrade, the `clinician_alerts` row and its contact SLA. Until
 * 2026-09-05 the action refused to insert at all unless the Python ML
 * service both existed and answered: `createGovernedMlClient` returning null
 * (no `ML_SERVICE_URL`/`ML_SERVICE_KEY` — the normal state while Sprint 4 is
 * paused) or `interpretLabs` returning null (5s timeout, non-2xx, malformed
 * JSON, or the AI-governance kill switch) both ended the request with an
 * error. A clinician holding a lab report showing a critical result could
 * not record it, and nothing anywhere recorded that they had tried. That is
 * the exact failure CLAUDE.md forbids ("never deprioritise or silently
 * swallow an abnormal screening result") and it also broke the platform's
 * own architecture rule that the ML service is optional and never
 * load-bearing ("the platform must keep working if ML is down").
 *
 * WHAT THIS IS. A deterministic transcription of the same published cut-offs
 * `services/ml/app/scoring/lab_reference.py` classifies against (ADA 2024
 * for glucose/HbA1c, NCEP ATP III for lipids, Oesterling 1993 age bands for
 * PSA) and the same folding rules as
 * `services/ml/app/scoring/screening_interpretation.py`. It is not a model
 * and never was — those files contain no learned parameters either, just
 * guideline thresholds — so mirroring them locally loses no clinical
 * fidelity. For qualitative / genotype / procedural screens there is nothing
 * to classify at all: the clinician's own entry IS the result, and this
 * module only standardises it into the flag vocabulary below.
 *
 * WHAT THIS IS NOT. It is not a second source of truth. When the ML service
 * answers, its interpretation is used verbatim and this module is not
 * called. Divergence between the two would be a bug in one of them; the
 * accompanying Jest tests pin the thresholds so a drift is caught here.
 *
 * FLAG VOCABULARY. `abnormal_flags` values are matched by
 * `handle_abnormal_screening_result` with an exact-token array overlap
 * (`&& array['bp','blood_pressure','hypertension']`, `['glucose','hba1c',
 * 'diabetes']`, `['psa','cancer','mammography','cervical','fit']` plus the
 * sensitive set `['hiv','hep_b','hep_c',...]`). Every token emitted here is
 * one of those, verbatim — see SCREEN_TYPE_FLAG / ANALYTE_FLAG below — so a
 * locally-interpreted result routes to the same `condition_triggered` and
 * trips the same sensitive-result suppression as an ML-interpreted one.
 */

import {
  hba1cPercentToMmolMol,
  type AnalyteCode,
  type AnalyteReadingIn,
  type AnalyteResultOut,
  type Enums,
  type LabInterpretationResponse,
} from "@tarragon/shared";

type ResultStatus = Enums<"result_status">;
type Sex = Enums<"sex">;

/** Ordinal severity, used to fold several analyte statuses into one overall
 * `result_status` — mirrors `lab_reference.STATUS_SEVERITY`. */
const STATUS_SEVERITY: Record<ResultStatus, number> = {
  normal: 0,
  borderline: 1,
  abnormal: 2,
  critical: 3,
};

/** ADA fasting plasma glucose (mg/dL). "critical" is an alerting threshold,
 * not an ADA diagnostic category. */
const FASTING_GLUCOSE_BORDERLINE_MG_DL = 100;
const FASTING_GLUCOSE_ABNORMAL_MG_DL = 126;
const FASTING_GLUCOSE_CRITICAL_MG_DL = 250;

/** ADA HbA1c (NGSP %). */
const HBA1C_BORDERLINE_PERCENT = 5.7;
const HBA1C_ABNORMAL_PERCENT = 6.5;
const HBA1C_CRITICAL_PERCENT = 10;

/** NGSP <-> IFCC master equation (Hoelzel 2004). `hba1cPercentToMmolMol`
 * already lives in @tarragon/shared; the inverse is only needed here. */
const HBA1C_IFCC_SLOPE = 10.929;
const HBA1C_IFCC_INTERCEPT_PERCENT = 2.15;

function hba1cMmolMolToPercent(mmolMol: number): number {
  return Math.round((mmolMol / HBA1C_IFCC_SLOPE + HBA1C_IFCC_INTERCEPT_PERCENT) * 10) / 10;
}

/** NCEP ATP III lipids (mg/dL). */
const TOTAL_CHOLESTEROL_BORDERLINE_MG_DL = 200;
const TOTAL_CHOLESTEROL_ABNORMAL_MG_DL = 240;
const TOTAL_CHOLESTEROL_CRITICAL_MG_DL = 300;
const LDL_BORDERLINE_MG_DL = 130;
const LDL_ABNORMAL_MG_DL = 160;
const LDL_CRITICAL_MG_DL = 190;
const TRIGLYCERIDES_BORDERLINE_MG_DL = 150;
const TRIGLYCERIDES_ABNORMAL_MG_DL = 200;
const TRIGLYCERIDES_CRITICAL_MG_DL = 500;
/** HDL is the protective lipid — lower is worse, so it is one-sided. */
const HDL_ABNORMAL_MALE_MG_DL = 40;
const HDL_ABNORMAL_FEMALE_MG_DL = 50;
const HDL_PROTECTIVE_MG_DL = 60;

/** Oesterling age-specific PSA upper bounds of normal (ng/mL). */
const PSA_CRITICAL_NG_ML = 10;
const PSA_AGE_BANDS: readonly (readonly [number, number, number])[] = [
  [40, 49, 2.5],
  [50, 59, 3.5],
  [60, 69, 4.5],
  [70, 120, 6.5],
];

/** Analyte -> trigger flag token. Deliberately no lipid entry: the trigger
 * has no dyslipidaemia `condition_triggered` bucket, so an abnormal lipid
 * result escalates on `result_status` alone and falls to 'other'. Same
 * omission, same reason, as `lab_reference._ANALYTE_FLAG`. */
const ANALYTE_FLAG: Partial<Record<AnalyteCode, string>> = {
  fasting_glucose: "glucose",
  hba1c: "hba1c",
  psa: "psa",
};

/** screen_types.code -> trigger flag token, mirroring
 * `screening_interpretation._SCREEN_TYPE_FLAG`. */
const SCREEN_TYPE_FLAG: Record<string, string> = {
  psa: "psa",
  mammography: "mammography",
  cervical_smear: "cervical",
  fit: "fit",
  hba1c: "hba1c",
  blood_pressure: "blood_pressure",
  hiv: "hiv",
  hep_b: "hep_b",
  hep_c: "hep_c",
};

const SICKLE_CELL_NORMAL = new Set(["AA"]);
const SICKLE_CELL_CARRIER = new Set(["AS", "AC", "AE", "AF"]);
const SICKLE_CELL_DISEASE = new Set(["SS", "SC", "CC", "S-BETA-THAL"]);

export interface FallbackInterpretationInput {
  screenTypeCode: string;
  sex: Sex;
  age: number;
  analytes?: readonly AnalyteReadingIn[];
  qualitativeResult?: "positive" | "negative";
  genotype?: string;
  proceduralStatus?: ResultStatus;
}

function banded(
  code: AnalyteCode,
  value: number,
  bounds: { borderline: number; abnormal: number; critical: number },
  unit: string
): AnalyteResultOut {
  const status: ResultStatus =
    value >= bounds.critical
      ? "critical"
      : value >= bounds.abnormal
        ? "abnormal"
        : value >= bounds.borderline
          ? "borderline"
          : "normal";
  return {
    code,
    value,
    status,
    reference_range: `<${bounds.borderline.toFixed(1)} ${unit} (normal)`,
    flag: status === "normal" ? null : (ANALYTE_FLAG[code] ?? null),
    value_percent: null,
    value_mmol_mol: null,
  };
}

function classifyHba1c(value: number, unit: "percent" | "mmol_mol"): AnalyteResultOut {
  const percent = unit === "mmol_mol" ? hba1cMmolMolToPercent(value) : value;
  const mmolMol = unit === "mmol_mol" ? value : hba1cPercentToMmolMol(value);
  const status: ResultStatus =
    percent >= HBA1C_CRITICAL_PERCENT
      ? "critical"
      : percent >= HBA1C_ABNORMAL_PERCENT
        ? "abnormal"
        : percent >= HBA1C_BORDERLINE_PERCENT
          ? "borderline"
          : "normal";
  const borderlineMmolMol = hba1cPercentToMmolMol(HBA1C_BORDERLINE_PERCENT);
  return {
    code: "hba1c",
    value,
    status,
    reference_range: `<${HBA1C_BORDERLINE_PERCENT.toFixed(1)}% (<${borderlineMmolMol} mmol/mol) (normal)`,
    flag: status === "normal" ? null : (ANALYTE_FLAG.hba1c ?? null),
    value_percent: Math.round(percent * 10) / 10,
    value_mmol_mol: Math.round(mmolMol),
  };
}

function classifyHdl(value: number, sex: Sex): AnalyteResultOut {
  const threshold = sex === "male" ? HDL_ABNORMAL_MALE_MG_DL : HDL_ABNORMAL_FEMALE_MG_DL;
  return {
    code: "hdl_cholesterol",
    value,
    status: value < threshold ? "abnormal" : "normal",
    reference_range: `>=${threshold} mg/dL (normal); >=${HDL_PROTECTIVE_MG_DL} protective`,
    // No flag: see ANALYTE_FLAG's note on the missing lipid bucket.
    flag: null,
    value_percent: null,
    value_mmol_mol: null,
  };
}

function classifyPsa(value: number, age: number): AnalyteResultOut {
  const band = PSA_AGE_BANDS.find(([lo, hi]) => age >= lo && age <= hi);
  if (!band) {
    // Oesterling's bands only cover 40+. Escalate rather than borrow an
    // adult band, which would silently under-flag a value with no clinical
    // basis for calling it normal.
    return {
      code: "psa",
      value,
      status: "abnormal",
      reference_range: `no validated PSA reference range for age ${age} (Oesterling bands cover ages 40+) - clinician review required`,
      flag: ANALYTE_FLAG.psa ?? null,
      value_percent: null,
      value_mmol_mol: null,
    };
  }
  const upper = band[2];
  const status: ResultStatus =
    value >= PSA_CRITICAL_NG_ML ? "critical" : value > upper ? "abnormal" : "normal";
  return {
    code: "psa",
    value,
    status,
    reference_range: `<=${upper.toFixed(1)} ng/mL (age ${age}, normal)`,
    flag: status === "normal" ? null : (ANALYTE_FLAG.psa ?? null),
    value_percent: null,
    value_mmol_mol: null,
  };
}

function classifyAnalyte(reading: AnalyteReadingIn, sex: Sex, age: number): AnalyteResultOut {
  switch (reading.code) {
    case "fasting_glucose":
      return banded(
        reading.code,
        reading.value,
        {
          borderline: FASTING_GLUCOSE_BORDERLINE_MG_DL,
          abnormal: FASTING_GLUCOSE_ABNORMAL_MG_DL,
          critical: FASTING_GLUCOSE_CRITICAL_MG_DL,
        },
        "mg/dL"
      );
    case "hba1c":
      return classifyHba1c(reading.value, reading.hba1c_unit ?? "percent");
    case "total_cholesterol":
      return banded(
        reading.code,
        reading.value,
        {
          borderline: TOTAL_CHOLESTEROL_BORDERLINE_MG_DL,
          abnormal: TOTAL_CHOLESTEROL_ABNORMAL_MG_DL,
          critical: TOTAL_CHOLESTEROL_CRITICAL_MG_DL,
        },
        "mg/dL"
      );
    case "ldl_cholesterol":
      return banded(
        reading.code,
        reading.value,
        {
          borderline: LDL_BORDERLINE_MG_DL,
          abnormal: LDL_ABNORMAL_MG_DL,
          critical: LDL_CRITICAL_MG_DL,
        },
        "mg/dL"
      );
    case "triglycerides":
      return banded(
        reading.code,
        reading.value,
        {
          borderline: TRIGLYCERIDES_BORDERLINE_MG_DL,
          abnormal: TRIGLYCERIDES_ABNORMAL_MG_DL,
          critical: TRIGLYCERIDES_CRITICAL_MG_DL,
        },
        "mg/dL"
      );
    case "hdl_cholesterol":
      return classifyHdl(reading.value, sex);
    case "psa":
      return classifyPsa(reading.value, age);
  }
}

function classifyGenotype(genotype: string): { status: ResultStatus; note: string } {
  const normalised = genotype.trim().toUpperCase();
  if (SICKLE_CELL_NORMAL.has(normalised)) {
    return { status: "normal", note: `Genotype ${normalised}: normal.` };
  }
  if (SICKLE_CELL_CARRIER.has(normalised)) {
    return {
      status: "borderline",
      note: `Genotype ${normalised}: carrier/trait; genetic counselling advised.`,
    };
  }
  if (SICKLE_CELL_DISEASE.has(normalised)) {
    return {
      status: "abnormal",
      note: `Genotype ${normalised}: sickle cell disease; specialist referral needed.`,
    };
  }
  // Escalate an unrecognised genotype rather than passing it as normal.
  return {
    status: "abnormal",
    note: `Genotype '${genotype}' not recognised; clinician review required.`,
  };
}

function formatAnalyte(r: AnalyteResultOut): string {
  if (r.value_percent !== null && r.value_mmol_mol !== null) {
    return `${r.code} ${r.value_percent}% (${r.value_mmol_mol} mmol/mol) (${r.status})`;
  }
  return `${r.code} ${r.value} (${r.status})`;
}

function summarise(analyteResults: AnalyteResultOut[], notes: string[]): string {
  const flagged = analyteResults.filter((r) => r.status !== "normal").map(formatAnalyte);
  const parts = [...flagged, ...notes];
  if (parts.length === 0) return "All results within normal range.";
  return `${parts.join("; ")}.`;
}

/**
 * Interpret one completed screening from the values the clinician entered,
 * with no ML service involved. Same output shape as
 * `MlClient.interpretLabs`, so the caller writes the identical
 * `screening_results` row either way.
 *
 * Throws only when the caller passed nothing to interpret — the Zod schema
 * on the form already makes that unreachable (`screeningResultSchema`'s
 * superRefine requires a value for every screen-type group), so a throw here
 * means a programming error, not a clinician's input.
 */
export function interpretScreeningResultLocally(
  input: FallbackInterpretationInput
): LabInterpretationResponse {
  const analytes = input.analytes ?? [];
  if (
    analytes.length === 0 &&
    input.qualitativeResult === undefined &&
    input.genotype === undefined &&
    input.proceduralStatus === undefined
  ) {
    throw new Error(
      "interpretScreeningResultLocally needs at least one of analytes, qualitativeResult, genotype or proceduralStatus"
    );
  }

  const analyteResults = analytes.map((a) => classifyAnalyte(a, input.sex, input.age));
  const statuses: ResultStatus[] = analyteResults.map((r) => r.status);
  const flags: string[] = [];
  const notes: string[] = [];

  for (const r of analyteResults) {
    if (r.flag && !flags.includes(r.flag)) flags.push(r.flag);
  }

  let otherStatus: ResultStatus | null = null;
  let otherNote: string | null = null;
  if (input.genotype !== undefined) {
    if (input.screenTypeCode === "sickle_cell_genotype") {
      const classified = classifyGenotype(input.genotype);
      otherStatus = classified.status;
      otherNote = classified.note;
    } else {
      // blood_group and anything else carried on the free-text field: a lab
      // value with no abnormal/normal distinction of its own. Never run
      // through the sickle-cell classifier, which would flag every real
      // blood group as an unrecognised, escalation-worthy genotype.
      otherStatus = "normal";
      otherNote = `${input.screenTypeCode}: ${input.genotype}.`;
    }
  } else if (input.qualitativeResult !== undefined) {
    otherStatus = input.qualitativeResult === "positive" ? "abnormal" : "normal";
    otherNote = `${input.screenTypeCode}: ${input.qualitativeResult}.`;
  } else if (input.proceduralStatus !== undefined) {
    otherStatus = input.proceduralStatus;
    otherNote = `${input.screenTypeCode}: ${input.proceduralStatus}.`;
  }

  if (otherStatus !== null) {
    statuses.push(otherStatus);
    // A genotype/blood-group note carries the VALUE the patient paid to
    // learn, so it stays in the summary even when normal; a qualitative or
    // procedural "normal" stays terse, matching the ML module.
    if (otherStatus !== "normal" || input.genotype !== undefined) {
      notes.push(otherNote ?? "");
    }
    if (otherStatus !== "normal") {
      const mapped = SCREEN_TYPE_FLAG[input.screenTypeCode];
      if (mapped && !flags.includes(mapped)) flags.push(mapped);
    }
  }

  const overall = statuses.reduce<ResultStatus>(
    (worst, s) => (STATUS_SEVERITY[s] > STATUS_SEVERITY[worst] ? s : worst),
    "normal"
  );

  return {
    result_status: overall,
    abnormal_flags: flags,
    analyte_results: analyteResults,
    summary: summarise(analyteResults, notes),
  };
}

/** Where a stored `screening_results` row's status/flags came from. */
export type InterpretationSource = "ml" | "clinician";

/**
 * Provenance marker appended to `result_summary`.
 *
 * `screening_results` has NO column for interpretation provenance (checked
 * against the live schema 2026-09-05: id, organisation_id, patient_id,
 * schedule_id, lab_order_id, result_status, result_summary, abnormal_flags,
 * created_at, screen_type_code, follow_up_action, corrects_result_id,
 * correction_reason, recall_months, search_vector). Rather than invent a
 * migration in a bug-fix pass, the fact is carried in the two places that
 * already exist: this human-readable marker on the summary a clinician
 * actually reads, and a machine-readable `audit_log` row
 * (`screening_result.recorded` with `interpretation_source`). A follow-up
 * migration adding a real `interpretation_source` column should backfill
 * from that audit row and drop this marker.
 */
export const CLINICIAN_INTERPRETATION_MARKER =
  "[Recorded from the clinician's own entry: automated interpretation was unavailable.]";

/** Appends the provenance marker when the interpretation did not come from
 * the ML service. Kept next to the marker so the two never drift. */
export function withInterpretationProvenance(
  summary: string,
  source: InterpretationSource
): string {
  if (source === "ml") return summary;
  return summary ? `${summary} ${CLINICIAN_INTERPRETATION_MARKER}` : CLINICIAN_INTERPRETATION_MARKER;
}
