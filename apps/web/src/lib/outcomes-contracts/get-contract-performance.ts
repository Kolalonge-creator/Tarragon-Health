import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

/**
 * Fee-at-risk / outcomes-based B2B contract performance — read side of
 * outcomes_contracts (docs/FULL_SPECIFICATION_V4.md §5/§8). Write access is
 * service-role only (see the migration); this only ever reads the org's
 * own contract plus computes current values for a small registry of known
 * metrics, entirely from existing tables — no ML service dependency, so
 * this stays available even if services/ml is down, same resilience
 * principle as Health Score.
 */

export type ThresholdMetric = "screening_compliance_percent" | "bp_control_percent";

export interface OutcomeThreshold {
  metric: string;
  label: string;
  target: number;
  better_when: "higher" | "lower";
}

export interface OutcomeThresholdWithActual extends OutcomeThreshold {
  actual: number | null;
  meetsTarget: boolean | null;
}

export interface ContractPerformance {
  contractType: Database["public"]["Enums"]["outcomes_contract_type"];
  effectiveFrom: string;
  payoutTerms: string | null;
  thresholds: OutcomeThresholdWithActual[];
}

const KNOWN_METRICS = new Set<ThresholdMetric>(["screening_compliance_percent", "bp_control_percent"]);

function isKnownMetric(metric: string): metric is ThresholdMetric {
  return KNOWN_METRICS.has(metric as ThresholdMetric);
}

async function computeScreeningCompliancePercent(
  supabase: SupabaseClient<Database>,
  patientIds: string[]
): Promise<number | null> {
  if (patientIds.length === 0) return null;
  const { data } = await supabase
    .from("screening_schedules")
    .select("status")
    .in("patient_id", patientIds)
    .in("status", ["completed", "overdue"]);
  const rows = data ?? [];
  if (rows.length === 0) return null;
  const completed = rows.filter((r) => r.status === "completed").length;
  return Math.round((completed / rows.length) * 100);
}

async function computeAverageBpControlPercent(
  supabase: SupabaseClient<Database>,
  patientIds: string[]
): Promise<number | null> {
  if (patientIds.length === 0) return null;
  const { data } = await supabase
    .from("patient_risk_scores")
    .select("patient_id, score, computed_at")
    .in("patient_id", patientIds)
    .eq("score_type", "bp_control")
    .order("computed_at", { ascending: false });

  const latestByPatient = new Map<string, number>();
  for (const row of data ?? []) {
    if (!latestByPatient.has(row.patient_id) && row.score !== null) {
      latestByPatient.set(row.patient_id, row.score);
    }
  }
  if (latestByPatient.size === 0) return null;
  const values = [...latestByPatient.values()];
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Returns null if the org has no contract on file. */
export async function getContractPerformance(
  supabase: SupabaseClient<Database>,
  organisationId: string
): Promise<ContractPerformance | null> {
  const { data: contract } = await supabase
    .from("outcomes_contracts")
    .select("contract_type, outcome_thresholds, payout_terms, effective_from")
    .eq("organisation_id", organisationId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!contract) return null;

  const { data: patients } = await supabase
    .from("profiles")
    .select("id")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  const patientIds = (patients ?? []).map((p) => p.id);

  const rawThresholds = Array.isArray(contract.outcome_thresholds)
    ? (contract.outcome_thresholds as unknown as OutcomeThreshold[])
    : [];

  const thresholds: OutcomeThresholdWithActual[] = await Promise.all(
    rawThresholds.map(async (t) => {
      let actual: number | null = null;
      if (isKnownMetric(t.metric)) {
        actual =
          t.metric === "screening_compliance_percent"
            ? await computeScreeningCompliancePercent(supabase, patientIds)
            : await computeAverageBpControlPercent(supabase, patientIds);
      }
      const meetsTarget =
        actual === null ? null : t.better_when === "higher" ? actual >= t.target : actual <= t.target;
      return { ...t, actual, meetsTarget };
    })
  );

  return {
    contractType: contract.contract_type,
    effectiveFrom: contract.effective_from,
    payoutTerms: contract.payout_terms,
    thresholds,
  };
}
