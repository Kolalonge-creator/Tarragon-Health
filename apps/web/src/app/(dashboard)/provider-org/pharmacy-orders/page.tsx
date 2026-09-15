import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type OrderRow = {
  order_id: string;
  order_number: string | null;
  status: string;
  patient_name: string | null;
  patient_number: string | null;
  total_kobo: number | null;
  requested_at: string;
  delivered_at: string | null;
};

export default async function ProviderOrgPharmacyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Pharmacy orders</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("provider_org_pharmacy_order_queue", { p_organisation_id: selected.id });
  const orders = (data ?? []) as OrderRow[];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
            {selected.name}: Pharmacy orders
          </h1>
          <p className="text-sm text-charcoal-ink/60">
            Dispensing stays a pharmacist login&apos;s job. This is visibility only.
          </p>
        </div>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Orders routed to this organisation&apos;s claimed pharmacy</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No orders yet, or this organisation hasn&apos;t claimed a pharmacy directory row (Admin → Partners).
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th className="py-2 pr-4">Patient</th>
                    <th className="py-2 pr-4">Total</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Requested</th>
                    <th className="py-2 pr-4">Delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.order_id} className="border-t border-charcoal-ink/10">
                      <td className="py-2 pr-4">
                        {o.patient_name} <span className="text-charcoal-ink/50">{o.patient_number}</span>
                      </td>
                      <td className="py-2 pr-4">
                        {o.total_kobo !== null ? `₦${(o.total_kobo / 100).toLocaleString()}` : "—"}
                      </td>
                      <td className="py-2 pr-4">
                        <Badge>{o.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="py-2 pr-4">{new Date(o.requested_at).toLocaleDateString()}</td>
                      <td className="py-2 pr-4">{o.delivered_at ? new Date(o.delivered_at).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
