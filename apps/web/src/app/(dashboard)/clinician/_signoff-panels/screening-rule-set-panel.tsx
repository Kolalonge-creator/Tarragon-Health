import type { PendingScreeningRuleSet } from "@/lib/queries/pending-screening-rule-set-signoff";
import { signScreeningRuleSetAction } from "../clinical-signoff/screening-rule-set-actions";

/**
 * The screening rule set draft that adds pacing for new patients. Shows exactly what the draft adds, read from the draft, and the sign form.
 * Signing makes this version the one in force; the rules themselves are the previous version's, unchanged. Nothing is signed until the CMO
 * ticks, types SIGN and presses the button.
 */
export function ScreeningRuleSetPanel({ pending }: { pending: PendingScreeningRuleSet }) {
  const p = pending.pacing;
  return (
    <div className="space-y-4">
      <section aria-labelledby="srs-adds" className="space-y-1">
        <h3 id="srs-adds" className="text-sm font-semibold text-charcoal-ink">What version {pending.version} adds</h3>
        {p ? (
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>At most <strong>{p.maxNewRequestsPerWeek}</strong> new printed test requests per patient in any 7 days. Without this, a new patient gets every due request on the first night.</li>
            <li>When more are due than the limit, they go in this order, and the rest wait for the next night with room:</li>
          </ul>
        ) : (
          <p className="text-sm text-charcoal-ink/80">This draft does not carry a readable pacing block.</p>
        )}
        {p && (
          <ol className="list-decimal space-y-0.5 pl-10 text-sm text-charcoal-ink/80">
            {p.priority.map((t) => (<li key={t.code}>{t.name}</li>))}
          </ol>
        )}
        {p && <p className="text-sm text-charcoal-ink/80">Any test not on this list comes after these, by due date.</p>}
      </section>
      <section aria-labelledby="srs-same" className="space-y-1">
        <h3 id="srs-same" className="text-sm font-semibold text-charcoal-ink">What stays the same</h3>
        <p className="text-sm text-charcoal-ink/80">
          {pending.signable
            ? `The screening rules themselves are exactly those of version ${pending.liveVersion}. Nothing about who is screened for what, or how often, changes.`
            : "This draft does not match the version in force, or has no valid pacing block, so it cannot be signed here."}
        </p>
        <p className="text-sm text-charcoal-ink/80">A patient on their first night also gets one grouped reminder instead of one per test. That needs no signature.</p>
      </section>
      {pending.signable && pending.draftId && (
        <form action={signScreeningRuleSetAction} className="space-y-3">
          <input type="hidden" name="id" value={pending.draftId} />
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read the limit and the order, and I sign version {pending.version} as the screening rules in force.</span>
          </label>
          <label className="block text-sm text-charcoal-ink">
            Type SIGN to confirm
            <input name="typed" autoComplete="off" required className="mt-1 w-40 rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm uppercase" />
          </label>
          <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
            Sign screening rules version {pending.version}
          </button>
        </form>
      )}
    </div>
  );
}
