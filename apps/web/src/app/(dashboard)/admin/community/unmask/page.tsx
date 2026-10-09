import { CommunityNav, LoadFailed } from "../community-nav";
import { loadGroups, requireAdmin } from "../load";
import { UnmaskForm } from "../unmask-form";
import { h1 } from "../ui";

export const metadata = { title: "Look up a member" };
export const dynamic = "force-dynamic";

export default async function CommunityUnmaskPage() {
  await requireAdmin();
  const groups = await loadGroups();
  return (
    <div className="space-y-6">
      <h1 className={h1}>Look up a member</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/70">This is the only place in the community screens where a member&apos;s name can be found from their community name. There is a daily limit.</p>
      {groups.ok ? <div className="max-w-2xl"><UnmaskForm groups={groups.data.groups.map((g) => ({ id: g.id, name: g.name }))} /></div> : <LoadFailed what="The groups" />}
    </div>
  );
}
