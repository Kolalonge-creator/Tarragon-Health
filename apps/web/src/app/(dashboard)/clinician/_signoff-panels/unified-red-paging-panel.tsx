import { switchOffUnifiedRedPagingAction, switchOnUnifiedRedPagingAction } from "../clinical-signoff/unified-red-paging-actions";

/**
 * Switch unified red-event paging on (or off). Shown inline on the sign-off hub. It does nothing until the Chief Medical Officer ticks both boxes
 * and presses the button; nothing switches it on automatically, and switching it off never closes a page that is already open.
 */
export function UnifiedRedPagingPanel({ waitingVersion, liveVersion }: { waitingVersion: number | null; liveVersion: number | null }) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  const stop = "rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900 hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400";
  return (
    <div className="space-y-6">
      {liveVersion !== null && (
        <form action={switchOffUnifiedRedPagingAction} className="space-y-3">
          <h3 className="font-medium text-charcoal-ink">Unified red-event paging is ON (version {liveVersion})</h3>
          <p className="text-sm text-charcoal-ink/80">
            A very low oxygen reading, a very fast or slow heart rate, a high temperature, a red-flag symptom or an emergency event for a Member now pages the
            clinician on call through the same ladder as a blood pressure red event. If anything looks wrong, switch it off here. Pages already open stay open and keep
            escalating; only new events go back to the older notification.
          </p>
          <button type="submit" className={stop}>Switch unified red-event paging OFF</button>
        </form>
      )}
      {waitingVersion !== null && (
        <form action={switchOnUnifiedRedPagingAction} className="space-y-3">
          <input type="hidden" name="version" value={waitingVersion} />
          <h3 className="font-medium text-charcoal-ink">
            Unified red-event paging, version {waitingVersion} {liveVersion === null ? "(off)" : `(replaces version ${liveVersion}, which stays on record)`}
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>Today only a blood pressure red event pages the clinician on call. Low oxygen, a dangerous heart rate, a high temperature, a red-flag symptom and emergency events instead notify every clinician at once, with no one named as responsible and no acknowledgement.</li>
            <li>Switched on, those events page the clinician on call, with the backup after 5 minutes and the clinical lead after 10, and the older notify-everyone step is skipped for that event.</li>
            <li>If a page cannot be made, or nobody is on cover, the older notification still runs. A red event is never left without a notification to a clinician.</li>
            <li>For an event a page covers, the older notification does not exist, so it can no longer climb to a text message (pages never use SMS). If the paged clinician cannot be reached by push, email or the console, the backup is paged at 5 minutes and the clinical lead at 10, and an ops person is asked to phone.</li>
            <li>The Care Circle is not told about these pages in this version. Reproductive-health, exposure, AI coach and support-ticket emergencies, glucose emergencies and mental health crises are left on their existing paths.</li>
            <li>A patient on the Free plan is not paged. They still get the emergency guidance and their emergency contact is notified as before. Amber levels and blood pressure are unchanged.</li>
            <li>You can switch it off at any time. Pages already open are left alone.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="test_pack_run" className="mt-1" required />
            <span>I have run the staging test pack (docs/plans/S16-S20-unified-red-paging-test-pack.md) with test patients and every scenario gave the expected result.</span>
          </label>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I switch unified red-event paging version {waitingVersion} on.</span>
          </label>
          <button type="submit" className={btn}>Switch unified red-event paging on (version {waitingVersion})</button>
        </form>
      )}
    </div>
  );
}
