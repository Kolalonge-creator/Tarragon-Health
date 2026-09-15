import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { StaffManager } from "./staff-manager";

export default async function ProviderOrgStaffPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Staff</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: seats } = await supabase
    .from("provider_org_members")
    .select("id, org_role, job_title, is_active, profiles!provider_org_members_profile_id_fkey(full_name)")
    .eq("organisation_id", selected.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Staff</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>
      <StaffManager
        organisationId={selected.id}
        seats={(seats ?? []).map((s) => ({
          id: s.id,
          org_role: s.org_role,
          job_title: s.job_title,
          is_active: s.is_active,
          full_name: s.profiles?.full_name ?? "—",
        }))}
      />
    </div>
  );
}
