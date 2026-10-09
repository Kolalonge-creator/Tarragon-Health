import { CommunityNav, LoadFailed } from "../community-nav";
import { loadCoverage, loadShifts, requireAdmin } from "../load";
import { CoverageGrid } from "../rota-grid";
import { ShiftsForm } from "../rota-forms";
import { WEEKDAYS } from "../ops-schemas";
import { card, h1, h2, help, warn } from "../ui";

export const metadata = { title: "Moderator rota" };
export const dynamic = "force-dynamic";

const SCOPE = { moderator: "Moderator", safety_reviewer: "Safety reviewer" } as const;
const hourText = (h: number) => (h === 24 ? "24:00" : `${String(h).padStart(2, "0")}:00`);

export default async function CommunityRotaPage() {
  await requireAdmin();
  const [coverage, shifts] = await Promise.all([loadCoverage(), loadShifts()]);
  return (
    <div className="space-y-8">
      <h1 className={h1}>Moderator rota</h1>
      <CommunityNav />
      <div className="max-w-3xl space-y-2 text-sm text-charcoal-ink/80">
        <p>
          Moderators and safety reviewers must cover every hour of the week, because members can post at any time. All times here are Africa/Lagos time.
        </p>
        <p>
          Only people with an <strong>all-groups</strong> permission count towards coverage. A permission for one group does not. The community
          can only go live when every hour of the week is covered for both moderators and safety reviewers.
        </p>
      </div>

      <section aria-labelledby="cov" className="space-y-4">
        <h2 id="cov" className={h2}>Coverage this week</h2>
        {!coverage.ok ? (
          <LoadFailed what="The coverage" />
        ) : (
          <>
            <ul className="grid gap-3 sm:grid-cols-2">
              <li className={card}>
                <p className="text-sm text-charcoal-ink/70">Hours with no moderator</p>
                <p className="mt-1 text-2xl font-semibold text-charcoal-ink">{coverage.data.moderator_uncovered_hours} of 168</p>
              </li>
              <li className={card}>
                <p className="text-sm text-charcoal-ink/70">Hours with no safety reviewer</p>
                <p className="mt-1 text-2xl font-semibold text-charcoal-ink">{coverage.data.safety_uncovered_hours} of 168</p>
              </li>
            </ul>
            {coverage.data.moderator_uncovered_hours + coverage.data.safety_uncovered_hours > 0 ? (
              <p className={warn}>Some hours have nobody on duty. Add shifts below until both grids show no gaps.</p>
            ) : (
              <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">Every hour of the week is covered for both moderators and safety reviewers.</p>
            )}
            <CoverageGrid title="Moderators" scope="moderator" gaps={coverage.data.gaps} />
            <CoverageGrid title="Safety reviewers" scope="safety_reviewer" gaps={coverage.data.gaps} />
            <p className={help}>In the grids, &quot;ok&quot; means someone is on duty that hour and &quot;gap&quot; (striped, with a heavy border) means nobody is.</p>
          </>
        )}
      </section>

      <section aria-labelledby="shifts" className="space-y-4">
        <h2 id="shifts" className={h2}>Shifts</h2>
        {!shifts.ok ? (
          <LoadFailed what="The shifts" />
        ) : shifts.data.staff.length === 0 ? (
          <p className="text-sm text-charcoal-ink">
            No one has a community permission yet. Give a permission on the moderators and reviewers page first, then set their shifts here.
          </p>
        ) : (
          shifts.data.staff.map((s) => {
            const who = s.name ?? "Unnamed";
            return (
              <details key={s.staff_id} className={card}>
                <summary className="cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
                  {who}, {SCOPE[s.scope]}, {s.all_groups ? "all groups" : "one group only"} ({s.shifts.length} {s.shifts.length === 1 ? "shift" : "shifts"})
                </summary>
                <div className="mt-4 space-y-3">
                  {!s.all_groups && (
                    <p className={warn}>This permission covers one group only, so it does not count towards the 24/7 rota.</p>
                  )}
                  {s.shifts.length > 0 && (
                    <p className="text-sm text-charcoal-ink/80">
                      Now: {s.shifts.map((x) => `${WEEKDAYS[x.weekday] ?? "?"} ${hourText(x.start_hour)} to ${hourText(x.end_hour)}`).join("; ")}.
                    </p>
                  )}
                  <ShiftsForm staffId={s.staff_id} who={who} initial={s.shifts} />
                </div>
              </details>
            );
          })
        )}
      </section>
    </div>
  );
}
