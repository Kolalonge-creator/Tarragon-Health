import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PANEL_CODES, panelDefinitionSchema, type PanelDefinition } from "@/lib/lab-results/structured";
import { OrderResultCard, type PortalOrder } from "./result-entry";

export default async function LabPartnerResultsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "lab_partner") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-sm text-charcoal-ink/70">This area is for partner laboratories.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: orderRows }, ...panelResults] = await Promise.all([
    supabase.rpc("lab_partner_portal_orders"),
    ...PANEL_CODES.map((p) => supabase.rpc("lab_panel_definition", { p_panel: p })),
  ]);
  const orders = (orderRows ?? []) as PortalOrder[];
  const panels: Record<string, PanelDefinition> = {};
  for (const r of panelResults) {
    const parsed = panelDefinitionSchema.safeParse(r.data);
    if (parsed.success) panels[parsed.data.panel_code] = parsed.data;
  }

  const open = orders.filter((o) => !o.result_received);
  const done = orders.filter((o) => o.result_received);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Enter results</h1>
        <p className="text-charcoal-ink/60">
          Paid orders routed to your lab. Mark a sample collected, then enter the values and attach your report. Units and
          ranges are fixed by the panel. Tarragon decides what is released to the patient.{" "}
          <Link className="underline" href="/lab-partner">Back to the dashboard</Link>
        </p>
      </div>

      <section aria-labelledby="open-heading" className="space-y-3">
        <h2 id="open-heading" className="font-heading text-lg font-semibold">Waiting for a result ({open.length})</h2>
        {open.length === 0 ? <p className="text-sm text-charcoal-ink/60">Nothing is waiting for you.</p> : null}
        {open.map((o) => (
          <OrderResultCard key={o.order_id} order={o} panels={panels} />
        ))}
      </section>

      {done.length > 0 ? (
        <section aria-labelledby="done-heading" className="space-y-3">
          <h2 id="done-heading" className="font-heading text-lg font-semibold">Result received ({done.length})</h2>
          {done.map((o) => (
            <OrderResultCard key={o.order_id} order={o} panels={panels} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
