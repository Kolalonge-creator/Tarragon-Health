import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { isCohortSuppressed, effectiveMinCohortSize } from "./suppression";

/**
 * I9 — institutions get aggregate only.
 *
 * As of 2026-07-29 an employer/HMO administrator reads ZERO rows from every
 * patient-scoped table: private.is_org_staff excludes their roles, which is
 * what governs the 314 policies on 110 tables. That is deliberate and is the
 * real enforcement — not a UI decision that a future refactor could undo.
 *
 * The aggregate dashboards therefore cannot run under the caller's own
 * session any more. This module is the single, deliberately narrow doorway
 * they go through instead: verify the caller really is an institution
 * administrator for the organisation they are asking about, then hand back a
 * service-role client together with the org's suppression threshold.
 *
 * Two rules for anything built on top of this:
 *   1. Only ever emit aggregates. The client returned here bypasses RLS, so
 *      a per-member field added downstream would be a real re-identification
 *      leak, not a cosmetic one. The per-member care-gap list removed on
 *      2026-07-29 is exactly the shape to avoid.
 *   2. Respect `suppressed`. A percentage over four people is individual
 *      health data wearing a percentage sign.
 */

export type InstitutionAggregateAccess = {
  client: SupabaseClient<Database>;
  organisationId: string;
  /** organisations.min_cohort_size — the small-cell floor for this org. */
  minCohortSize: number;
  /** Enrolled patients in the org, the denominator suppression is judged on. */
  cohortSize: number;
  /** True when the cohort is too small to show any derived figure at all. */
  suppressed: boolean;
};

/**
 * Returns null when the caller is not entitled to this organisation's
 * aggregates — an unauthenticated visitor, a patient, a clinician who wandered
 * in, or an institution admin asking about someone else's organisation. A
 * platform admin (superadmin) passes for any organisation, which is the one
 * exception I9 names.
 */
export async function requireInstitutionAggregateAccess(
  organisationId: string,
): Promise<InstitutionAggregateAccess | null> {
  // Read the caller's own row through their own session, never the service
  // role — the identity check must not use the credential it is gating.
  const rls = await createClient();
  const {
    data: { user },
  } = await rls.auth.getUser();
  if (!user) return null;

  const { data: profile } = await rls
    .from("profiles")
    .select("role, organisation_id")
    .eq("id", user.id)
    .single();
  if (!profile) return null;

  const isSuperadmin = profile.role === "admin";
  const isInstitutionAdmin =
    profile.role === "corporate_admin" || profile.role === "hmo_admin";
  if (!isSuperadmin && !isInstitutionAdmin) return null;
  if (!isSuperadmin && profile.organisation_id !== organisationId) return null;

  const client = createServiceRoleClient();

  const [{ data: org }, { count }] = await Promise.all([
    client.from("organisations").select("min_cohort_size").eq("id", organisationId).single(),
    client
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("role", "patient"),
  ]);

  const minCohortSize = effectiveMinCohortSize(org?.min_cohort_size);
  const cohortSize = count ?? 0;

  return {
    client,
    organisationId,
    minCohortSize,
    cohortSize,
    suppressed: isCohortSuppressed(cohortSize, minCohortSize),
  };
}
