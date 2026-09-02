import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "./org-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { NAV_ICON } from "@/lib/icons";

type Analytics = {
  staff_by_role: Record<string, number>;
  structure: { locations: number; departments: number; services: number; resources: number };
  referrals_by_status: Record<string, number>;
  referral_avg_response_hours: number;
  lab_orders_by_status: Record<string, number>;
  pharmacy_orders_by_status: Record<string, number>;
  settlements_by_status: Record<string, { count: number; invoiced_total_kobo: number }>;
};

function sum(record: Record<string, number> | undefined) {
  return Object.values(record ?? {}).reduce((a, b) => a + b, 0);
}

export default async function ProviderOrgOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedProviderOrg(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Provider organisation</h1>
        <OrgPicker options={options} selectedId={requestedId} />
        {options.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No provider organisation is set up yet. A Tarragon admin creates one, then adds you as staff.
          </p>
        )}
      </div>
    );
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("provider_org_analytics", { p_organisation_id: selected.id });
  const analytics = data as Analytics | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>

      {analytics && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={NAV_ICON.members} label="Staff" value={String(sum(analytics.staff_by_role))} />
            <StatTile icon={NAV_ICON.region} label="Locations" value={String(analytics.structure.locations)} />
            <StatTile icon={NAV_ICON.referral} label="Open referrals" value={String(sum(analytics.referrals_by_status))} />
            <StatTile
              icon={NAV_ICON.statements}
              label="Avg. referral response"
              value={String(analytics.referral_avg_response_hours)}
              unit="hrs"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Referral queue</CardTitle>
                <CardDescription>28.8 — referrals routed to this organisation, by status.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {Object.entries(analytics.referrals_by_status).map(([status, n]) => (
                    <li key={status} className="flex justify-between">
                      <span className="capitalize text-charcoal-ink/70">{status.replace(/_/g, " ")}</span>
                      <span className="font-medium">{n}</span>
                    </li>
                  ))}
                  {Object.keys(analytics.referrals_by_status).length === 0 && (
                    <li className="text-charcoal-ink/60">Nothing routed here yet.</li>
                  )}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Structure</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  <li className="flex justify-between">
                    <span className="text-charcoal-ink/70">Departments</span>
                    <span className="font-medium">{analytics.structure.departments}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-charcoal-ink/70">Services</span>
                    <span className="font-medium">{analytics.structure.services}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-charcoal-ink/70">Resources</span>
                    <span className="font-medium">{analytics.structure.resources}</span>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
