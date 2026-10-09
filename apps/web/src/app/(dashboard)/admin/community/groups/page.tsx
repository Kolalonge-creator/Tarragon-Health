import { CommunityNav, LoadFailed } from "../community-nav";
import { CreateGroupForm, EditGroupForm, GroupStatusButtons } from "../group-forms";
import { loadGroups, loadTopics, requireAdmin } from "../load";
import { card, h1, h2, warn } from "../ui";

export const metadata = { title: "Community groups" };
export const dynamic = "force-dynamic";

const STATUS = { draft: "Draft", active: "Live", read_only: "Read only", archived: "Archived" } as const;

export default async function CommunityGroupsPage() {
  await requireAdmin();
  const [groups, topics] = await Promise.all([loadGroups(), loadTopics()]);
  const topicOptions = topics.ok ? topics.data.topics.filter((t) => t.is_active).map((t) => ({ code: t.code, label: t.label })) : [];
  const allTopicOptions = topics.ok ? topics.data.topics.map((t) => ({ code: t.code, label: t.label })) : [];
  return (
    <div className="space-y-8">
      <h1 className={h1}>Community groups</h1>
      <CommunityNav />
      {!groups.ok ? (
        <LoadFailed what="The groups" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Community groups and their queues</caption>
              <thead>
                <tr className="border-b border-charcoal-ink/20">
                  {["Group", "Topic", "Status", "Members", "Held posts", "Open reports", "Open signals", "Rules"].map((c) => <th key={c} scope="col" className="py-2 pr-3 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {groups.data.groups.map((g) => (
                  <tr key={g.id} className="border-b border-charcoal-ink/10 align-top">
                    <th scope="row" className="py-2 pr-3 font-medium">{g.name}</th>
                    <td className="py-2 pr-3">{g.topic_label}</td>
                    <td className="py-2 pr-3">{STATUS[g.status]}</td>
                    <td className="py-2 pr-3">{g.member_count}</td>
                    <td className="py-2 pr-3">{g.held_posts}</td>
                    <td className="py-2 pr-3">{g.open_reports}</td>
                    <td className="py-2 pr-3">{g.open_signals}</td>
                    <td className="py-2 pr-3">
                      <span>Version {g.rules_version}. </span>
                      {g.rules_approved ? <strong>Rules approved by the CMO</strong> : g.requires_cmo_rules ? <span>Not approved yet</span> : <span>No approval needed</span>}
                      {g.requires_cmo_rules && !g.rules_approved && (
                        <p className="mt-1 text-xs font-medium text-amber-900">Needs Chief Medical Officer approval before it can go live.</p>
                      )}
                    </td>
                  </tr>
                ))}
                {groups.data.groups.length === 0 && <tr><td colSpan={8} className="py-3">No groups yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="manage" className="space-y-4">
            <h2 id="manage" className={h2}>Edit a group</h2>
            {groups.data.groups.map((g) => (
              <details key={g.id} className={card}>
                <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">{g.name} ({STATUS[g.status]})</summary>
                <div className="mt-4 space-y-4">
                  {g.requires_cmo_rules && !g.rules_approved && g.status === "draft" && (
                    <p className={warn}>This group needs Chief Medical Officer approval of its rules before it can go live.</p>
                  )}
                  {g.status !== "archived" && <EditGroupForm group={g} topics={allTopicOptions} />}
                  <GroupStatusButtons id={g.id} slug={g.slug} status={g.status} name={g.name} />
                </div>
              </details>
            ))}
          </section>

          <section aria-labelledby="create" className={card}>
            <h2 id="create" className={h2}>Create a group</h2>
            {topics.ok ? <div className="mt-3 max-w-2xl"><CreateGroupForm topics={topicOptions} /></div> : <LoadFailed what="The topics" />}
          </section>
        </>
      )}
    </div>
  );
}
