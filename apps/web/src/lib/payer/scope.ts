import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";

export type InsurerOption = { id: string; name: string };

/**
 * Every insurer the signed-in caller may act for. A Tarragon superadmin can
 * act for all of them (private.is_payer_admin_for grants admin
 * unconditionally); a payer_admin only for the insurer(s) they hold an
 * active payer_administrators seat at. Used to drive the insurer picker
 * every /payer page needs once an admin or a multi-insurer seat-holder is
 * involved.
 */
export async function getPayerInsurerOptions(): Promise<InsurerOption[]> {
  const profile = await getCurrentProfile();
  const supabase = await createClient();

  if (profile?.role === "admin") {
    const { data } = await supabase.from("insurers").select("id, name").order("name");
    return data ?? [];
  }

  const { data } = await supabase
    .from("payer_administrators")
    .select("insurer_id, insurers(id, name)")
    .eq("is_active", true);

  return (data ?? [])
    .map((row) => row.insurers)
    .filter((i): i is { id: string; name: string } => Boolean(i));
}

/** Resolves which insurer a page should show: the `insurer` search param if
 * valid, otherwise the caller's only option, otherwise null (render a
 * picker). */
export async function resolveSelectedInsurer(
  requestedId: string | undefined
): Promise<{ options: InsurerOption[]; selected: InsurerOption | null }> {
  const options = await getPayerInsurerOptions();
  const selected =
    options.find((o) => o.id === requestedId) ?? (options.length === 1 ? options[0] : null);
  return { options, selected };
}
