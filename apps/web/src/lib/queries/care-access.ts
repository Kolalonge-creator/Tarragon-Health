import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";

export interface AccessibleProfile {
  id: string;
  full_name: string | null;
  date_of_birth: string | null;
  sex: "male" | "female" | null;
}

async function profilesGrantedTo(level: "manage" | null): Promise<AccessibleProfile[]> {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  let query = supabase
    .from("profile_access")
    .select("profile:profiles!profile_access_profile_id_fkey(id, full_name, date_of_birth, sex)")
    .eq("grantee_user_id", user.id);
  if (level) query = query.eq("permission_level", level);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .map((row) => row.profile)
    .filter((profile): profile is AccessibleProfile => profile !== null);
}

/**
 * Profiles the caller may act on, not merely read — a 'manage' grant. Today
 * that is exclusively children provisioned through addChildDependentAction,
 * who have no login of their own and need somebody to log doses for them.
 *
 * Powers the "whose vaccinations?" subject selector. A next of kin holds
 * 'view' and deliberately does not appear here: they can follow the record,
 * not write to it.
 */
export function useManagedDependents() {
  return useQuery({
    queryKey: ["managed-dependents"],
    queryFn: () => profilesGrantedTo("manage"),
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
