import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type ProviderOrgOption = { id: string; name: string };

/**
 * Every provider organisation the signed-in caller may act for. Mirrors
 * lib/payer/scope.ts exactly: a Tarragon superadmin sees every provider_org
 * organisation (private.is_provider_org_staff_for grants admin
 * unconditionally); a provider_org_staff login only sees the
 * organisation(s) it holds an active provider_org_members seat at.
 */
export async function getProviderOrgOptions(): Promise<ProviderOrgOption[]> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  if (profile?.role === "admin") {
    const { data } = await supabase
      .from("provider_organisations")
      .select("organisation_id, display_name, legal_name")
      .order("legal_name");
    return (data ?? []).map((o) => ({
      id: o.organisation_id,
      name: o.display_name ?? o.legal_name,
    }));
  }

  const { data } = await supabase
    .from("provider_org_members")
    .select("organisation_id, organisations(name)")
    .eq("is_active", true);

  return (data ?? [])
    .filter((row) => row.organisations)
    .map((row) => ({ id: row.organisation_id, name: row.organisations!.name }));
}

export async function resolveSelectedProviderOrg(
  requestedId: string | undefined
): Promise<{ options: ProviderOrgOption[]; selected: ProviderOrgOption | null }> {
  const options = await getProviderOrgOptions();
  const selected =
    options.find((o) => o.id === requestedId) ?? (options.length === 1 ? options[0] : null);
  return { options, selected };
}
