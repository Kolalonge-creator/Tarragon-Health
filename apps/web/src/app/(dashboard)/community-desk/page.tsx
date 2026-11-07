import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCommunityStaffContext } from "@/components/community/staff-rpc";
import { DESK_PERIODS, PERIOD_LABEL, deskOverviewSchema, parsePeriod } from "@/lib/community/desk-overview";
import {
  ActivityFeed, ActivityTable, AttentionPanel, GroupsTable, KpiGrid, SectionCard, WorkloadPanel,
} from "@/components/community/desk/overview-parts";

export const metadata = { title: "Community desk" };
export const dynamic = "force-dynamic";

/** Community operations overview (COM-31, Phase A). The layout has already checked the desk is this person's to open. */
export default async function CommunityDeskOverviewPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const days = parsePeriod((await searchParams).days);
  const ctx = await getCommunityStaffContext();
  if (!ctx || !ctx.has_desk) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("community_desk_overview", { p_days: days });
  const parsed = error ? null : deskOverviewSchema.safeParse(data);
  if (!parsed || !parsed.success) {
    return (
      <p role="alert" className="rounded-xl border border-status-critical/40 bg-status-critical-tint p-4 text-sm text-status-critical-text">
        We could not load the overview just now, so nothing here can be trusted as current. Please reload in a moment. The moderation
        worklist and safety alerts keep working on their own.
      </p>
    );
  }
  const overview = parsed.data;
  const now = Date.parse(overview.generated_at);

  return (
    <div className="space-y-5">
      <AttentionPanel items={overview.attention} ctx={ctx} now={now} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink dark:text-night-ink">Key figures</h2>
        <nav aria-label="Period">
          <ul className="flex flex-wrap gap-1">
            {DESK_PERIODS.map((p) => (
              <li key={p}>
                <Link
                  href={p === 7 ? "/community-desk" : `/community-desk?days=${p}`}
                  aria-current={p === days ? "page" : undefined}
                  className={
                    "inline-block rounded-full px-3 py-1 text-sm " +
                    (p === days
                      ? "bg-clinical-navy text-white"
                      : "border border-charcoal-ink/15 text-charcoal-ink/75 hover:bg-warm-ivory dark:border-night-ink/20 dark:text-night-ink/75")
                  }
                >
                  {PERIOD_LABEL[p]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <KpiGrid data={overview} ctx={ctx} />

      <SectionCard
        id="desk-activity"
        title="Moderation activity"
        description="What members did, what the automatic checks did, and what moderators decided, by day (Lagos time)."
      >
        <ActivityTable series={overview.series} />
      </SectionCard>

      <SectionCard id="desk-groups" title="Community health" description={`Each group over ${PERIOD_LABEL[days].toLowerCase()}. Members, waiting and safety figures are as of now.`}>
        <GroupsTable groups={overview.groups} sees_safety={overview.sees_safety} />
      </SectionCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SectionCard id="desk-workload" title="Moderator workload" description="Who holds a Community role, who is on the rota now, and what is waiting.">
          <WorkloadPanel data={overview} now={now} />
        </SectionCard>
        <SectionCard id="desk-recent" title="Recent activity" description="The last 25 recorded moderation events. Member identity is never shown.">
          <ActivityFeed items={overview.activity} now={now} />
          {overview.last_drill && (
            <p className="mt-3 text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              Last safety drill:{" "}
              {new Date(overview.last_drill.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}
              {overview.last_drill.passed ? " (passed)" : " (did not pass)"}
            </p>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
