import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "../insurer-picker";
import { ProgrammesManager } from "./programmes-manager";

export default async function PayerProgrammesPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Care programmes</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: directives }, { data: programmes }] = await Promise.all([
    supabase
      .from("payer_programme_directives")
      .select("id, programme_id, is_active, chronic_condition_programmes(name, condition)")
      .eq("insurer_id", selected.id)
      .order("created_at", { ascending: false }),
    supabase.from("chronic_condition_programmes").select("id, name, condition").eq("is_active", true).order("name"),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            {selected.name}: Care programmes
          </h1>
          <p className="text-sm text-charcoal-ink/60">
            27.9: &ldquo;All members with hypertension receive BP monitoring and structured follow-up.&rdquo;
            Applying a directive only enrols members whose condition a Tarragon clinician already diagnosed.
          </p>
        </div>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>
      <ProgrammesManager
        insurerId={selected.id}
        directives={
          (directives ?? []).map((d) => ({
            id: d.id,
            programme_id: d.programme_id,
            is_active: d.is_active,
            programme_name: d.chronic_condition_programmes?.name ?? "—",
            condition: d.chronic_condition_programmes?.condition ?? "—",
          }))
        }
        programmes={programmes ?? []}
      />
    </div>
  );
}
