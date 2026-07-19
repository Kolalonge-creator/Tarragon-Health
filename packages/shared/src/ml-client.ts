import type { Enums } from "./database.types";

/**
 * Typed client for the stateless Python ML microservice (`services/ml`).
 *
 * Contract (CLAUDE.md / docs/ARCHITECTURE.md §4, §9):
 * - Talks to the ML service over HTTP only, base `ML_SERVICE_URL`, auth header
 *   `X-Service-Key` (`ML_SERVICE_KEY`).
 * - **5-second timeout, graceful fallback.** This client MUST NEVER throw — it
 *   returns `null` on any error, non-2xx, timeout, or malformed JSON. Every
 *   caller must have a non-ML fallback path (e.g. a rule-based score).
 * - The ML service is stateless; nothing here persists patient data.
 *
 * Request/response shapes below mirror `services/ml/app/schemas/*.py`
 * (Pydantic) field-for-field. Where a DB enum is an exact 1:1 match with the
 * Python `Literal` (sex, result_status) it's reused from `database.types.ts`
 * rather than redeclared; where it isn't (e.g. the DB's `risk_level` enum
 * also carries `very_high`, which SCORE2's own `RiskLevel` never emits) a
 * narrower type is declared here to match the Python schema exactly.
 */

export const ML_DEFAULT_TIMEOUT_MS = 5_000;

type Sex = Enums<"sex">;
type ResultStatus = Enums<"result_status">;

// --- /risk/cvd (services/ml/app/schemas/risk.py) ---------------------------

export type Score2RiskLevel = "low" | "moderate" | "high";
export type Score2RiskRegion = "low" | "moderate" | "high" | "very_high";
export type Score2ModelName = "SCORE2" | "SCORE2-OP";

export interface Score2Request {
  age: number;
  sex: Sex;
  is_smoker: boolean;
  systolic_bp: number;
  total_cholesterol_mg_dl: number;
  hdl_cholesterol_mg_dl: number;
  risk_region?: Score2RiskRegion;
}

export interface Score2Response {
  cvd_risk_10yr_percent: number;
  risk_level: Score2RiskLevel;
  model: Score2ModelName;
  risk_region: Score2RiskRegion;
}

// --- /trajectory/hba1c (services/ml/app/schemas/diabetes.py) ---------------

export type HbA1cTrend = "improving" | "stable" | "worsening" | "insufficient_data";

export interface HbA1cReadingIn {
  /** ISO date, e.g. "2026-01-15". */
  on: string;
  value_percent: number;
}

export interface HbA1cTrajectoryRequest {
  readings: HbA1cReadingIn[];
}

export interface HbA1cTrajectoryResponse {
  latest_value_percent: number;
  estimated_average_glucose_mg_dl: number;
  estimated_average_glucose_mmol_l: number;
  trend: HbA1cTrend;
  slope_percent_per_90_days: number | null;
  r_squared: number | null;
  projected_value_percent: number | null;
  projected_value_ci90_low: number | null;
  projected_value_ci90_high: number | null;
}

// --- /assess/bp-control (services/ml/app/schemas/hypertension.py) ----------

export interface BpReadingIn {
  /** ISO datetime, timezone-aware. */
  taken_at: string;
  systolic: number;
  diastolic: number;
}

export interface BpControlRequest {
  readings: BpReadingIn[];
  control_systolic?: number;
  control_diastolic?: number;
  /** ISO datetime; defaults server-side to the latest reading's timestamp. */
  as_of?: string;
}

export interface BpControlResponse {
  window_start: string;
  window_end: string;
  readings_in_window: number;
  control_rate_percent: number | null;
  systolic_mean: number | null;
  systolic_sd: number | null;
  systolic_cv_percent: number | null;
  morning_readings: number;
  morning_systolic_mean: number | null;
  morning_diastolic_mean: number | null;
  morning_surge_flag: boolean | null;
}

// --- /interpret/labs (services/ml/app/schemas/labs.py) ---------------------

export type AnalyteCode =
  | "fasting_glucose"
  | "hba1c"
  | "total_cholesterol"
  | "hdl_cholesterol"
  | "ldl_cholesterol"
  | "triglycerides"
  | "psa";
export type HbA1cUnit = "percent" | "mmol_mol";
export type QualitativeResult = "positive" | "negative";

export interface AnalyteReadingIn {
  code: AnalyteCode;
  /** Canonical unit: mg/dL for glucose/lipids, ng/mL for PSA, or whichever
   * unit `hba1c_unit` selects for HbA1c. Ignored for every analyte but
   * hba1c — the ML service rejects a non-default override with a 422. */
  value: number;
  hba1c_unit?: HbA1cUnit;
}

