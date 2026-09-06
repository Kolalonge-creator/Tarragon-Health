import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { ResourcesManager } from "./resources-manager";

export default async function ProviderOrgResourcesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Resources</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: resources } = await supabase
    .from("provider_org_resources")
    .select("id, resource_type, name, description")
    .eq("organisation_id", selected.id)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Resources</h1>
          <p className="text-sm text-charcoal-ink/60">
            28.6/28.7: rooms and equipment, configuration only. Add operating hours from Admin once a
            booking feature is built against them.
          </p>
        </div>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>
      <ResourcesManager organisationId={selected.id} resources={resources ?? []} />
    </div>
  );
}
