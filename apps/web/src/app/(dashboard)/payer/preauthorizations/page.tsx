import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { PreauthorizationsManager } from "./preauthorizations-manager";

export default async function PayerPreauthorizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Pre-authorisations</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  // insurance_preauthorizations_payer_select scopes this to the caller's
  // own insurer's requests via the policy → insurer join — no separate
  // insurer_id filter needed here beyond what the query already asks for.
  const { data: rows } = await supabase
    .from("insurance_preauthorizations")
    .select(
      "id, service_category, estimated_amount_kobo, clinical_justification, status, authorization_number, denial_reason, requested_at, insurance_policies(insurer_id, plan_name)"
    )
    .eq("insurance_policies.insurer_id", selected.id)
    .order("requested_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          {selected.name} — Pre-authorisations
        </h1>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <PreauthorizationsManager rows={rows ?? []} />
    </div>
  );
}
