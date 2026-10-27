import Link from "next/link";
import { loadEscalationAccuracy, loadOverview } from "@/lib/ai-monitoring/load";
import { samplesByMonth, schedulerStatus } from "@/lib/ai-monitoring/model";

const box = "rounded-xl border border-charcoal-ink/10 bg-white p-4 dark:border-night-ink/15 dark:bg-night-card";
const alertBox = "rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900";

/** S80d (25.10): AI monitoring. Scheduler status, the monthly sample by rule, answers patients reported, and the escalation-accuracy tile. */
export async function MonitoringView({ links }: { links: { cost: string; review: string; signoff: string } }) {
  const [overview, accuracy] = await Promise.all([loadOverview(), loadEscalationAccuracy()]);
  const o = overview.ok ? overview.data : null;
  const a = accuracy.ok ? accuracy.data : null;
  const sched = o ? schedulerStatus(o.scheduler) : null;

  return (
    <div className="space-y-6">
      <p className="max-w-3xl text-sm text-charcoal-ink/70">
        How the assistants are being checked. This page shows counts, categories and dates only. It never shows what an assistant said or who it was said to.{" "}
        <Link href={links.cost} className="underline underline-offset-2">Cost by month</Link> · <Link href={links.review} className="underline underline-offset-2">Review the sampled answers</Link>
      </p>

      {!o ? (
        <p role="alert" className={alertBox}>{overview.ok ? "" : overview.denied ? "You do not have access to this page." : "The monitoring figures could not be loaded. This is not an all-clear: try again."}</p>
      ) : (
        <>
          <section aria-labelledby="sched" className={`${box} space-y-1`}>
            <h2 id="sched" className="font-heading text-lg font-semibold text-charcoal-ink">Monthly review sample</h2>
            <p className="text-sm text-charcoal-ink">{sched?.text}</p>
            {sched?.state === "waiting" && <Link href={links.signoff} className="text-sm font-medium underline underline-offset-2">Open the sign-off page</Link>}
            {o.scheduler.last_run && <p className="text-xs text-charcoal-ink/70">Last draw: {o.scheduler.last_run.month.slice(0, 7)}, {o.scheduler.last_run.drawn} answers drawn.</p>}
            <p className="text-xs text-charcoal-ink/70">Always drawn when the rules are on: conversations that touched an emergency or doctor-escalation grade, answers a patient said were wrong, and unusually large calls. A random share of the rest is added.</p>
          </section>

          <section aria-labelledby="samples" className={`${box} space-y-2`}>
            <h2 id="samples" className="font-heading text-lg font-semibold text-charcoal-ink">Drawn and reviewed, last months</h2>
            {o.samples.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">Nothing has been drawn yet.</p>
            ) : (
              samplesByMonth(o.samples).map((g) => (
                <div key={g.month}>
                  <p className="text-sm font-medium text-charcoal-ink">{g.month.slice(0, 7)}</p>
                  <ul className="text-sm text-charcoal-ink/80">
                    {g.lines.map((l) => <li key={l.rule}>{l.rule}: {l.drawn} drawn, {l.reviewed} reviewed</li>)}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section aria-labelledby="reported" className={`${box} space-y-2`}>
            <h2 id="reported" className="font-heading text-lg font-semibold text-charcoal-ink">Answers patients reported</h2>
            <p className="text-sm text-charcoal-ink/80">{o.reported_last_30_days} in the last 30 days. Every report is reviewed by a doctor; those drawn into the sample are marked.</p>
            {o.reported.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">No patient has reported an answer.</p>
            ) : (
              <ul className="space-y-1 text-sm text-charcoal-ink">
                {o.reported.map((r) => (
                  <li key={r.incident_id}>
                    {new Date(r.created_at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" })} · {r.system_code} · {r.category.replaceAll("_", " ")} · {r.severity} · {r.status}
                    {r.in_review_sample ? " · in the review sample" : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section aria-labelledby="acc" className={`${box} space-y-1`}>
        <h2 id="acc" className="font-heading text-lg font-semibold text-charcoal-ink">Escalation accuracy</h2>
        {!a ? (
          <p role="alert" className={alertBox}>{accuracy.ok ? "" : accuracy.denied ? "You do not have access to this figure." : "The escalation figure could not be loaded. This is not an all-clear: try again."}</p>
        ) : a.overall.suppressed ? (
          <p className="text-sm text-charcoal-ink/80">Not enough reviewed cases yet to show a figure without risking identifying anyone ({a.range.from} to {a.range.to}).{a.capture_switched_on === false ? " Doctor agreement capture is switched off." : ""}</p>
        ) : (
          <p className="text-sm text-charcoal-ink">
            Doctors agreed with the automatic grade on {a.overall.agree_pct}% of {a.overall.reviewed} reviewed cases; {a.overall.should_have_been_higher_pct}% should have been higher and {a.overall.should_have_been_lower_pct}% lower ({a.range.from} to {a.range.to}).
            {!a.coverage.suppressed && a.coverage.low_coverage ? ` Only ${a.coverage.reviewed_pct}% of cases were reviewed, so read this with care.` : ""}
          </p>
        )}
        {a && <p className="text-xs text-charcoal-ink/70">{a.what_this_is}</p>}
      </section>
    </div>
  );
}
