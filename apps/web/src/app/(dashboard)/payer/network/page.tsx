import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { NetworkManager } from "./network-manager";

export default async function PayerNetworkPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Provider network</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("payer_network_providers")
    .select("id, provider_type, provider_id, status, service_category, notes")
    .eq("insurer_id", selected.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name} — Provider network</h1>
          <p className="text-sm text-charcoal-ink/60">
            27.12. No row for a provider means default open-network coverage — add a row only to name an
            exception (in-network, out-of-network, or restricted to one benefit).
          </p>
        </div>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <NetworkManager insurerId={selected.id} rows={rows ?? []} />
    </div>
  );
}
