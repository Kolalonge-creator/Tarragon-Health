import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { runCanaryNowAction } from "@/lib/chain-health/actions";
import {
  describeTiming, groupParity, PARITY_TEXT, STATUS_LABEL, stageText, formatSeconds,
  type ChainHealth, type Reliability,
} from "@/lib/chain-health/model";

const lagos = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
const TONE = { ok: "green", attention: "amber", down: "red" } as const;
const cell = "px-3 py-2 align-top text-left text-sm text-charcoal-ink";
const head = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60";

/**
 * P1: the clinical chain health page body, shared by /admin/ops/chain-health and /clinician/chain-health (a CMO login cannot open /admin).
 * English only (staff page). It shows counts, seconds and stage names, never a patient.
 */
export function ChainHealthPanel({
  health,
  reliability,
  from,
  result,
}: {
  health: ChainHealth | null;
  reliability: Reliability | null;
  from: "admin" | "clinician";
  result: "started" | "wait" | "failed" | null;
}) {
  if (!health) {
    return <LoadFailure>The chain health could not be read. That does not mean the chain is fine. Try again, and tell the platform team if it keeps failing.</LoadFailure>;
  }
  const groups = groupParity(health.parity_30d);
  const parityTotal = groups.reduce((a, g) => a + g.readings, 0);
  return (
    <div className="space-y-6">
      {result && (
        <p role="status" className={`rounded-lg border px-4 py-3 text-sm ${result === "started" ? "border-brand-green/40 bg-brand-green/5" : "border-red-300 bg-red-50"}`}>
          {result === "started" ? "A check run was started. The next scheduled check (minutes 11 and 41 of the hour) will judge it." : result === "wait" ? "A check was started in the last 15 minutes. Wait for it." : "The check could not be started."}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            Status <Badge variant={TONE[health.status]} className="ml-2">{STATUS_LABEL[health.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {health.reasons.length === 0 ? (
            <p>Every check passed: the last test run went through, nothing on the chain is stuck, and the timings are inside their limits.</p>
          ) : (
            <ul className="list-disc pl-5">
              {health.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          <p className="text-charcoal-ink/60">Read {lagos(health.generated_at)} (Lagos time). Limits are proposed values the Chief Medical Officer confirms.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>The test run</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            Every 30 minutes the platform sends two made-up readings (a red one and an amber one) through the real path, for a synthetic patient that belongs to no real
            organisation, and checks that each one is graded, handed on, paged or tasked, noticed in neutral words and acknowledged. Nobody real is paged and nothing is sent.
          </p>
          <p>
            Last finished run: {lagos(health.canary.last_result_at)}{" "}
            {health.canary.last_passed === null ? null : health.canary.last_passed ? <Badge variant="green">passed</Badge> : <Badge variant="red">failed at {health.canary.last_failed_stage}</Badge>}
            {health.canary.last_passed === false && health.canary.last_failed_stage ? <> : {stageText(health.canary.last_failed_stage)}.</> : null}
          </p>
          <p>Last pass: {lagos(health.canary.last_pass_at)}. In the last 24 hours: {health.canary.runs_24h} runs, {health.canary.failures_24h} failed.</p>
          {health.canary.recent.length > 0 && (
            <p className="flex flex-wrap gap-1" aria-label="Recent runs, newest first">
              {health.canary.recent.map((r) => (
                <Badge key={r.at} variant={r.passed ? "green" : "red"} title={lagos(r.at)}>{r.passed ? "ok" : r.stage}</Badge>
              ))}
            </p>
          )}
          <p>Typical test times (last 7 days): reading to graded {describeTiming(health.canary_timings_7d.reading_to_graded)}; page to acknowledged {describeTiming(health.canary_timings_7d.page_to_ack)}.</p>
          <form action={runCanaryNowAction}>
            <input type="hidden" name="from" value={from} />
            <button type="submit" className="rounded-lg border border-charcoal-ink/30 px-3 py-2 text-sm hover:bg-charcoal-ink/5">Run the check now</button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events waiting on the chain</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>{["Step", "Waiting", "Running", "Failed for good", "Oldest wait"].map((c) => <th key={c} className={head}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {health.bus.subscribers.map((s) => (
                <tr key={s.subscriber} className="border-t border-charcoal-ink/10">
                  <td className={cell}>{s.subscriber}</td>
                  <td className={cell}>{s.pending}</td>
                  <td className={cell}>{s.processing}</td>
                  <td className={cell}>{s.dead > 0 ? <Badge variant="red">{s.dead}</Badge> : 0}</td>
                  <td className={cell}>{s.oldest_pending_seconds > 0 ? formatSeconds(s.oldest_pending_seconds) : "none"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-charcoal-ink/60">Real patients only. {health.bus.stuck} waiting longer than {health.thresholds["stuckDeliverySeconds"]} seconds; {health.bus.dead} failed for good.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How long real readings take (last 7 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>Reading to graded: {describeTiming(health.timings_7d.reading_to_graded)}.</p>
          <p>Graded to task: {describeTiming(health.timings_7d.graded_to_task)}.</p>
          <p>Graded to page: {describeTiming(health.timings_7d.graded_to_page)}.</p>
          <p>Page to acknowledged: {describeTiming(health.timings_7d.page_to_ack)}.</p>
          <p className="text-charcoal-ink/60">A typical time appears only from {health.thresholds["minSample"]} events; fewer is shown as a count, never as a flattering average.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New grading against the old alerts (last 30 days)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            The old blood pressure alerts still run beside the new grading until the Chief Medical Officer is satisfied they agree. This compares each graded reading with
            what the old alert actually did. Nothing is switched off by this page.
          </p>
          {parityTotal === 0 ? (
            <p>No graded real readings yet, so there is nothing to compare.</p>
          ) : (
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>{["What happened", "Readings", "Note"].map((c) => <th key={c} className={head}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.group} className="border-t border-charcoal-ink/10">
                    <td className={cell}>{PARITY_TEXT[g.group].title}{PARITY_TEXT[g.group].concern && g.readings > 0 && <Badge variant="amber" className="ml-2">look</Badge>}</td>
                    <td className={cell}>{g.readings}{g.draft > 0 ? ` (${g.draft} graded by a draft rule set)` : ""}</td>
                    <td className={cell}>{PARITY_TEXT[g.group].note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-charcoal-ink/60">
            Limit: the old alert merges a repeat reading into an open alert and counts an emergency once in six hours, so only the first reading in such a window shows its old action.
          </p>
        </CardContent>
      </Card>

      {reliability && (
        <Card>
          <CardHeader>
            <CardTitle>Reliability figures (last {reliability.days} days)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p>Task to taken by a clinician: {describeTiming(reliability.timings.task_to_claim)}.</p>
            <p>
              Tasks that were due: {reliability.act_rate.due}; completed {reliability.act_rate.completed}, on time {reliability.act_rate.completed_on_time}
              {reliability.act_rate.withheld ? " (too few to read a rate)" : ""}.
            </p>
            <p>Pages sent: {reliability.page_ack.pages}; acknowledged {reliability.page_ack.acknowledged}{reliability.page_ack.withheld ? " (too few to read a rate)" : ""}.</p>
            <div>
              <p className="font-medium">Push notices opened, by phone make</p>
              {reliability.push_open_by_make.length === 0 ? (
                <p>No push notices to real people yet.</p>
              ) : (
                <ul className="list-disc pl-5">
                  {reliability.push_open_by_make.map((m) => (
                    <li key={m.make ?? "unknown"}>
                      {m.make ?? "Unknown"}: {"withheld" in m ? `fewer than ${m.under}, not shown` : `${m.opened} of ${m.sent} opened (${m.open_rate} percent)`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p>
              Clinician credentials: {reliability.credential_coverage.active_staff} active; licence date held for {reliability.credential_coverage.licence_date_held}; indemnity date held
              for {reliability.credential_coverage.indemnity_date_held_where_required} of {reliability.credential_coverage.indemnity_required} who need one; verification recorded for{" "}
              {reliability.credential_coverage.verification_recorded}; {reliability.credential_coverage.licence_expired} licence expired, {reliability.credential_coverage.licence_expires_within_30_days} expiring within 30 days.
            </p>
            <ul className="list-disc pl-5 text-charcoal-ink/60">
              {reliability.limits.map((l) => <li key={l}>{l}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
