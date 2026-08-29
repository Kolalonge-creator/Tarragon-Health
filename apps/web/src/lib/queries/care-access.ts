import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CAREGIVER_PERMISSIONS, type CaregiverPermission } from "@/lib/validation/care-access";

export interface AccessibleProfile {
  id: string;
  full_name: string | null;
  date_of_birth: string | null;
  sex: "male" | "female" | null;
  is_dependent_account: boolean;
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
      "profile:profiles!profile_access_profile_id_fkey(id, full_name, date_of_birth, sex, is_dependent_account)"
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
 * Filters on is_dependent_account rather than on permission_level alone,
 * because an eldercare care_access_requests 'manage' grant (two adults, each
 * with their own account) produces an identical profile_access row and must
 * NOT appear here — see useAdultsIManage below for that surface.
 *
 * Powers the "whose vaccinations?" subject selector. A next of kin holds
 * 'view' and deliberately does not appear here: they can follow the record,
 * not write to it.
 */
export function useManagedDependents() {
  return useQuery({
    queryKey: ["managed-dependents"],
    queryFn: async () => (await profilesGrantedTo("manage")).filter((p) => p.is_dependent_account),
  });
}

/**
 * Adults the caller may act on under the eldercare flow — a 'manage' grant
 * accepted through care_access_requests between two people who each hold
 * their own account, as opposed to a child dependant who has none. See
 * useManagedDependents for the is_dependent_account split this relies on.
 */
export function useAdultsIManage() {
  return useQuery({
    queryKey: ["adults-i-manage"],
    queryFn: async () =>
      (await profilesGrantedTo("manage")).filter((p) => !p.is_dependent_account),
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

export interface CareFollower {
  grantId: string;
  profileId: string;
  fullName: string | null;
  permissionLevel: "view" | "manage";
  /** They can read this person's health information. */
  clinicalAccess: boolean;
  clinicalAccessUpdatedAt: string | null;
  since: string;
  /** null = unrestricted (every capability a manage/view grant already implies). */
  permissions: CaregiverPermission[] | null;
  /** null = permanent. */
  expiresAt: string | null;
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
          `id, permission_level, clinical_access, clinical_access_updated_at, created_at,
           permissions, expires_at,
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
            clinicalAccessUpdatedAt: row.clinical_access_updated_at,
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
 * Turn health visibility on or off for one person.
 *
 * A plain update: profile_access_update already restricts the row to its owner,
 * and private.enforce_clinical_access_consent_owner refuses the change to
 * anyone else regardless — including a superadmin, so there is no privileged
 * path around this that a server action would need to guard.
 */
export function useSetClinicalAccess() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { grantId: string; allow: boolean }) => {
      const supabase = createClient();
      const { error } = await supabase
        .from("profile_access")
        .update({ clinical_access: input.allow })
        .eq("id", input.grantId);
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
