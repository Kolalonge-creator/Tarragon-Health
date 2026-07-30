import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

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
 * Everyone whose wallet the caller may top up: any profile_access grant, at
 * either level. Mirrors private.can_fund_wallet exactly — money may flow in
 * from anyone the record owner has consented to, while spending stays with the
 * account holder alone (public.wallet_pay_booking_order refuses any wallet but
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