export interface LabInterpretationRequest {
  /** screen_types.code, e.g. 'hba1c', 'psa', 'lipid_panel'. */
  screen_type_code: string;
  sex: Sex;
  age: number;
  analytes?: AnalyteReadingIn[];
  qualitative_result?: QualitativeResult;
  genotype?: string;
  procedural_status?: ResultStatus;
}

export interface AnalyteResultOut {
  code: AnalyteCode;
  value: number;
  status: ResultStatus;
  reference_range: string;
  flag: string | null;
  value_percent: number | null;
  value_mmol_mol: number | null;
}

export interface LabInterpretationResponse {
  result_status: ResultStatus;
  abnormal_flags: string[];
  analyte_results: AnalyteResultOut[];
  summary: string;
}

// --- /analytics/cohort (services/ml/app/schemas/analytics.py) --------------

export type CohortChronicCondition = "hypertension" | "diabetes";

export interface CohortMemberIn {
  age: number;
  sex: Sex;
  chronic_conditions?: CohortChronicCondition[];
  cvd_risk_10yr_percent?: number | null;
  cvd_risk_level?: Score2RiskLevel | null;
  hba1c_trend?: HbA1cTrend | null;
  bp_control_rate_percent?: number | null;
  screening_overdue_count?: number;
  abnormal_flags?: string[];
}

export interface CohortAnalyticsRequest {
  members: CohortMemberIn[];
}

export interface AbnormalFlagCount {
  flag: string;
  count: number;
}

export interface CohortAnalyticsResponse {
  cohort_size: number;
  age_mean: number;
  sex_distribution: Record<string, number>;
  chronic_condition_prevalence_percent: Record<string, number>;
  cvd_risk_level_distribution: Record<string, number>;
  cvd_risk_mean_percent: number | null;
  hba1c_trend_distribution: Record<string, number>;
  bp_control_rate_mean_percent: number | null;
  screening_overdue_rate_percent: number;
  abnormal_findings_count: number;
  top_abnormal_flags: AbnormalFlagCount[];
}

// --- /batch/predict (services/ml/app/schemas/batch.py) ---------------------

export type BatchItem =
  | { type: "cvd"; request_id: string; payload: Score2Request }
  | { type: "hba1c"; request_id: string; payload: HbA1cTrajectoryRequest }
  | { type: "bp_control"; request_id: string; payload: BpControlRequest };

export interface BatchPredictionRequest {
  items: BatchItem[];
}

export interface BatchItemResult {
  request_id: string;
  type: "cvd" | "hba1c" | "bp_control";
  ok: boolean;
  result: Score2Response | HbA1cTrajectoryResponse | BpControlResponse | null;
  error: string | null;
}

export interface BatchPredictionResponse {
  results: BatchItemResult[];
}

// --- /lifestyle/trends + /lifestyle/engagement (services/ml/app/schemas/lifestyle.py) ---

export interface LifestyleTrendPointIn {
  /** ISO datetime with offset, e.g. "2026-07-19T09:00:00Z". */
  taken_at: string;
  value: number;
}

export interface LifestyleTrendRequest {
  points: LifestyleTrendPointIn[];
  plateau_eps?: number;
}

export interface LifestyleTrendResponse {
  points: number;
  slope_per_day: number | null;
  mean: number | null;
  first_value: number | null;
  last_value: number | null;
  plateau_detected: boolean;
  signal_version: string;
}

export interface LifestyleEngagementRequest {
  /** ISO datetimes of the patient's recent logs. */
  log_timestamps: string[];
  as_of: string;
  expected_per_week?: number;
}

export interface LifestyleEngagementResponse {
  days_since_last_log: number | null;
  logs_last_14d: number;
  expected_logs_last_14d: number;
  disengagement_risk: number;
  signal_version: string;
}

export interface MlClientConfig {
  /** Base URL of the ML service, e.g. https://ml.tarragon.internal */
  baseUrl: string;
  /** Shared secret sent as the `X-Service-Key` header. */
  serviceKey: string;
  /** Per-request timeout in ms. Defaults to 5000. */
  timeoutMs?: number;
  /** Injectable fetch (defaults to global fetch) — used in tests. */
  fetchImpl?: typeof fetch;
}

/** Response of `GET /health` (Sprint 1). */
export interface MlHealth {
  status: string;
  service: string;
  version: string;
  environment: string;
}

