import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "../org-picker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type ReferralRow = {
  referral_id: string;
  referral_number: string | null;
  patient_name: string | null;
  patient_number: string | null;
  specialist_type: string;
  urgency: string;
  status: string;
  referral_reason: string | null;
  appointment_date: string | null;
  created_at: string;
};

const STATUS_BADGE: Record<string, "amber" | "green" | "blue" | "grey" | "red"> = {
  pending_payment: "grey",
  payment_confirmed: "amber",
  booked: "blue",
  completed: "green",
  cancelled: "red",
  closed: "green",
};

export default async function ProviderOrgReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Referrals</h1>
        <OrgPicker options={options} selectedId={requestedId} />
      </div>
    );
  }

  const supabase = await createClient();
  const [{ data: rows }, { data: summary }] = await Promise.all([
    supabase.rpc("provider_org_referral_queue", { p_organisation_id: selected.id }),
    supabase.rpc("provider_org_referral_queue_summary", { p_organisation_id: selected.id }),
  ]);
  const referrals = (rows ?? []) as ReferralRow[];
  const byStatus = (summary ?? {}) as Record<string, number>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}: Referral queue</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>

      <div className="flex flex-wrap gap-3">
        {Object.entries(byStatus).map(([status, n]) => (
          <Badge key={status} variant={STATUS_BADGE[status] ?? "grey"}>
            {status.replace(/_/g, " ")}: {n}
          </Badge>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Referrals routed here</CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No referrals routed to this organisation yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th className="py-2 pr-4">Patient</th>
                    <th className="py-2 pr-4">Specialty</th>
                    <th className="py-2 pr-4">Urgency</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Appointment</th>
                  </tr>
                </thead>
                <tbody>
                  {referrals.map((r) => (
                    <tr key={r.referral_id} className="border-t border-charcoal-ink/10">
                      <td className="py-2 pr-4">
                        {r.patient_name} <span className="text-charcoal-ink/50">{r.patient_number}</span>
                      </td>
                      <td className="py-2 pr-4">{r.specialist_type}</td>
                      <td className="py-2 pr-4 capitalize">{r.urgency}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>{r.status.replace(/_/g, " ")}</Badge>
                      </td>
                      <td className="py-2 pr-4">
                        {r.appointment_date ? new Date(r.appointment_date).toLocaleString() : "—"}
                      </td>
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
