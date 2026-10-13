import { loadWall } from "@/lib/ops-wall/load";
import { evaluatorStale, failurePercent, waitLabel, type Wall } from "@/lib/ops-wall/model";

const card = "rounded-xl border border-charcoal-ink/10 bg-white p-4 text-sm dark:border-night-ink/15 dark:bg-night-card";
const h2 = "font-heading text-xl font-semibold text-charcoal-ink";
const lagos = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const sevClass = (s: string) => (s === "sev1" ? "text-red-800" : s === "sev2" ? "text-amber-800" : "text-charcoal-ink/70");
const naira = (minor: number) => `₦${(minor / 100).toLocaleString("en-NG")}`;

/**
 * SR5: the operations wall. Reads one database answer (`operations_wall()`), which carries counts and ages only. A failed read is a load
 * failure on screen, never zeros, and a stale or never-run alert evaluator is shown first, because a wall whose alerting has stopped
 * looks calm for exactly the wrong reason. The page refreshes itself every 30 seconds without script.
 */
export async function OperationsWall() {
  const result = await loadWall();
  return (
    <div className="space-y-8">
      <meta httpEquiv="refresh" content="30" />
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink sm:text-3xl">Operations wall</h1>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          What the platform is doing right now: queue age, pages, doctors, calls, tests, notifications and payments. Counts only, no patient is shown here.
        </p>
      </div>
      {!result.ok ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          {result.denied ? "You do not have access to the operations wall." : "The wall could not be loaded, so nothing here is reporting healthy. Reload to try again, and check the incident register if this persists."}
        </p>
      ) : (
        <Body d={result.data} />
      )}
    </div>
  );
}

function Body({ d }: { d: Wall }) {
  const stale = evaluatorStale(d.alerts.last_evaluated_at, new Date(d.generated_at));
  return (
    <>
      <p className="text-xs text-charcoal-ink/60">Updated {lagos(d.generated_at)} (Lagos time). Refreshes every 30 seconds.</p>

      {stale ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">
          The alert checks have not run in the last 3 minutes{d.alerts.last_evaluated_at ? "" : " (they have never run)"}. Alerts are not being raised. Treat every number below as unmonitored.
        </p>
      ) : null}
      {d.alerts.contacts === 0 ? (
        <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">No on-call contact is configured. Alerts go to the active admins until a list is set.</p>
      ) : null}
      {!d.on_call_covered ? (
        <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm font-medium text-red-900">Nobody is on call right now.</p>
      ) : null}

      <section aria-labelledby="wall-alerts" className="space-y-3">
        <h2 id="wall-alerts" className={h2}>Open alerts</h2>
        {d.alerts.open.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No alert is open. {d.alerts.rules_on} rules are on{d.alerts.rules_failing > 0 ? `, ${d.alerts.rules_failing} could not be evaluated` : ""}.</p>
        ) : (
          <ul className="space-y-2">
            {d.alerts.open.map((a, i) => (
              <li key={`${a.rule}-${i}`} className={card}>
                <p className={`font-medium ${sevClass(a.severity)}`}>{a.severity.toUpperCase()} · {a.title}</p>
                <p className="text-charcoal-ink/70">Open for {waitLabel(a.minutes_open)}. {Object.entries(a.detail).map(([k, v]) => `${k.replaceAll("_", " ")}: ${String(v)}`).join(" · ")}</p>
              </li>
            ))}
          </ul>
        )}
        {d.alerts.rules_off.length > 0 ? (
          <details className="text-sm text-charcoal-ink/70">
            <summary>{d.alerts.rules_off.length} rules are off (no feed yet). They are not reporting healthy.</summary>
            <ul className="mt-2 list-disc pl-5">{d.alerts.rules_off.map((r) => <li key={r.rule}>{r.rule}: {r.reason ?? "no reason recorded"}</li>)}</ul>
          </details>
        ) : null}
        <p className="text-sm text-charcoal-ink/70">Open incidents: {d.incidents_open.sev1} sev1, {d.incidents_open.sev2} sev2.</p>
      </section>

      <section aria-labelledby="wall-queue" className="space-y-3">
        <h2 id="wall-queue" className={h2}>Queue age by class</h2>
        {d.queue.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No task is waiting. {d.tasks_claimed} claimed and in progress.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {d.queue.map((q) => (
              <li key={q.priority_class} className={card}>
                <p className="font-medium text-charcoal-ink">Class {q.priority_class}: {q.waiting} waiting</p>
                <p className="text-charcoal-ink/70">Oldest {waitLabel(q.oldest_minutes)}</p>
                <p className={q.past_due > 0 ? "font-medium text-red-800" : "text-charcoal-ink/70"}>{q.past_due > 0 ? `${q.past_due} past due` : "None past due"}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="wall-now" className="space-y-3">
        <h2 id="wall-now" className={h2}>Right now</h2>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <li className={card}>
            <p className="font-medium text-charcoal-ink">Open pages</p>
            <p className={d.pages.unacknowledged > 0 ? "font-medium text-red-800" : "text-charcoal-ink/70"}>{d.pages.open} open, {d.pages.unacknowledged} unacknowledged</p>
            <p className="text-charcoal-ink/70">{d.pages.unacknowledged > 0 ? `Longest wait ${Math.floor(d.pages.oldest_unacknowledged_seconds / 60)} min ${d.pages.oldest_unacknowledged_seconds % 60} s. ` : ""}{d.pages.sent_24h} sent in 24 hours</p>
          </li>
          <li className={card}>
            <p className="font-medium text-charcoal-ink">Doctors online</p>
            <p className="text-charcoal-ink/70">{d.doctors_online} taking queue work</p>
          </li>
          <li className={card}>
            <p className="font-medium text-charcoal-ink">Calls in progress</p>
            <p className="text-charcoal-ink/70">{d.calls_in_progress} in progress, {d.calls_waiting} waiting</p>
          </li>
          <li className={card}>
            <p className="font-medium text-charcoal-ink">Tests this week</p>
            <p className="text-charcoal-ink/70">{d.tests_this_week.orders} ordered, {d.tests_this_week.results_received} results in, {d.tests_this_week.results_held} held for review</p>
          </li>
        </ul>
      </section>

      <section aria-labelledby="wall-delivery" className="space-y-3">
        <h2 id="wall-delivery" className={h2}>Notification delivery, last hour</h2>
        {d.notifications.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No notification was queued in the last hour.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-3">
            {d.notifications.map((c) => {
              const pct = failurePercent(c);
              return (
                <li key={c.channel} className={card}>
                  <p className="font-medium text-charcoal-ink">{c.channel.replaceAll("_", " ")}</p>
                  <p className="text-charcoal-ink/70">{c.sent} sent, {c.failed} failed, {c.pending} pending</p>
                  <p className={pct !== null && pct > 2 ? "font-medium text-red-800" : "text-charcoal-ink/70"}>{pct === null ? "Nothing attempted" : `${pct}% failed`}</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="wall-payments" className="space-y-3">
        <h2 id="wall-payments" className={h2}>Payments, last hour</h2>
        <div className={card}>
          <p className="text-charcoal-ink/70">{d.payments.events} events: {d.payments.processed} processed, {d.payments.unprocessed} waiting, {d.payments.errored} with an error. Taken: {naira(d.payments.taken_minor)}.</p>
        </div>
      </section>
    </>
  );
}
