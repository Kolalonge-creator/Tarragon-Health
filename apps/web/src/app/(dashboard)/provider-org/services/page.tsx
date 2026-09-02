import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { ServicesManager } from "./services-manager";

export default async function ProviderOrgServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Services</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: services } = await supabase
    .from("provider_org_services")
    .select("id, name, description, duration_minutes, price_kobo")
    .eq("organisation_id", selected.id)
    .eq("is_active", true)
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name} — Services</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>
      <ServicesManager organisationId={selected.id} services={services ?? []} />
    </div>
  );
}
