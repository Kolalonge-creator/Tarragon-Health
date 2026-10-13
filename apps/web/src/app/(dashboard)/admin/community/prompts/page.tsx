import { CommunityNav, LoadFailed } from "../community-nav";
import { hasPassed, loadGroups, loadPrompts, requireAdmin } from "../load";
import { AddPromptForm, EndPromptForm } from "../prompt-forms";
import { card, h1, h2 } from "../ui";

export const metadata = { title: "Community prompts" };
export const dynamic = "force-dynamic";

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function CommunityPromptsPage() {
  await requireAdmin();
  const groups = await loadGroups();
  const open = groups.ok ? groups.data.groups.filter((g) => g.status !== "archived") : [];
  const lists = await Promise.all(open.map((g) => loadPrompts(g.id)));
  return (
    <div className="space-y-8">
      <h1 className={h1}>Group prompts</h1>
      <CommunityNav />
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        A prompt is a short line shown at the top of a group, such as a welcome or a weekly question. It goes through the same filters as a
        member post, so it cannot contain phone numbers, emails or links. Times are Lagos time. Prompts that ended more than 30 days ago are not listed.
      </p>
      {!groups.ok ? (
        <LoadFailed what="The groups" />
      ) : open.length === 0 ? (
        <p className="text-sm">There are no groups yet.</p>
      ) : (
        open.map((g, i) => {
          const list = lists[i];
          return (
            <section key={g.id} aria-labelledby={`pg-${g.id}`} className={`${card} space-y-4`}>
              <h2 id={`pg-${g.id}`} className={h2}>{g.name}</h2>
              {!list.ok ? (
                <LoadFailed what="The prompts" />
              ) : list.data.prompts.length === 0 ? (
                <p className="text-sm text-charcoal-ink/70">This group has no prompts.</p>
              ) : (
                <ul className="space-y-3">
                  {list.data.prompts.map((pr) => {
                    const ended = pr.show_until !== null && hasPassed(pr.show_until);
                    const state = pr.showing ? "Showing now" : ended ? "Ended" : "Scheduled";
                    return (
                      <li key={pr.id} className="rounded-lg border border-charcoal-ink/10 p-3">
                        <p className="whitespace-pre-wrap break-words text-sm text-charcoal-ink">{pr.body}</p>
                        <p className="mt-1 text-xs text-charcoal-ink/70">
                          <strong>{state}.</strong> From {when(pr.show_from)}
                          {pr.show_until ? ` until ${when(pr.show_until)}` : ", with no end time"}.
                        </p>
                        {!ended && <div className="mt-2"><EndPromptForm id={pr.id} /></div>}
                      </li>
                    );
                  })}
                </ul>
              )}
              <AddPromptForm groupId={g.id} groupName={g.name} />
            </section>
          );
        })
      )}
    </div>
  );
}
