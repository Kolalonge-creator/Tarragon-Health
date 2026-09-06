import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { ClaimsManager } from "./claims-manager";

export default async function PayerClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Claims</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("insurance_claims")
    .select(
      "id, service_category, billed_amount_kobo, insurer_covered_kobo, patient_copay_kobo, status, claim_reference, denial_reason, submitted_at, insurance_policies(insurer_id, plan_name)"
    )
    .eq("insurance_policies.insurer_id", selected.id)
    .order("submitted_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Claims</h1>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <ClaimsManager rows={rows ?? []} />
    </div>
  );
}
