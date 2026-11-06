import { createClient } from "@/lib/supabase/server";
import { formatPatientDate } from "@/lib/format-date";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SuggestPlacePanel } from "@/components/diagnostic-directory/suggest-place-panel";
import { loadSuggestedPlace } from "@/lib/diagnostic-directory/orders";
import { loadPlaceContext } from "./place-context";

const OPEN = ["ordered", "payment_confirmed", "sample_collected", "processing", "sample_rejected"];

/**
 * Diagnostic directory Phase 5: for each open lab request, the doctor can suggest a branch that passes every directory check
 * for the chosen test. Shown only to clinical-tier staff; the suggestion is advice and the patient may go anywhere.
 */
export async function LabOrderPlacesSection({ patientId }: { patientId: string }) {
  const supabase = await createClient();
  const [{ data: orders, error }, ctx] = await Promise.all([
    supabase.from("lab_orders").select("id, order_number, ordered_at, status, panel_bundle:panel_bundles!lab_orders_panel_bundle_id_fkey(name)")
      .eq("patient_id", patientId).in("status", OPEN as never).order("ordered_at", { ascending: false }).limit(20),
    loadPlaceContext(patientId, "lab"),
  ]);
  if (error || !Array.isArray(orders) || orders.length === 0) return null;
  const places = await Promise.all(orders.map((o: { id: string }) => loadSuggestedPlace("lab", o.id)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where to have lab requests done</CardTitle>
        <CardDescription>Suggest a verified branch near the patient for an open request. The patient sees it in the app and may still go anywhere.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {orders.map((o: { id: string; order_number: string | null; ordered_at: string; panel_bundle: { name: string } | null }, i: number) => {
            const read = places[i];
            return (
              <li key={o.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
                <p className="text-sm font-medium text-charcoal-ink">
                  {o.panel_bundle?.name ?? "Lab request"} <span className="text-xs font-normal text-charcoal-ink/60">{o.order_number ?? ""} · {formatPatientDate(o.ordered_at)}</span>
                </p>
                {read.ok ? (
                  <SuggestPlacePanel kind="lab" orderId={o.id} patientId={patientId} patientState={ctx.state} patientLga={ctx.lga}
                    tests={ctx.tests} current={read.place} />
                ) : (
                  <p role="alert" className="text-xs text-amber-900">The suggested place could not be loaded.</p>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
