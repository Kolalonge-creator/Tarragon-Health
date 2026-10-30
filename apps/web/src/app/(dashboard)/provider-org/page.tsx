import { createClient } from "@/lib/supabase/server";
import { resolveSelectedProviderOrg } from "@/lib/provider-org/scope";
import { OrgPicker } from "./org-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { LoadFailure } from "@/components/ui/load-failure";
import { NAV_ICON } from "@/lib/icons";
import { providerOverview } from "@/lib/provider-org/overview-summary";
import { providerOrgFirstView } from "@/lib/provider-org/first-view";
import { ProviderOrgFirst } from "./provider-org-first";

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
  const overview = providerOverview(await supabase.rpc("provider_org_analytics", { p_organisation_id: selected.id }));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}</h1>
        <OrgPicker options={options} selectedId={selected.id} />
      </div>

      {overview.kind === "failed" && (
        <LoadFailure>
          This organisation&apos;s figures could not be loaded just now. They are unknown, not zero. Refresh the page to
          try again.
        </LoadFailure>
      )}

      <ProviderOrgFirst view={providerOrgFirstView(overview, selected.id)} />

      {overview.kind === "ready" && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile icon={NAV_ICON.members} label="Staff" value={String(overview.staff)} />
            <StatTile icon={NAV_ICON.region} label="Locations" value={String(overview.analytics.structure.locations)} />
            <StatTile icon={NAV_ICON.referral} label="Open referrals" value={String(overview.openReferrals)} />
            <StatTile
              icon={NAV_ICON.statements}
              label="Avg. referral response"
              value={overview.avgResponseHours === null ? "None yet" : String(overview.avgResponseHours)}
              unit={overview.avgResponseHours === null ? undefined : "hrs"}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Referral queue</CardTitle>
                <CardDescription>28.8: referrals routed to this organisation, by status.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1 text-sm">
                  {Object.entries(overview.analytics.referrals_by_status).map(([status, n]) => (
                    <li key={status} className="flex justify-between">
                      <span className="capitalize text-charcoal-ink/70">{status.replace(/_/g, " ")}</span>
                      <span className="font-medium">{n}</span>
                    </li>
                  ))}
                  {Object.keys(overview.analytics.referrals_by_status).length === 0 && (
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
                    <span className="font-medium">{overview.analytics.structure.departments}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-charcoal-ink/70">Services</span>
                    <span className="font-medium">{overview.analytics.structure.services}</span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-charcoal-ink/70">Resources</span>
                    <span className="font-medium">{overview.analytics.structure.resources}</span>
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
