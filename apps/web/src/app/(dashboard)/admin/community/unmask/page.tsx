import { CommunityNav, LoadFailed } from "../community-nav";
import { loadGroups, loadUnmaskCandidates, requireAdmin } from "../load";
import { UnmaskForm } from "../unmask-form";
import { h1 } from "../ui";

export const metadata = { title: "Look up a member" };
export const dynamic = "force-dynamic";

export default async function CommunityUnmaskPage() {
  await requireAdmin();
  const [groups, candidates] = await Promise.all([loadGroups(), loadUnmaskCandidates()]);
  return (
    <div className="space-y-6">
      <h1 className={h1}>Look up a member</h1>
      <CommunityNav />
      <div className="max-w-3xl space-y-2 text-sm text-charcoal-ink/70">
        <p>
          A member&apos;s name can be looked up only while that member has a recent safety concern in that group: a post held back for emergency or self-harm wording, or a report that someone may be in danger.
        </p>
        <p>
          Admins, the Chief Medical Officer and doctors can do this. Moderators and safety reviewers cannot; they hand the concern to one of those people. Every lookup is written down with your reason, and the Chief Medical Officer and the data protection officer are told. There is a daily limit.
        </p>
      </div>
      {groups.ok ? (
        <div className="max-w-2xl">
          <UnmaskForm groups={groups.data.groups.map((g) => ({ id: g.id, name: g.name }))} candidates={candidates.ok ? candidates.data.items : null} />
        </div>
      ) : (
        <LoadFailed what="The groups" />
      )}
    </div>
  );
}
