import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { PlansManager } from "./plans-manager";

export default async function PayerPlansPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Plans</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("payer_plans")
    .select("id, code, name, plan_year, status, effective_from, effective_to")
    .eq("insurer_id", selected.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Plans</h1>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <PlansManager insurerId={selected.id} plans={plans ?? []} />
    </div>
  );
}
