import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isCohortSuppressed } from "@/lib/institutions/suppression";

/**
 * Spec §43.15 — vaccination coverage analytics for employers/insurers.
 *
 * Same posture as loadCareGaps/loadCohortAnalytics: I9 forbids an institution
 * reaching an individual, so every count here is a set size, never a member
 * list, and every cell — not just the dashboard as a whole — is subject to
 * small-cell suppression. The org-wide gate (this function returning null
 * below the floor) only protects the TOTALS; a by-vaccine or by-state
 * breakdown can still isolate a handful of people inside an org that is
 * otherwise large enough, exactly the failure mode
 * public.get_geo_health_aggregates() already guards against for the
 * platform-wide analyst console. suppressSmallCount mirrors its "null out
 * the whole cell, not just round it" rule; a by-state row is dropped
 * entirely (not merely value-suppressed) when the state's own eligible
 * population is below the floor, same as that RPC nulls every column
 * including the count itself.
 */

export type VaccinationCoverageByVaccine = {
  vaccinationCatalogId: string;
  vaccineName: string;
  /** null = suppressed (nonzero but below the org's cohort floor). */
  vaccinatedCount: number | null;
  overdueCount: number | null;
};

export type VaccinationCoverageByState = {
  state: string;
  eligibleCount: number;
  vaccinatedCount: number | null;
};

export type VaccinationCoverageSummary = {
  eligiblePopulation: number;
  vaccinatedCount: number;
  overdueCount: number;
  uptakePercent: number;
  byVaccine: VaccinationCoverageByVaccine[];
  byState: VaccinationCoverageByState[];
  /** States with an eligible population under the floor — omitted rather
   * than shown as zero, so the UI can say "N further states not shown". */
  suppressedStateCount: number;
};

function suppressSmallCount(count: number, minCohortSize: number): number | null {
  return count > 0 && count < minCohortSize ? null : count;
}

export async function loadVaccinationCoverage(
  supabase: SupabaseClient<Database>,
  organisationId: string,
  minCohortSize: number
): Promise<VaccinationCoverageSummary | null> {
  const { data: patients } = await supabase
    .from("profiles")
    .select("id, state")
    .eq("organisation_id", organisationId)
    .eq("role", "patient");
  if (!patients || patients.length === 0) return null;
  if (isCohortSuppressed(patients.length, minCohortSize)) return null;

  const patientIds = patients.map((p) => p.id);
  const stateByPatient = new Map(patients.map((p) => [p.id, p.state ?? null]));

  const [{ data: catalog }, { data: records }, { data: schedules }] = await Promise.all([
    supabase.from("vaccination_catalog").select("id, name").eq("is_active", true),
    supabase
      .from("vaccination_records")
      .select("profile_id, vaccination_catalog_id")
      .in("profile_id", patientIds),
    supabase
      .from("vaccination_schedules")
      .select("patient_id, vaccination_catalog_id")
      .in("patient_id", patientIds)
      .eq("status", "overdue"),
  ]);

  const vaccinatedPatientIds = new Set((records ?? []).map((r) => r.profile_id));
  const overduePatientIds = new Set((schedules ?? []).map((s) => s.patient_id));

  const vaccinatedByVaccine = new Map<string, Set<string>>();
  for (const r of records ?? []) {
    const set = vaccinatedByVaccine.get(r.vaccination_catalog_id) ?? new Set<string>();
    set.add(r.profile_id);
    vaccinatedByVaccine.set(r.vaccination_catalog_id, set);
  }
  const overdueByVaccine = new Map<string, Set<string>>();
  for (const s of schedules ?? []) {
    const set = overdueByVaccine.get(s.vaccination_catalog_id) ?? new Set<string>();
    set.add(s.patient_id);
    overdueByVaccine.set(s.vaccination_catalog_id, set);
  }
  const byVaccine: VaccinationCoverageByVaccine[] = (catalog ?? [])
    .map((c) => {
      const vaccinated = vaccinatedByVaccine.get(c.id)?.size ?? 0;
      const overdue = overdueByVaccine.get(c.id)?.size ?? 0;
      return {
        vaccinationCatalogId: c.id,
        vaccineName: c.name,
        vaccinatedCount: suppressSmallCount(vaccinated, minCohortSize),
        overdueCount: suppressSmallCount(overdue, minCohortSize),
      };
    })
    // A vaccine nobody in this org has any record of is noise, not signal.
    .filter((v) => v.vaccinatedCount !== 0 || v.overdueCount !== 0);

  const eligibleByState = new Map<string, number>();
  for (const p of patients) {
    if (!p.state) continue;
    eligibleByState.set(p.state, (eligibleByState.get(p.state) ?? 0) + 1);
  }
  const vaccinatedByState = new Map<string, Set<string>>();
  for (const patientId of vaccinatedPatientIds) {
    const state = stateByPatient.get(patientId);
    if (!state) continue;
    const set = vaccinatedByState.get(state) ?? new Set<string>();
    set.add(patientId);
    vaccinatedByState.set(state, set);
  }

  let suppressedStateCount = 0;
  const byState: VaccinationCoverageByState[] = [];
  for (const [state, eligibleCount] of eligibleByState) {
    if (eligibleCount < minCohortSize) {
      suppressedStateCount += 1;
      continue;
    }
    byState.push({
      state,
      eligibleCount,
      vaccinatedCount: suppressSmallCount(vaccinatedByState.get(state)?.size ?? 0, minCohortSize),
    });
  }
  byState.sort((a, b) => b.eligibleCount - a.eligibleCount);

  const vaccinatedCount = vaccinatedPatientIds.size;
  const eligiblePopulation = patients.length;

  return {
    eligiblePopulation,
    vaccinatedCount,
    overdueCount: overduePatientIds.size,
    uptakePercent:
      eligiblePopulation > 0 ? Math.round((vaccinatedCount / eligiblePopulation) * 1000) / 10 : 0,
    byVaccine,
    byState,
    suppressedStateCount,
  };
}
