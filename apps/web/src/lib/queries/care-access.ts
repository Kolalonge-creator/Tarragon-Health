import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CAREGIVER_PERMISSIONS, type CaregiverPermission } from "@/lib/validation/care-access";

export type DependentKind = "minor_child" | "elder_proxy";

/**
 * Matches public.care_access_category exactly. Kept as a plain literal union
 * (not read from database.types.ts) because the enum was added in the same
 * migration as this file's rewrite, ahead of the next types regeneration.
 */
export type CareAccessCategory =
  | "appointments_care_plan"
  | "vitals_readings"
  | "medications"
  | "labs_results"
  | "vaccinations"
  | "messaging"
  | "reproductive_health"
  | "medical_history";

/** Display order and copy for every category checkbox. */
export const CARE_ACCESS_CATEGORIES: { value: CareAccessCategory; label: string }[] = [
  { value: "appointments_care_plan", label: "Appointments and care plan" },
  { value: "vitals_readings", label: "Readings (blood pressure, glucose, weight...)" },
  { value: "medications", label: "Medications" },
  { value: "labs_results", label: "Lab and screening results" },
  { value: "vaccinations", label: "Vaccinations" },
  { value: "messaging", label: "Messages with the care team" },
  { value: "medical_history", label: "Medical history (heart, blood, past reports)" },
];

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

export interface HouseholdMember {
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  /** Which categories of health information this account can currently see for them — empty if none. */
  categories: CareAccessCategory[];
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
 * the category-scoped grants straight off profile_access_categories, not
 * re-derived. Reconciled 2026-09-02: originally read the now-superseded
 * clinical_access_level column (20260829083614, dropped before merge in
 * favour of the already-shipped 8-category profile_access_categories model,
 * 20260830103251) — see the note in docs/FAMILY_CARE_CIRCLE_SPEC.md §3.4.
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
          `permission_level,
           profile:profiles!profile_access_profile_id_fkey(id, full_name, is_dependent_account, dependent_kind),
           categories:profile_access_categories(category)`
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
            categories: (row.categories ?? []).map((c) => c.category as CareAccessCategory),
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
  /** Which categories of health information they can currently see — empty if none. */
  categories: CareAccessCategory[];
  since: string;
  /** null = unrestricted (every capability a manage/view grant already implies). */
  permissions: CaregiverPermission[] | null;
  /** null = permanent. */
  expiresAt: string | null;
}

/**
 * The people who can see the caller's own record, from the caller's side.
 *
 * The mirror image of useSponsorableProfiles, and the list the category
 * checkboxes hang off. Reading the grantee's name at all depends on
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
          `id, permission_level, created_at,
           permissions, expires_at,
           grantee:profiles!profile_access_grantee_user_id_fkey(id, full_name),
           categories:profile_access_categories(category)`
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
            categories: (row.categories ?? []).map((c) => c.category as CareAccessCategory),
            since: row.created_at,
            permissions: row.permissions as CaregiverPermission[] | null,
            expiresAt: row.expires_at,
          },
        ];
      });
    },
  });
}

/**
 * Set exactly which categories of health information one grantee can see.
 *
 * A single RPC call rather than a raw insert/delete: public.set_care_access_categories
 * diffs against the grant's current categories and applies both sides
 * atomically, and is the one choke point the owner-only trigger and the
 * category_access_granted/withdrawn lifecycle logging both fire through.
 * private.enforce_category_access_owner refuses the change to anyone but the
 * record owner regardless — including a superadmin — so there is no
 * privileged path around this a server action would need to guard.
 */
export function useSetCareAccessCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; categories: CareAccessCategory[] }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_care_access_categories", {
        p_grant_id: input.grantId,
        p_categories: input.categories,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
  });
}

/**
 * Narrow (or widen back to unrestricted) what a 'manage' grantee can
 * actually do. Same plain-update shape as useSetClinicalAccess — the
 * profile_access_update policy already restricts this to the record owner,
 * so there is nothing here for a server action to guard that the database
 * does not already guard.
 *
 * Pass null for "everything" (today's default, and every grant made before
 * this feature existed); pass an array to restrict to exactly those
 * capabilities. An empty array is refused client-side before this ever
 * runs — a manage grant with no capability at all is not a narrower grant,
 * it is a confusing way to write "no access."
 */
export function useSetGranularPermissions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; permissions: CaregiverPermission[] | null }) => {
      if (input.permissions !== null && input.permissions.length === 0) {
        throw new Error("Choose at least one thing they can do, or leave it unrestricted.");
      }
      const supabase = createClient();
      const { error } = await supabase
        .from("profile_access")
        .update({
          permissions:
            input.permissions !== null && input.permissions.length >= CAREGIVER_PERMISSIONS.length
              ? null
              : input.permissions,
        })
        .eq("id", input.grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
  });
}

/**
 * Make a grant temporary, extend it, or make it permanent again. Deleting it
 * outright is revokeCareAccessAction (family/care-access-actions.ts); this
 * only ever changes when it ends on its own, never whether it exists now.
 */
export function useSetExpiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; expiresAt: string | null }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("profile_access")
        .update({ expires_at: input.expiresAt })
        .eq("id", input.grantId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
  });
}
