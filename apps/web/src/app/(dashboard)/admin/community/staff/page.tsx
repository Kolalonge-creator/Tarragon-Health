import { CommunityNav, LoadFailed } from "../community-nav";
import { loadGroups, loadStaff, loadStaffCandidates, requireAdmin } from "../load";
import { GrantStaffForm, RevokeStaffForm } from "../staff-forms";
import { card, h1, h2 } from "../ui";

export const metadata = { title: "Community moderators" };
export const dynamic = "force-dynamic";

const SCOPE = { moderator: "Moderator", safety_reviewer: "Safety reviewer" } as const;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });

export default async function CommunityStaffPage() {
  await requireAdmin();
  const [staff, groups, candidates] = await Promise.all([loadStaff(), loadGroups(), loadStaffCandidates()]);
  const groupList = groups.ok ? groups.data.groups.map((g) => ({ id: g.id, name: g.name })) : [];
  return (
    <div className="space-y-8">
      <h1 className={h1}>Moderators and safety reviewers</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        A moderator sees post text and community names, but never who a member is. A safety reviewer sees posts flagged for emergency or self-harm language. These permissions are given to care coordinator accounts only. The database refuses to give them to an admin account.
      </p>
      {!staff.ok ? (
        <LoadFailed what="The permissions" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <caption className="sr-only">Community permissions given to staff</caption>
            <thead>
              <tr className="border-b border-charcoal-ink/20">
                {["Staff member", "Account", "Permission", "Covers", "Given", "State"].map((c) => <th key={c} scope="col" className="py-2 pr-3 font-semibold">{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {staff.data.staff.map((s) => (
                <tr key={s.id} className="border-b border-charcoal-ink/10 align-top">
                  <th scope="row" className="py-2 pr-3 font-medium">{s.staff_name ?? "Unnamed"}</th>
                  <td className="py-2 pr-3">{s.profile_role === "care_coordinator" ? "Care coordinator" : s.profile_role}</td>
                  <td className="py-2 pr-3">{SCOPE[s.scope]}</td>
                  <td className="py-2 pr-3">{s.group_name ?? "All groups"}</td>
                  <td className="py-2 pr-3">{when(s.granted_at)}</td>
                  <td className="py-2 pr-3">{s.revoked_at ? `Ended ${when(s.revoked_at)}` : <RevokeStaffForm id={s.id} who={s.staff_name ?? "this person"} />}</td>
                </tr>
              ))}
              {staff.data.staff.length === 0 && <tr><td colSpan={6} className="py-3">No one has been given a community permission yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <section aria-labelledby="grant" className={card}>
        <h2 id="grant" className={h2}>Give a permission</h2>
        <div className="mt-3 max-w-2xl"><GrantStaffForm candidates={candidates.ok ? candidates.data : null} groups={groupList} /></div>
      </section>
    </div>
  );
}