export interface MlClient {
  /** Liveness check. Returns the health payload, or `null` if unreachable. */
  health(): Promise<MlHealth | null>;
  /**
   * POST an arbitrary typed request to an ML endpoint (e.g. `/risk/cvd`).
   * Returns the parsed response, or `null` on any failure.
   */
  post<TResponse, TRequest = unknown>(
    path: string,
    body: TRequest,
  ): Promise<TResponse | null>;

  /** `POST /risk/cvd` — SCORE2/SCORE2-OP 10-year CVD risk. */
  cvdRisk(body: Score2Request): Promise<Score2Response | null>;
  /** `POST /trajectory/hba1c` — HbA1c trend/trajectory + estimated average glucose. */
  hba1cTrajectory(body: HbA1cTrajectoryRequest): Promise<HbA1cTrajectoryResponse | null>;
  /** `POST /assess/bp-control` — blood-pressure control rate over a trailing window. */
  bpControl(body: BpControlRequest): Promise<BpControlResponse | null>;
  /** `POST /interpret/labs` — lab/screening result interpretation feeding `AbnormalResultHandler`. */
  interpretLabs(body: LabInterpretationRequest): Promise<LabInterpretationResponse | null>;
  /** `POST /analytics/cohort` — anonymised aggregate population analytics. */
  analyseCohort(body: CohortAnalyticsRequest): Promise<CohortAnalyticsResponse | null>;
  /** `POST /batch/predict` — heterogeneous batch of cvd/hba1c/bp_control items. */
  batchPredict(body: BatchPredictionRequest): Promise<BatchPredictionResponse | null>;
  /** `POST /lifestyle/trends` — least-squares trend + plateau flag (advisory). */
  lifestyleTrends(body: LifestyleTrendRequest): Promise<LifestyleTrendResponse | null>;
  /** `POST /lifestyle/engagement` — heuristic disengagement risk (advisory). */
  lifestyleEngagement(
    body: LifestyleEngagementRequest,
  ): Promise<LifestyleEngagementResponse | null>;
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

/**
 * Perform a request that never throws. Any network error, timeout, non-2xx
 * status, or JSON parse failure resolves to `null`.
 */
async function safeRequest<TResponse>(
  config: MlClientConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<TResponse | null> {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? ML_DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "X-Service-Key": config.serviceKey,
      Accept: "application/json",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetchImpl(joinUrl(config.baseUrl, path), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as TResponse;
  } catch {
    // Timeout (AbortError), network failure, or malformed JSON — degrade to null.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Create an ML client bound to a config. */
export function createMlClient(config: MlClientConfig): MlClient {
  return {
    health() {
      return safeRequest<MlHealth>(config, "GET", "/health");
    },
    post<TResponse, TRequest = unknown>(path: string, body: TRequest) {
      return safeRequest<TResponse>(config, "POST", path, body);
    },
    cvdRisk(body) {
      return safeRequest<Score2Response>(config, "POST", "/risk/cvd", body);
    },
    hba1cTrajectory(body) {
      return safeRequest<HbA1cTrajectoryResponse>(config, "POST", "/trajectory/hba1c", body);
    },
    bpControl(body) {
      return safeRequest<BpControlResponse>(config, "POST", "/assess/bp-control", body);
    },
    interpretLabs(body) {
      return safeRequest<LabInterpretationResponse>(config, "POST", "/interpret/labs", body);
    },
    analyseCohort(body) {
      return safeRequest<CohortAnalyticsResponse>(config, "POST", "/analytics/cohort", body);
    },
    batchPredict(body) {
      return safeRequest<BatchPredictionResponse>(config, "POST", "/batch/predict", body);
    },
    lifestyleTrends(body) {
      return safeRequest<LifestyleTrendResponse>(config, "POST", "/lifestyle/trends", body);
    },
    lifestyleEngagement(body) {
      return safeRequest<LifestyleEngagementResponse>(
        config,
        "POST",
        "/lifestyle/engagement",
        body,
      );
    },
  };
}

/**
 * Build an ML client from server-side environment variables.
 * Returns `null` if `ML_SERVICE_URL` or `ML_SERVICE_KEY` are missing, so
 * callers stay on their fallback path rather than crashing at boot.
 */
export function createMlClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): MlClient | null {
  const baseUrl = env.ML_SERVICE_URL;
  const serviceKey = env.ML_SERVICE_KEY;
  if (!baseUrl || !serviceKey) {
    return null;
  }
  return createMlClient({ baseUrl, serviceKey });
}
