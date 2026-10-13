import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { isShownCell, parseAccuracy, type AccuracyCell } from "@/lib/triage-accuracy/report";
import { setReviewSwitchAction } from "./actions";

export const metadata = { title: "Triage agreement" };
export const dynamic = "force-dynamic";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const NOTES: Record<string, string> = { on: "Clinician grade reviews are now on.", off: "Clinician grade reviews are now off.", invalid: "Not changed. To switch on, tick the box and write who approved it and when (at least 10 characters).", refused: "Not changed. Only an admin can do this." };

function Group({ title, cells }: { title: string; cells: AccuracyCell[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        {cells.length === 0 ? <p>No reviews yet.</p> : (
          <ul className="space-y-1">
            {cells.map((c) => (
              <li key={c.key}>{c.key}: {isShownCell(c) ? `${c.reviewed} reviewed, ${c.agree_pct}% agreed, ${c.should_have_been_higher_pct}% should have been higher` : "withheld, group too small"}</li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * How often the clinician who handled a case agreed with the automatic grade (S38e, Module 22.4). Not diagnostic accuracy: nothing records a
 * final diagnosis. Coverage is shown first because only reviewed cases count. Grades from a draft rule set and test accounts are left out.
 */
export default async function TriageAccuracyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const note = typeof sp.m === "string" ? NOTES[sp.m] : undefined;
  const from = date.safeParse(typeof sp.from === "string" ? sp.from : undefined);
  const to = date.safeParse(typeof sp.to === "string" ? sp.to : undefined);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("triage_accuracy_report", { p_from: from.success ? from.data : undefined, p_to: to.success ? to.data : undefined });
  const r = error ? null : parseAccuracy(data);

  return (
    <div className="space-y-6">
      <PageHeader title="Triage agreement" backTo={{ href: "/admin", label: "Admin" }}
        description="How often the clinician who handled a case agreed with the grade the automatic check gave. It does not show diagnostic accuracy and it is not a measure of any clinician." />
      {note ? <p role="status">{note}</p> : null}
      {!r ? <p role="alert">The report could not be read. Please refresh.</p> : (
        <>
          <Card>
            <CardHeader><CardTitle>Clinician reviews are {r.capture_switched_on ? "on" : "off"}</CardTitle></CardHeader>
            <CardContent>
              <form action={setReviewSwitchAction} className="grid gap-2 sm:max-w-md">
                <input type="hidden" name="on" value={r.capture_switched_on ? "0" : "1"} />
                {!r.capture_switched_on ? (
                  <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="confirm" /> The Chief Medical Officer has approved this.</label>
                ) : null}
                <label className="space-y-1"><span className="block text-sm">{r.capture_switched_on ? "Note (optional)" : "Who approved this, and when (needed to switch on)"}</span><input name="note" maxLength={500} className="min-h-11 w-full rounded border px-2" /></label>
                <button type="submit" className="min-h-11 rounded border px-4">{r.capture_switched_on ? "Switch off" : "Switch on"}</button>
              </form>
            </CardContent>
          </Card>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="space-y-1"><span className="block text-sm">From</span><input type="date" name="from" defaultValue={r.range.from} className="min-h-11 rounded border px-2" /></label>
            <label className="space-y-1"><span className="block text-sm">To</span><input type="date" name="to" defaultValue={r.range.to} className="min-h-11 rounded border px-2" /></label>
            <button type="submit" className="min-h-11 rounded border px-4">Show</button>
          </form>
          <Card>
            <CardHeader><CardTitle>Coverage first</CardTitle></CardHeader>
            <CardContent>
              {r.coverage.suppressed ? <p>Too few completed tasks to show.</p> : (
                <p>{r.coverage.reviewed} of {r.coverage.completed_tasks_from_a_grade} completed tasks were reviewed ({r.coverage.reviewed_pct}%).{r.coverage.low_coverage ? " Fewer than half were reviewed, so read the figures below with care." : ""}</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Agreement overall</CardTitle></CardHeader>
            <CardContent className="space-y-1">
              {r.overall.suppressed ? <p>Fewer than {r.overall.minimum} reviews in a group, so nothing is shown.</p> : (
                <>
                  <p>{r.overall.reviewed} reviews: {r.overall.agree_pct}% agreed with the grade.</p>
                  <p>{r.overall.should_have_been_higher_pct}% said it should have been higher; {r.overall.should_have_been_lower_pct}% said it should have been lower.</p>
                </>
              )}
              {r.draft_rule_set_reviews !== null ? <p className="text-sm">{r.draft_rule_set_reviews} further reviews were of grades from a draft rule set and are not counted above.</p> : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>By grade the system gave</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-1">
                {r.by_grade.map((g) => (
                  <li key={g.graded_as}>{g.graded_as}: {g.suppressed ? "withheld, group too small" : `${g.reviewed} reviewed, ${g.agree_pct}% agreed, ${g.should_have_been_higher} said higher, ${g.should_have_been_lower} said lower`}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          <Group title="By sex" cells={r.by.sex} />
          <Group title="By age" cells={r.by.age_band} />
          <Group title="By state" cells={r.by.state} />
          <section aria-labelledby="ta-limits" className="space-y-2 text-sm">
            <h2 id="ta-limits" className="font-medium">What this is and is not</h2>
            <p>{r.what_this_is}</p>
            <p>{r.limitations}</p>
          </section>
        </>
      )}
    </div>
  );
}
