import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { TeamManager } from "./team-manager";

export default async function PayerTeamPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Team</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data: seats } = await supabase
    .from("payer_administrators")
    .select("id, payer_role, job_title, is_active, profiles!payer_administrators_profile_id_fkey(full_name)")
    .eq("insurer_id", selected.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name} — Team</h1>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <TeamManager
        insurerId={selected.id}
        seats={(seats ?? []).map((s) => ({
          id: s.id,
          payer_role: s.payer_role,
          job_title: s.job_title,
          is_active: s.is_active,
          full_name: s.profiles?.full_name ?? "—",
        }))}
      />
    </div>
  );
}
