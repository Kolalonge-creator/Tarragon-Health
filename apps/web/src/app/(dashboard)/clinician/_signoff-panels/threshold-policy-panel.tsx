import { signThresholdPolicyAction } from "../threshold-overrides/actions";

/**
 * Sign the personal-threshold policy. Until it is signed no doctor can propose a personal threshold. Signing sets how long a threshold may run (90 days) and the
 * monthly review; it does not set any patient's number.
 */
export function ThresholdPolicyPanel({ policyId, version }: { policyId: string | null; version: number | null }) {
  return (
    <div className="space-y-4">
      <section aria-labelledby="tp-allows" className="space-y-1">
        <h3 id="tp-allows" className="text-sm font-semibold text-charcoal-ink">What this switches on</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>A senior doctor who is tied to a patient can set a personal threshold for that patient and sign it by typing SIGN.</li>
          <li>It can stop two routine amber alerts for a patient whose usual readings sit above the standard lines (the seven day average over target, and a low reading with no symptom), or make the checks more sensitive (a stricter blood pressure target, a higher glucose low line).</li>
          <li>Every threshold runs at most 90 days, then returns to the default by itself. You review each one monthly here, and can end any of them.</li>
        </ul>
      </section>
      <section aria-labelledby="tp-never" className="space-y-1">
        <h3 id="tp-never" className="text-sm font-semibold text-charcoal-ink">What it can never do</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>Lower or hold back a red alert, or any alert on a reading that comes with a symptom.</li>
          <li>Apply in pregnancy, the six weeks after a birth, under 18, or where the date of birth is unknown.</li>
          <li>Move a line outside the fixed limits in the code and the database (for example a target above 160/100).</li>
          <li>Tell the patient a number. The patient is told only that the care team set personal targets.</li>
        </ul>
      </section>
      {policyId === null ? (
        <p className="text-sm text-charcoal-ink/70">No policy version is waiting.</p>
      ) : (
        <form action={signThresholdPolicyAction} className="space-y-3">
          <input type="hidden" name="policy_id" value={policyId} />
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read what this switches on and what it can never do, and I sign personal threshold policy version {version ?? ""}.</span>
          </label>
          <label className="block text-sm text-charcoal-ink">
            Type SIGN to confirm
            <input name="typed" autoComplete="off" required className="mt-1 w-40 rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm uppercase" />
          </label>
          <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
            Sign the personal threshold policy
          </button>
        </form>
      )}
    </div>
  );
}
