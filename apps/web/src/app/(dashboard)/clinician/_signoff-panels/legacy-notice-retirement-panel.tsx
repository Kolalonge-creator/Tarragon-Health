import { switchOffLegacyNoticeRetirementAction, switchOnLegacyNoticeRetirementAction } from "../clinical-signoff/legacy-notice-retirement-actions";
import type { LegacyNoticeMeasurementRow, LegacyNoticeVersion } from "@/lib/queries/pending-legacy-notice-retirement-signoff";

const KIND_LABEL: Record<string, string> = {
  bp_red: "Blood pressure red",
  bp_emergency: "Blood pressure emergency",
  glucose_emergency: "Glucose emergency",
};

/**
 * Retire the notify-everyone message for blood pressure and glucose once the on-call page is proven (S19f), or switch it off again. Shown inline on
 * the sign-off hub. It does nothing until the Chief Medical Officer ticks both boxes and presses a button; nothing switches it on automatically.
 * Several versions can wait: the CMO chooses one, and the parallel-run version has to be switched on first before a version that retires anything.
 */
export function LegacyNoticeRetirementPanel({
  liveVersion,
  waiting,
  measurement,
}: {
  liveVersion: LegacyNoticeVersion | null;
  waiting: LegacyNoticeVersion[];
  measurement: LegacyNoticeMeasurementRow[];
}) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  const stop = "rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400";
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="font-medium text-charcoal-ink">What the pages are doing beside the older message (last 14 days, real patients)</h3>
        {measurement.length === 0 ? (
          <p className="text-sm text-charcoal-ink/80">
            Nothing has been recorded yet. Switch on the parallel-run version first: it changes nothing for anyone and starts measuring.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-charcoal-ink">
              <thead>
                <tr className="border-b border-charcoal-ink/20">
                  <th className="py-1 pr-4 font-medium">Pathway</th>
                  <th className="py-1 pr-4 font-medium">Events</th>
                  <th className="py-1 pr-4 font-medium">Page seen</th>
                  <th className="py-1 pr-4 font-medium">Page first</th>
                  <th className="py-1 pr-4 font-medium">Page in time and reachable</th>
                  <th className="py-1 pr-4 font-medium">Primary not reachable</th>
                  <th className="py-1 pr-4 font-medium">Suppressed</th>
                  <th className="py-1 pr-4 font-medium">Sent late</th>
                  <th className="py-1 pr-4 font-medium">Median / slowest 5% (seconds)</th>
                </tr>
              </thead>
              <tbody>
                {measurement.map((m) => (
                  <tr key={m.kind} className="border-b border-charcoal-ink/10">
                    <td className="py-1 pr-4">{KIND_LABEL[m.kind] ?? m.kind}</td>
                    <td className="py-1 pr-4">{m.events}</td>
                    <td className="py-1 pr-4">{m.page_seen}</td>
                    <td className="py-1 pr-4">{m.page_first}</td>
                    <td className="py-1 pr-4">{m.page_within_hold}</td>
                    <td className="py-1 pr-4">{m.primary_not_reachable}</td>
                    <td className="py-1 pr-4">{m.suppressed}</td>
                    <td className="py-1 pr-4">{m.released}</td>
                    <td className="py-1 pr-4">
                      {m.median_lag_seconds === null ? "none" : Math.round(m.median_lag_seconds)} / {m.p95_lag_seconds === null ? "none" : Math.round(m.p95_lag_seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-charcoal-ink/70">
          A page that arrives after the older message shows a positive number of seconds; zero or below means a page was already ringing for that patient.
          Glucose shows nothing until the glucose rules are signed, because no page can exist before then.
        </p>
      </section>

      {liveVersion !== null && (
        <form action={switchOffLegacyNoticeRetirementAction} className="space-y-3">
          <h3 className="font-medium text-charcoal-ink">Version {liveVersion.version} is ON</h3>
          <p className="text-sm text-charcoal-ink/80">{liveVersion.description}</p>
          <p className="text-sm text-charcoal-ink/80">
            If anything looks wrong, switch it off here. Any held message with no confirmed page is sent at once; pages already open stay open.
          </p>
          <button type="submit" className={stop}>Switch OFF</button>
        </form>
      )}

      {waiting.map((w) => (
        <form key={w.version} action={switchOnLegacyNoticeRetirementAction} className="space-y-3">
          <input type="hidden" name="version" value={w.version} />
          <h3 className="font-medium text-charcoal-ink">
            Version {w.version} {liveVersion === null ? "(off)" : `(would replace version ${liveVersion.version}, which stays on record)`}
          </h3>
          <p className="text-sm text-charcoal-ink/80">{w.description}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>If no page can be expected (no one on cover, the paged clinician cannot be reached, the rules are not signed, the event bus is quiet, or the patient is on the Free plan) the older message is sent at once, exactly as today.</li>
            <li>Amber levels, every other kind of event and the abnormal screening result pathway are not touched.</li>
            <li>You can switch it off at any time.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="test_pack_run" className="mt-1" required />
            <span>I have run the staging test pack (docs/plans/S19f-legacy-notice-retirement-test-pack.md) with test patients and every scenario gave the expected result.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I switch version {w.version} on.</span>
          </label>
          <button type="submit" className={btn}>Switch version {w.version} on</button>
        </form>
      ))}
    </div>
  );
}
