import Link from "next/link";
import { CommunityNav, LoadFailed } from "./community-nav";
import { loadCommunitySwitch, loadOverview, loadRuleSets, requireAdmin } from "./load";
import { card, h1, h2, link, notice } from "./ui";

export const metadata = { title: "Community" };
export const dynamic = "force-dynamic";

export default async function CommunityOverviewPage() {
  await requireAdmin();
  const [overview, sw, sets] = await Promise.all([loadOverview(), loadCommunitySwitch(), loadRuleSets()]);
  const o = overview.ok ? overview.data : null;
  const live = sets.ok ? sets.data.rule_sets.find((s) => s.status === "active") : undefined;
  const tiles: Array<[string, number | string, string?]> = o
    ? [
        ["Groups live", o.groups_active], ["Groups in draft", o.groups_draft], ["Active members", o.members_active],
        ["Posts awaiting review", o.posts_awaiting_review, "/admin/community/groups"], ["Open reports", o.open_reports], ["Open safety signals", o.open_safety_signals],
        ["Moderators", o.moderators, "/admin/community/staff"], ["Safety reviewers", o.safety_reviewers, "/admin/community/staff"],
        ["Live filter rule set", o.active_rule_set === null ? "None" : `Version ${o.active_rule_set}`, "/admin/community/rules"],
      ]
    : [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className={h1}>Community</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">Members-only topic groups. Here you set up groups, topics, who moderates, and the filter rules. You never see who a member is, except through the one recorded lookup.</p>
      </div>
      <CommunityNav />

      <section aria-labelledby="switch" className={card}>
        <h2 id="switch" className={h2}>Is the community switched on?</h2>
        {sw.ok ? (
          <p className="mt-2 text-sm text-charcoal-ink">
            <strong>{sw.data.isOn ? "ON" : "OFF"}.</strong>{" "}
            {sw.data.isOn ? "Members can use community groups." : "Members cannot use community groups yet."} Only the Chief Medical Officer switches it, on the{" "}
            <Link href="/admin/go-live" className={link}>go-live page</Link>.
          </p>
        ) : (
          <LoadFailed what="The switch" />
        )}
        {sets.ok && !(live && live.safety_rule_count > 0) && (
          <p className={`${notice} mt-3 border-amber-300 bg-amber-50 text-amber-900`}>
            Until the Chief Medical Officer has signed a live version with emergency and self-harm rules, the community cannot be switched on.
          </p>
        )}
      </section>

      {overview.ok ? (
        <section aria-labelledby="numbers">
          <h2 id="numbers" className="sr-only">Numbers</h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {tiles.map(([name, value, href]) => (
              <li key={name} className={card}>
                <p className="text-sm text-charcoal-ink/70">{name}</p>
                <p className="mt-1 text-2xl font-semibold text-charcoal-ink">{value}</p>
                {href && <Link href={href} className={`${link} text-xs`}>Open</Link>}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <LoadFailed what="The overview" />
      )}
    </div>
  );
}
