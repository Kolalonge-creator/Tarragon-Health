import { createClient } from "@/lib/supabase/server";
import { resolveSelectedInsurer } from "@/lib/payer/scope";
import { InsurerPicker } from "./insurer-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { NAV_ICON } from "@/lib/icons";

type DashboardAnalytics = {
  suppressed: boolean;
  min_cohort_size: number;
  note?: string;
  member_count?: number;
  programmes?: {
    programme_name: string;
    condition: string;
    members_with_condition: number | null;
    enrolled: number | null;
    controlled: number | null;
    overdue_review: number | null;
    suppressed_subgroup: boolean;
  }[];
};

export default async function PayerOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ insurer?: string }>;
}) {
  const { insurer: requestedId } = await searchParams;
  const { options, selected } = await resolveSelectedInsurer(requestedId);

  if (!selected) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">Payer dashboard</h1>
        <InsurerPicker options={options} selectedId={requestedId} />
        {options.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No insurer is set up yet. A Tarragon admin creates one under Admin → Partners.
          </p>
        )}
      </div>
    );
  }

  const supabase = await createClient();
  const { data: analytics } = await supabase.rpc("payer_dashboard_analytics", {
    p_insurer_id: selected.id,
  });
  const dashboard = analytics as DashboardAnalytics | null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{selected.name}</h1>
        <InsurerPicker options={options} selectedId={selected.id} />
      </div>

      {!dashboard || dashboard.suppressed ? (
        <Card variant="soft">
          <CardHeader>
            <CardTitle>Not enough members yet</CardTitle>
            <CardDescription>
              {dashboard?.note ??
                `Fewer than ${dashboard?.min_cohort_size ?? 10} verified members — figures are withheld to protect individual privacy.`}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              icon={NAV_ICON.members}
              label="Verified members"
              value={String(dashboard.member_count ?? 0)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Care programmes</CardTitle>
              <CardDescription>27.13 — members, enrolment, control and overdue review, by programme.</CardDescription>
            </CardHeader>
            <CardContent>
              {!dashboard.programmes || dashboard.programmes.length === 0 ? (
                <p className="text-sm text-charcoal-ink/60">
                  No programme activity among this insurer&apos;s members yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-charcoal-ink/60">
                      <tr>
                        <th className="py-2 pr-4">Programme</th>
                        <th className="py-2 pr-4">Members</th>
                        <th className="py-2 pr-4">Enrolled</th>
                        <th className="py-2 pr-4">Controlled</th>
                        <th className="py-2 pr-4">Overdue review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.programmes.map((p) => (
                        <tr key={p.programme_name} className="border-t border-charcoal-ink/10">
                          <td className="py-2 pr-4 font-medium">{p.programme_name}</td>
                          <td className="py-2 pr-4">{p.members_with_condition ?? "Insufficient data"}</td>
                          <td className="py-2 pr-4">{p.enrolled ?? "Insufficient data"}</td>
                          <td className="py-2 pr-4">{p.controlled ?? "Insufficient data"}</td>
                          <td className="py-2 pr-4">{p.overdue_review ?? "Insufficient data"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
