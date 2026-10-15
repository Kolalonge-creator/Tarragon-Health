import { CommunityNav, LoadFailed } from "../community-nav";
import { formatWhen } from "@/components/community/staff-format";
import { loadDoctorCandidates, loadGroups, loadQaList, requireAdmin } from "../load";
import { sessionState } from "../session-state";
import { CancelQaForm, CreateQaForm } from "../session-forms";
import { card, h1, h2 } from "../ui";

export const metadata = { title: "Doctor question sessions" };
export const dynamic = "force-dynamic";

export default async function CommunitySessionsPage() {
  await requireAdmin();
  const [list, groups, doctors] = await Promise.all([loadQaList(), loadGroups(), loadDoctorCandidates()]);
  const liveGroups = groups.ok ? groups.data.groups.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name })) : [];
  return (
    <div className="space-y-8">
      <h1 className={h1}>Doctor question sessions</h1>
      <CommunityNav />
      <div className="max-w-3xl space-y-2 text-sm text-charcoal-ink/80">
        <p>
          A question session is a one-off, text-only session where named doctors answer members&apos; questions in one or more groups.
          Answers are general information, not advice for one person, and they show the doctor&apos;s real name.
        </p>
        <p>
          Members&apos; questions go through the same filters as any other post. Doctors never see who asked: they see a community name only. All times are Africa/Lagos time.
        </p>
      </div>

      <section aria-labelledby="list" className="space-y-3">
        <h2 id="list" className={h2}>Sessions</h2>
        {!list.ok ? (
          <LoadFailed what="The sessions" />
        ) : list.data.sessions.length === 0 ? (
          <p className="text-sm text-charcoal-ink">No sessions yet.</p>
        ) : (
          <ul className="space-y-3">
            {list.data.sessions.map((s) => {
              const state = sessionState(s.opens_at, s.closes_at, s.cancelled);
              return (
                <li key={s.series_id} className={`${card} space-y-2`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-charcoal-ink">{s.title}</h3>
                    <span className="rounded-full border border-charcoal-ink/25 px-2 py-0.5 text-xs">{state}</span>
                  </div>
                  <p className="text-sm text-charcoal-ink">
                    {formatWhen(s.opens_at)} to {formatWhen(s.closes_at)}. {s.questions} {s.questions === 1 ? "question" : "questions"}, {s.answers} {s.answers === 1 ? "answer" : "answers"}.
                  </p>
                  <p className="text-sm text-charcoal-ink/80">Groups: {s.groups.join(", ") || "none"}.</p>
                  <p className="text-sm text-charcoal-ink/80">Doctors: {s.doctors.join(", ") || "none"}.</p>
                  {(state === "Open now" || state === "Not open yet") && <CancelQaForm seriesId={s.series_id} title={s.title} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="create" className={card}>
        <h2 id="create" className={h2}>Create a session</h2>
        <div className="mt-3 max-w-2xl">
          {groups.ok ? <CreateQaForm doctors={doctors.ok ? doctors.data : null} groups={liveGroups} /> : <LoadFailed what="The groups" />}
        </div>
      </section>
    </div>
  );
}
