import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Muted, Section } from "@/components/credentialing/shared";
import { getFireDrillReport } from "@/lib/capacity/queries";
import type { DrillGroupRow } from "@/lib/capacity/schemas";

function seconds(n: number | null): string {
  if (n === null) return "none";
  if (n < 90) return `${Math.round(n)} s`;
  return `${(n / 60).toFixed(1)} min`;
}

function GroupTable({ title, rows, target }: { title: string; rows: DrillGroupRow[]; target: number }) {
  if (rows.length === 0) return null;
  return (
    <Section title={title}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-charcoal-ink/15">
              <th scope="col" className="py-1 pr-3 font-medium">
                {title.replace(/^By /, "")}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">Drills</th>
              <th scope="col" className="py-1 pr-3 font-medium">Answered</th>
              <th scope="col" className="py-1 pr-3 font-medium">Within {Math.round(target / 60)} min</th>
              <th scope="col" className="py-1 pr-3 font-medium">Median</th>
              <th scope="col" className="py-1 font-medium">95th percentile</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-charcoal-ink/10">
                <td className="py-1 pr-3">{r.label}</td>
                <td className="py-1 pr-3">{r.sent}</td>
                <td className="py-1 pr-3">{r.acknowledged}</td>
                <td className="py-1 pr-3">{r.pct_within_target === null ? "none" : `${r.pct_within_target}%`}</td>
                <td className="py-1 pr-3">{seconds(r.p50_seconds)}</td>
                <td className="py-1">{seconds(r.p95_seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * Fire drills (S16-S20 W5.4): how quickly each on-call clinician acknowledged an unannounced test page, by clinician, hour of day, route and
 * device, against the target. A drill measures the route and the habit, not the person: it is informational and never used for pay or removal.
 */
export async function FireDrillsPage() {
  const r = await getFireDrillReport(90);
  const overall = r.groups.find((g) => g.group === "overall");
  const rows = (group: DrillGroupRow["group"]) => r.groups.filter((g) => g.group === group);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Fire drills"
        description="An unannounced test page goes to each on-call clinician about once a month. This shows how long they took to acknowledge it. It checks that the route works; it is not used for pay or for removing anyone."
      />
      <Section title="Last 90 days" hint={`Target: ${r.target_pct}% acknowledged within ${Math.round(r.target_seconds / 60)} minutes. A drill nobody answered counts against the share and has no time.`}>
        {overall ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant={r.meets_target ? "green" : "amber"}>{r.meets_target ? "Target met" : "Target not met"}</Badge>
            <span>
              {overall.sent} drills, {overall.acknowledged} answered, {overall.pct_within_target ?? 0}% within the target. Median {seconds(overall.p50_seconds)}, 95th percentile {seconds(overall.p95_seconds)}.
            </span>
          </div>
        ) : (
          <Muted>No drill has finished yet. Drills start once the clinical lead signs capacity configuration version 2 in the sign-off hub.</Muted>
        )}
        {r.pending > 0 ? <Muted>{r.pending} drill(s) are still waiting for an answer and are not counted yet.</Muted> : null}
      </Section>
      <GroupTable title="By clinician" rows={rows("clinician")} target={r.target_seconds} />
      <GroupTable title="By hour of day (Lagos)" rows={rows("hour")} target={r.target_seconds} />
      <GroupTable title="By route" rows={rows("route")} target={r.target_seconds} />
      <GroupTable title="By device" rows={rows("device")} target={r.target_seconds} />
    </div>
  );
}
