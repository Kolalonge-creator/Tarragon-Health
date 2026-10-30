import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadFailure } from "@/components/ui/load-failure";
import { ladderConcerns, type RedLadder } from "@/lib/chain-health/red-ladder";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never";
}

function changeText(c: { changed_at: string; changed_by: string; new_value: boolean; reason: string } | null): string {
  return c ? `switched ${c.new_value ? "on" : "off"} by ${c.changed_by} on ${when(c.changed_at)}: ${c.reason}` : "never changed";
}

/**
 * W-03: the red-page ladder in one card: the every-minute red chain check, failed red chain steps handed to the ops desk, whether enough
 * credentialed clinicians cover the next four weeks of the rota, the dated end of the sole chief medical officer exception, and whether the
 * final phone call was logged. Counts and clinician names only: no patient. English only (staff page). `ladder` null means the read failed,
 * which is never shown as healthy.
 */
export function RedLadderCard({ ladder }: { ladder: RedLadder | null }) {
  if (!ladder) {
    return <LoadFailure>The red page ladder could not be read. That does not mean it is fine. Try again, and tell the platform team if it keeps failing.</LoadFailure>;
  }
  const concerns = ladderConcerns(ladder);
  const severe = concerns.some((c) => c.severe);
  const sc = ladder.rota.sole_cmo_exception;
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Red page ladder <Badge variant={concerns.length === 0 ? "green" : severe ? "red" : "amber"} className="ml-2">{concerns.length === 0 ? "Covered" : "Needs a look"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {concerns.length === 0 ? (
          <p>The red chain check is running, no failed step is waiting, cover meets the minimum and every expired page has a logged call.</p>
        ) : (
          <ul className="list-disc pl-5">{concerns.map((c) => <li key={c.key}>{c.text}</li>)}</ul>
        )}
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <div>
            <dt className="font-semibold">Red chain check, every {ladder.red_lane.inject_every_minutes} minutes</dt>
            <dd>{ladder.red_lane.enabled ? "On" : "Off"}. A break is normally seen within {ladder.red_lane.inject_every_minutes} to {Math.round(ladder.red_lane.detection_budget_seconds / 60)} minutes, at worst {Math.round(ladder.red_lane.detection_budget_seconds / 60)}. Last result {when(ladder.red_lane.last_judged_at)}{ladder.red_lane.last_passed === null ? "" : ladder.red_lane.last_passed ? ", passed" : ", failed"}. Last day: {ladder.red_lane.runs_24h} runs, {ladder.red_lane.failures_24h} failed twice in a row (paged), {ladder.red_lane.blips_24h} single failure(s) (not paged; two in a row page).</dd>
          </div>
          <div>
            <dt className="font-semibold">Failed red chain steps</dt>
            <dd>Phoning the ops desk is {ladder.dead_letters.paging_enabled ? "on" : "off"}. Open now: {ladder.dead_letters.open}. Handed to the ops desk in 30 days: {ladder.dead_letters.paged_30d}.</dd>
          </div>
          <div>
            <dt className="font-semibold">Rota, next {ladder.rota.window_days} days</dt>
            <dd>{ladder.rota.distinct_credentialed_on_rota} of {ladder.rota.required_clinicians} credentialed clinicians on it. {ladder.rota.hours_uncovered} hour(s) with nobody credentialed, {ladder.rota.hours_without_backup} with no credentialed backup. {ladder.rota.eligible_on_call_staff} credentialed on-call clinician(s) exist in total.</dd>
          </div>
          <div>
            <dt className="font-semibold">Sole chief medical officer exception</dt>
            <dd>{sc.exception_ended ? "Exception ended." : null} {sc.sunset ? `Ends after ${sc.sunset}${sc.days_to_sunset !== null ? ` (${sc.days_to_sunset < 0 ? "ended" : `${sc.days_to_sunset} day(s) left`})` : ""}.` : "No end date set."} {sc.in_force ? "In force." : "Not in force."}</dd>
          </div>
          <div>
            <dt className="font-semibold">Final phone call</dt>
            <dd>Expired red pages in 30 days: {ladder.phone_fallbacks.expired_pages_30d}, without a logged call: {ladder.phone_fallbacks.expired_pages_without_call_30d}. Calls logged: {ladder.phone_fallbacks.calls_30d}. Last call {when(ladder.phone_fallbacks.last_call_at)}.</dd>
          </div>
          <div>
            <dt className="font-semibold">Last switch changes</dt>
            <dd>
              Red chain check: {changeText(ladder.switch_changes.red_lane)}. Dead letter paging: {changeText(ladder.switch_changes.dead_letter_paging)}.
            </dd>
          </div>
        </dl>
        <p className="text-xs text-charcoal-ink/70">When you log a phone call, choose an outcome from the list. A note is optional: never put a patient name or any health detail in it.</p>
        {ladder.rota.clinicians.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Clinician on the rota</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Shifts</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Hours</th>
                  <th className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Credentialed</th>
                </tr>
              </thead>
              <tbody>
                {ladder.rota.clinicians.map((c, i) => (
                  <tr key={`${c.name}-${i}`}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className="px-3 py-2">{c.shifts}</td>
                    <td className="px-3 py-2">{c.hours}</td>
                    <td className="px-3 py-2">{c.credentialed ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
