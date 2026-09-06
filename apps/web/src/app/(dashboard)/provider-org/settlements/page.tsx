import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { SettlementsManager } from "./settlements-manager";

export default async function ProviderOrgSettlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Settlements</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: settlements } = await supabase
    .from("provider_org_settlements")
    .select("id, reference, period_start, period_end, invoiced_total_kobo, status")
    .eq("organisation_id", selected.id)
    .order("period_start", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Settlements</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>
      <SettlementsManager organisationId={selected.id} settlements={settlements ?? []} />
    </div>
  );
}
