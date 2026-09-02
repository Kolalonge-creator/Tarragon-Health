import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { LocationsManager } from "./locations-manager";

export default async function ProviderOrgLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Locations</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: locations } = await supabase
    .from("provider_org_locations")
    .select("id, name, city, state, address, is_headquarters, is_active")
    .eq("organisation_id", selected.id)
    .eq("is_active", true)
    .order("is_headquarters", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name} — Locations</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>
      <LocationsManager organisationId={selected.id} locations={locations ?? []} />
    </div>
  );
}
