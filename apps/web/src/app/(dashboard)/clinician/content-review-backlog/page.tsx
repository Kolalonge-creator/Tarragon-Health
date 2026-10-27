import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { loadContentReviewBacklog } from "@/lib/content-review-backlog/load";
import { BACKLOG_KINDS, groupBacklog, KIND_LABEL } from "@/lib/content-review-backlog/model";

export const metadata = { title: "Content review backlog" };
export const dynamic = "force-dynamic";

/**
 * S80 gap closure (25.1): the patient education items that need the Chief Medical Officer's review. Read only. It lists items whose text changed
 * after approval, items past their review date, and items that are live but were never clinician reviewed. Nothing on this page changes a status
 * or unpublishes anything; what to do about the never-reviewed items is the CMO's decision.
 */
export default async function ContentReviewBacklogPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const loaded = await loadContentReviewBacklog();
  if (!loaded.ok && loaded.denied) redirect("/clinician");
  const groups = loaded.ok ? groupBacklog(loaded.data) : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Content review backlog</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          Patient education items waiting for a clinical review. Reading this list changes nothing: no item is unpublished or approved from here.
          Safety related items cannot be approved by the person who wrote or last edited them, so a second reviewer is needed for those.
        </p>
      </div>
      {!groups && (
        <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-charcoal-ink">
          The backlog could not be loaded. This is a loading problem, not an empty list. Try again in a moment.
        </p>
      )}
      {groups &&
        BACKLOG_KINDS.map((kind) => (
          <section key={kind} aria-labelledby={`h-${kind}`} className="space-y-2">
            <h2 id={`h-${kind}`} className="font-heading text-lg font-semibold text-charcoal-ink">
              {KIND_LABEL[kind]} <span className="text-charcoal-ink/60">({groups[kind].length})</span>
            </h2>
            {groups[kind].length === 0 ? (
              <p className="text-sm text-charcoal-ink/60">Nothing in this group.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-charcoal-ink/15 text-xs uppercase tracking-wide text-charcoal-ink/60">
                      <th className="py-2 pr-3">Title</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Review date</th>
                      <th className="py-2 pr-3">Author</th>
                      <th className="py-2">Safety related</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groups[kind].map((r) => (
                      <tr key={r.content_id} className="border-b border-charcoal-ink/10 align-top">
                        <td className="py-2 pr-3 font-medium text-charcoal-ink">{r.title}</td>
                        <td className="py-2 pr-3 font-mono text-xs">{r.code}</td>
                        <td className="py-2 pr-3">{r.content_status.replace(/_/g, " ")}</td>
                        <td className="py-2 pr-3">
                          {r.next_review_due ?? "none set"}
                          {r.days_overdue !== null && <span className="text-charcoal-ink/60"> ({r.days_overdue} days past)</span>}
                        </td>
                        <td className="py-2 pr-3">{r.author_name ?? "not recorded"}</td>
                        <td className="py-2">{r.safety_relevant ? "Yes" : "No"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
