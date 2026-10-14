import { signSoleCmoExceptionAction } from "../clinical-signoff/sole-cmo-exception-actions";

/**
 * Sign the sole-CMO on-call exception (founder decision 2026-10-15). Shown inline on the sign-off hub only while the organisation has exactly
 * one active Chief Medical Officer and no exception is in force. Nothing here signs anything until the CMO ticks, types SIGN and presses the button.
 */
export function SoleCmoExceptionPanel() {
  return (
    <div className="space-y-4">
      <section aria-labelledby="sce-allows" className="space-y-1">
        <h3 id="sce-allows" className="text-sm font-semibold text-charcoal-ink">What this allows</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>You may grant yourself the on-call competency, so you can be put on the on-call rota. That is all.</li>
          <li>The credentialing level that competency needs still applies to you, exactly as for anyone else.</li>
          <li>You can still grant the on-call competency to other doctors in the normal way.</li>
        </ul>
      </section>
      <section aria-labelledby="sce-never" className="space-y-1">
        <h3 id="sce-never" className="text-sm font-semibold text-charcoal-ink">What it never allows</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>Granting yourself any other competency. Every other self grant stays refused.</li>
          <li>Signing off your own credentials, protocols or anyone else&apos;s checks.</li>
          <li>Working in secret: your signature, the reason below and every use of it are recorded, and your organisation&apos;s admins and reviewers are told each time.</li>
        </ul>
      </section>
      <section aria-labelledby="sce-ends" className="space-y-1">
        <h3 id="sce-ends" className="text-sm font-semibold text-charcoal-ink">How it ends</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>It expires 12 months after you sign. After that you would need to sign again.</li>
          <li>You or an admin can revoke it at any time, with a written reason.</li>
          <li>The moment a second Chief Medical Officer is active it stops working, and the normal rule that someone else grants your competencies applies again.</li>
        </ul>
      </section>
      <form action={signSoleCmoExceptionAction} className="space-y-3">
        <label className="block text-sm text-charcoal-ink">
          Why this exception is needed (at least 40 characters)
          <textarea name="reason" rows={3} minLength={40} maxLength={1000} required className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
        </label>
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="understood" className="mt-1" required />
          <span>I have read what this allows, what it never allows and how it ends, and I sign this exception.</span>
        </label>
        <label className="block text-sm text-charcoal-ink">
          Type SIGN to confirm
          <input name="typed" autoComplete="off" required className="mt-1 w-40 rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm uppercase" />
        </label>
        <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          Sign the sole-CMO on-call exception
        </button>
      </form>
    </div>
  );
}
