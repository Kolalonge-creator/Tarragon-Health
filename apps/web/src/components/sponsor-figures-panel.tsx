import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withheldText } from "@/lib/sponsors/report";
import { isHeldBack, parseStaffFigures, parseStaffProgrammes, type StaffMonth } from "@/lib/sponsors/staff-figures";

const monthName = (p: string) => new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${p}T00:00:00Z`));

function Month({ m }: { m: StaffMonth }) {
  const f = m.figures;
  return (
    <section aria-label={monthName(m.period)} className="space-y-1 rounded border p-3">
      <h3 className="font-medium">{monthName(m.period)}</h3>
      {isHeldBack(f) ? (
        <p>Held back: only a few people changed since the last figure, so it is not shown yet. It will appear once enough has changed.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          <li>{f.members.suppressed ? `Members who agreed: ${withheldText(f.members)}` : `Members who agreed to share: ${f.members.agreed_to_share} of ${f.members.joined} (${f.members.agreed_pct}%)`}</li>
          <li>{f.bp_control_90d.suppressed ? `Blood pressure under control at 90 days: ${withheldText(f.bp_control_90d)}` : `Blood pressure under control at 90 days: ${f.bp_control_90d.rate_strict_pct}% of ${f.bp_control_90d.n} people`}</li>
          <li>{f.change_among_measured.suppressed ? `Average change from day 0: ${withheldText(f.change_among_measured)}` : `Average change from day 0: ${f.change_among_measured.mean_systolic_change} / ${f.change_among_measured.mean_diastolic_change} mmHg (systolic / diastolic)`}</li>
          <li>{f.adherence_separate.suppressed ? `Medicines taken as planned (kept separate): ${withheldText(f.adherence_separate)}` : `Medicines taken as planned (kept separate): ${f.adherence_separate.mean_pct}%`}</li>
          <li>{f.engagement_separate.suppressed ? `Logged a reading in the last 30 days (kept separate): ${withheldText(f.engagement_separate)}` : `Logged a reading in the last 30 days (kept separate): ${f.engagement_separate.logged_a_reading_in_30_days_pct}%`}</li>
        </ul>
      )}
    </section>
  );
}

/**
 * A sponsor's own staff see their programmes and the frozen monthly group figures (S38f). Aggregate only: no member, no list, no name, and a
 * group too small to show is withheld. The figure for a month is written once, so there is nothing to refresh. Each view is audited.
 */
export async function SponsorFiguresPanel({ basePath }: { basePath: string }) {
  const supabase = await createClient();
  const progs = await supabase.rpc("sponsor_staff_programmes");
  const list = progs.error ? null : parseStaffProgrammes(progs.data);
  if (!list) return <p role="alert">Your programmes could not be read. Please refresh, or ask Tarragon to check that your login is set up for a programme.</p>;
  if (list.programmes.length === 0) return <p>When Tarragon sets up a programme for {list.sponsor}, it will appear here with its sign-up code.</p>;
  const cards = await Promise.all(list.programmes.map(async (p) => {
    const figs = await supabase.rpc("sponsor_staff_figures", { p_cohort: p.id });
    return { p, months: figs.error ? null : parseStaffFigures(figs.data) };
  }));
  return (
    <div className="space-y-6">
      <p className="text-sm">Figures about the members who agreed to share, as a group. No one is named or listed. A group smaller than the minimum is not shown, and neither is anything that would reveal it. A figure is written once a month, a few days after the month ends.</p>
      {cards.map(({ p, months }) => (
        <Card key={p.id}>
          <CardHeader><CardTitle>{p.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{p.status === "active" ? `Open until ${p.valid_to}.` : "Closed."}{p.code ? ` Sign-up code: ${p.code}` : ""}</p>
            {months === null ? <p role="alert">The figures could not be read. Please refresh.</p>
              : months.length === 0 ? <p>No figures yet. The first appears a few days after the month ends.</p>
              : months.map((m) => <Month key={m.period} m={m} />)}
            {months && months.length > 0 ? (
              <form method="post" action={`${basePath}/${p.id}/export`}>
                <button type="submit" className="min-h-11 rounded border px-4">Download as a file</button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
