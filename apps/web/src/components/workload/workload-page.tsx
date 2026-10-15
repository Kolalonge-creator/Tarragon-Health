import Link from "next/link";
import { loadWorkload } from "@/lib/workload/load";
import { minutesLabel, WORKLOAD_WINDOWS } from "@/lib/workload/model";

const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card";

/**
 * The clinician workload dashboard (S78c, spec 23.21) for the Chief Medical Officer. Claims, completed, hand-backs, median and 90th
 * percentile time to complete, and what is overdue now, per clinician. Listed by name, never ordered by a measure, and worded as advisory:
 * a busy clinician and a slow one look the same here, so it informs a conversation and decides nothing. A failed read says so, never zeros.
 */
export async function WorkloadPage({ days }: { days: number }) {
  const result = await loadWorkload(days);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Clinician workload</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          How much work each clinician has taken on and how long it took. This is information for a conversation, not a ranking or a
          judgement of quality: workload depends on shifts, the kind of work and who was on call.
        </p>
      </div>
      <nav aria-label="Time window" className="flex gap-2 text-sm">
        {WORKLOAD_WINDOWS.map((d) => (
          <Link
            key={d}
            href={`/clinician/workload?days=${d}`}
            aria-current={d === days ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${d === days ? "border-tarragon-green bg-tarragon-green/10 font-medium" : "border-charcoal-ink/20"}`}
          >
            Last {d} days
          </Link>
        ))}
      </nav>
      {!result.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {result.denied ? "This page is for the Chief Medical Officer." : "The workload figures could not be loaded. Nothing is shown rather than a wrong number. Try again shortly."}
        </p>
      ) : result.data.clinicians.length === 0 ? (
        <p className={card}>No work was claimed in this window.</p>
      ) : (
        <div className={`${card} overflow-x-auto`}>
          <table className="w-full min-w-[640px] text-left">
            <caption className="sr-only">Work claimed, completed and handed back by each clinician in the last {days} days</caption>
            <thead>
              <tr className="text-xs text-charcoal-ink/60">
                <th scope="col" className="py-2 pr-4 font-medium">Clinician</th>
                <th scope="col" className="py-2 pr-4 font-medium">Claimed</th>
                <th scope="col" className="py-2 pr-4 font-medium">Completed</th>
                <th scope="col" className="py-2 pr-4 font-medium">Handed back</th>
                <th scope="col" className="py-2 pr-4 font-medium">Typical time to complete</th>
                <th scope="col" className="py-2 pr-4 font-medium">Slowest tenth</th>
                <th scope="col" className="py-2 font-medium">Past due now</th>
              </tr>
            </thead>
            <tbody>
              {result.data.clinicians.map((c) => (
                <tr key={c.clinician_id} className="border-t border-charcoal-ink/10">
                  <th scope="row" className="py-2 pr-4 font-medium">{c.name}</th>
                  <td className="py-2 pr-4">{c.claims}</td>
                  <td className="py-2 pr-4">{c.completed}</td>
                  <td className="py-2 pr-4">{c.handbacks}</td>
                  <td className="py-2 pr-4">{minutesLabel(c.median_minutes)}</td>
                  <td className="py-2 pr-4">{minutesLabel(c.p90_minutes)}</td>
                  <td className="py-2">{c.overdue}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-charcoal-ink/60">
            Time to complete runs from when the clinician claimed the task to when they completed it. Typical is the middle value; the slowest
            tenth is the value that nine in ten completed tasks beat. Opening this page is recorded in the audit log.
          </p>
        </div>
      )}
    </div>
  );
}
