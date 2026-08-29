import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export type DependentKind = "minor_child" | "elder_proxy";

export interface AccessibleProfile {
  id: string;
  full_name: string | null;
  date_of_birth: string | null;
  sex: "male" | "female" | null;
  is_dependent_account: boolean;
  dependent_kind: DependentKind | null;
  majority_review_at: string | null;
}

async function profilesGrantedTo(level: "manage" | null): Promise<AccessibleProfile[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  let query = supabase
    .from("profile_access")
    .select(
      "profile:profiles!profile_access_profile_id_fkey(id, full_name, date_of_birth, sex, is_dependent_account, dependent_kind, majority_review_at)"
    )
    .eq("grantee_user_id", user.id);
  if (level) query = query.eq("permission_level", level);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.profile)
    .filter((profile): profile is AccessibleProfile => profile !== null);
}

/**
 * Profiles the caller may act on, not merely read — a 'manage' grant, AND a
 * child with no login of their own, provisioned through addChildDependentAction.
 * Filters on dependent_kind === 'minor_child' rather than on
 * is_dependent_account alone, because an elder_proxy dependant (provisioned
 * through addElderProxyDependentAction, see 20260829082917) is also
 * is_dependent_account but must render as an adult, not a child — see
 * useAdultsIManage below, which now covers both the elder_proxy case and the
 * pre-existing eldercare care_access_requests case.
 *
 * Powers the "whose vaccinations?" subject selector. A next of kin holds
 * 'view' and deliberately does not appear here: they can follow the record,
 * not write to it.
 */
export function useManagedDependents() {
  return useQuery({
    queryKey: ["managed-dependents"],
    queryFn: async () =>
      (await profilesGrantedTo("manage")).filter((p) => p.dependent_kind === "minor_child"),
  });
}

/**
 * Adults the caller may act on: either an eldercare care_access_requests
 * 'manage' grant (two people who each hold their own account), or an
 * elder_proxy dependant with no login of their own (dependent_kind ===
 * 'elder_proxy', see 20260829082917) — both render here as "an adult I
 * manage" rather than under DependantsList's "children" framing. See
 * useManagedDependents for the minor_child split this relies on.
 */
export function useAdultsIManage() {
  return useQuery({
    queryKey: ["adults-i-manage"],
    queryFn: async () =>
      (await profilesGrantedTo("manage")).filter((p) => p.dependent_kind !== "minor_child"),
  });
}

/**
 * Everyone the caller may buy care for: any profile_access grant, at
 * either level. Mirrors private.can_purchase_voucher_for exactly — money may flow in
 * from anyone the record owner has consented to, while spending stays with the
 * account holder alone, or a 'manage' grantee (public.redeem_care_voucher refuses any voucher but
 * the caller's own).
 *
 * Not a diaspora feature. A son in Lagos funding his mother in Enugu uses the
 * same path, in naira, with no currency conversion involved.
 */
export function useSponsorableProfiles() {
  return useQuery({
    queryKey: ["sponsorable-profiles"],
    queryFn: () => profilesGrantedTo(null),
  });
}

export type ClinicalAccessLevel = "none" | "summary" | "full";

export interface HouseholdMember {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  clinicalAccessLevel: ClinicalAccessLevel;
  isDependentAccount: boolean;
  dependentKind: DependentKind | null;
}

/**
 * Everyone in the caller's care circle, any grant level — the household this
 * account is part of, for the family-wide overview
 * (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.5, "no household task/dashboard
 * rollup"). Unlike useSponsorableProfiles (money-shaped: id/name/DOB/sex,
 * built for the voucher-purchase flow), this carries what a health rollup
 * actually needs to decide what it may show per person — the grant level and
 * clinical_access_level straight off profile_access, not re-derived.
 */
export function useHouseholdCareCircle() {
  return useQuery({
    queryKey: ["household-care-circle"],
    queryFn: async (): Promise<HouseholdMember[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("profile_access")
        .select(
          `permission_level, clinical_access_level,
           profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account, dependent_kind)`
        )
        .eq("grantee_user_id", user.id);
      if (error) throw error;

      return (data ?? []).flatMap((row) => {
        if (!row.profile) return [];
        return [
          {
            profileId: row.profile.id,
            fullName: row.profile.full_name,
            permissionLevel: row.permission_level as "view" | "manage",
            clinicalAccessLevel: row.clinical_access_level as ClinicalAccessLevel,
            isDependentAccount: row.profile.is_dependent_account,
            dependentKind: row.profile.dependent_kind as DependentKind | null,
          },
        ];
      });
    },
  });
}

export interface CareFollower {
  grantId: string;
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  /** They can read this person's health information (clinicalAccessLevel !== "none"). */
  clinicalAccess: boolean;
  /**
   * none: no health information. summary: day-to-day monitoring (vitals,
   * care plan status, medications, messages). full: additionally, lab
   * results and blood profile — see 20260829083614.
   */
  clinicalAccessLevel: ClinicalAccessLevel;
  clinicalAccessUpdatedAt: string | null;
  since: string;
}

/**
 * The people who can see the caller's own record, from the caller's side.
 *
 * The mirror image of useSponsorableProfiles, and the list the consent switch
 * hangs off. Reading the grantee's name at all depends on
 * profiles_select_my_grantees (20260731181822) — before that policy, a patient
 * could give someone access and never be shown who they were.
 */
export function useMyCareFollowers() {
  return useQuery({
    queryKey: ["my-care-followers"],
    queryFn: async (): Promise<CareFollower[]> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { data, error } = await supabase
        .from("profile_access")
        .select(
          `id, permission_level, clinical_access, clinical_access_level, clinical_access_updated_at, created_at,
           grantee:profiles!profile_access_grantee_user_id_fkey(id, full_name)`
        )
        .eq("profile_id", user.id)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return (data ?? []).flatMap((row) => {
        if (!row.grantee) return [];
        return [
          {
            grantId: row.id,
            profileId: row.grantee.id,
            fullName: row.grantee.full_name,
            permissionLevel: row.permission_level as "view" | "manage",
            clinicalAccess: row.clinical_access === true,
            clinicalAccessLevel: row.clinical_access_level as ClinicalAccessLevel,
            clinicalAccessUpdatedAt: row.clinical_access_updated_at,
            since: row.created_at,
          },
        ];
      });
    },
  });
}

/**
 * Change health-visibility level for one person: none, summary (day-to-day
 * monitoring — vitals, care plan status, medications, messages), or full
 * (additionally, lab results and blood profile). See
 * 20260829083614_graded_clinical_access_levels.sql.
 *
 * A plain update: profile_access_update already restricts the row to its owner,
 * and private.enforce_clinical_access_consent_owner refuses the change to
 * anyone else regardless — including a superadmin, so there is no privileged
 * path around this that a server action would need to guard. clinical_access
 * itself is a generated column since that migration and can no longer be
 * written directly — clinical_access_level is the only thing this ever sets.
 */
export function useSetClinicalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; level: ClinicalAccessLevel }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("profile_access")
        .update({ clinical_access_level: input.level })
        .eq("id", input.grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
  });
}
