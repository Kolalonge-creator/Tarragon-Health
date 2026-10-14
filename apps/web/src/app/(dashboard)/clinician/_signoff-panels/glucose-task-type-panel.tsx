import { confirmGlucoseTaskTypeAction } from "../clinical-signoff/glucose-task-type-actions";

/**
 * Confirm the urgent glucose review task type (R2, CMO Q7 and Q8). Shown inline on the sign-off hub, before the glucose rule set line: the rule set
 * cannot be signed until this is confirmed. Confirming opens no task by itself.
 */
export function GlucoseTaskTypePanel() {
  return (
    <div className="space-y-4">
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
        <li>When a glucose reading needs a same-day look but is not an emergency (ketones raised without warning signs, or a very high reading), one Urgent glucose review task opens for a doctor.</li>
        <li>It is due the same day and routes to a Senior Medical Officer or the Chief Medical Officer. A second one for the same person joins the first.</li>
        <li>No task opens from a glucose reading until you have signed the glucose rules (they are graded in shadow until then). Confirming this does not sign them.</li>
        <li>On the Free plan no task is opened and no doctor is alerted.</li>
      </ul>
      <form action={confirmGlucoseTaskTypeAction} className="space-y-3">
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="understood" className="mt-1" required />
          <span>I have read this and I confirm the urgent glucose review task type for use with patients.</span>
        </label>
        <label className="block text-sm text-charcoal-ink">
          Note (optional)
          <textarea name="note" rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
        </label>
        <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          Confirm the urgent glucose review task type
        </button>
      </form>
    </div>
  );
}
