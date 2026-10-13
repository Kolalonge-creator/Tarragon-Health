import { CommunityNav, LoadFailed } from "../community-nav";
import { loadGroups, loadPinned, requireAdmin } from "../load";
import { UnpinForm } from "../unpin-form";
import { btnQuiet, card, field, h1, label } from "../ui";

export const metadata = { title: "Pinned notes" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function CommunityPinnedPage({ searchParams }: { searchParams: Promise<{ group?: string }> }) {
  await requireAdmin();
  const { group } = await searchParams;
  const groups = await loadGroups();
  const selected = groups.ok ? groups.data.groups.find((g) => g.id === group) ?? groups.data.groups[0] : undefined;
  const pinned = selected ? await loadPinned(selected.id) : null;
  return (
    <div className="space-y-6">
      <h1 className={h1}>Pinned notes</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/70">Clinicians write pinned notes and a second clinician reviews them, both in the clinician area. Here you can see them and unpin one.</p>
      {!groups.ok ? (
        <LoadFailed what="The groups" />
      ) : (
        <>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="pg-group" className={label}>Group</label>
              <select id="pg-group" name="group" defaultValue={selected?.id} className={field}>
                {groups.data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button type="submit" className={btnQuiet}>Show notes</button>
          </form>
          {pinned && !pinned.ok && <LoadFailed what="The notes" />}
          {pinned?.ok && (
            <ul className="space-y-3">
              {pinned.data.pinned.map((n) => (
                <li key={n.id} className={card}>
                  <h2 className="font-semibold text-charcoal-ink">{n.title}</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-charcoal-ink">{n.body}</p>
                  <p className="mt-2 text-xs text-charcoal-ink/70">
                    Written by {n.authored_by_name ?? "a clinician"}
                    {n.reviewed_by_name && n.reviewed_at ? `. Reviewed by ${n.reviewed_by_name} on ${when(n.reviewed_at)}` : ". Not reviewed yet, so members cannot see it"}.
                    {" "}Pinned {when(n.pinned_at)}.
                  </p>
                  <div className="mt-2">
                    {n.unpinned_at ? <p className="text-sm font-medium">Unpinned {when(n.unpinned_at)}</p> : selected && <UnpinForm id={n.id} groupId={selected.id} />}
                  </div>
                </li>
              ))}
              {pinned.data.pinned.length === 0 && <li>No notes for this group.</li>}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
