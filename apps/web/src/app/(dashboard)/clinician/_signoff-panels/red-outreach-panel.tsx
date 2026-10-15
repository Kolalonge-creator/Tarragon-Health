import { PROPOSED_CONFIG } from "@tarragon/shared";
import { confirmRedOutreachAction } from "../clinical-signoff/red-outreach-actions";

function unconfirmedMinutes(): number {
  const latest = [...PROPOSED_CONFIG].filter((c) => c.key === "notifications.rules").sort((a, b) => b.version - a.version)[0];
  const red = (latest?.value as { redUnconfirmed?: { unconfirmedMinutes?: number } } | undefined)?.redUnconfirmed;
  return red?.unconfirmedMinutes ?? 30;
}

/**
 * Confirm the call-the-patient task type (S13 R4, CMO Q11). Shown inline on the sign-off hub. The minutes shown are the value
 * recorded as your decision; changing it is a new version of the notification rules, never an edit.
 */
export function RedOutreachPanel() {
  const minutes = unconfirmedMinutes();
  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
        <li>A Member gets a short, plain message whenever a red alert is raised for them. It names nothing.</li>
        <li>
          If they have not opened it, acknowledged the guidance or answered within {minutes} minutes, one top-priority task, Call the patient, opens for the
          clinician on call, who is alerted at once. If a push to their phone fails outright, the call comes sooner.
        </li>
        <li>A second red for the same person joins the same task. Opening the message, acknowledging, or a clinician acknowledging the alert cancels an unclaimed task.</li>
        <li>On the Free plan nothing is created and no clinician is alerted.</li>
        <li>The patient&apos;s answer, I have sought care or I could not get care, is shown to the clinician and never stops the paging.</li>
      </ul>
      <form action={confirmRedOutreachAction} className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="understood" className="mt-1" required />
          <span>I have read this and I confirm the call-the-patient task type for use with patients.</span>
        </label>
        <label className="block text-sm text-charcoal-ink">
          Note (optional)
          <textarea name="note" rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          Confirm the call-the-patient task type
        </button>
      </form>
    </div>
  );
}
