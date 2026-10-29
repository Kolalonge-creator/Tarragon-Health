import { signOwedSignoffAction } from "../clinical-signoff/owed-signoff-actions";

/**
 * Sign one owed line (a thing that is running or drafted but was never signed by the Chief Medical Officer in person). Shown inline on the
 * sign-off hub. Nothing here signs anything until the CMO ticks, types SIGN and writes what was checked. Signing records that the check was
 * done; it does not switch anything on or off. To change a switch, use the go-live page.
 */
export function OwedSignoffPanel({ subjectKey, running }: { subjectKey: string; running: boolean }) {
  return (
    <form action={signOwedSignoffAction} className="space-y-3">
      <input type="hidden" name="subject" value={subjectKey} />
      <p className="text-sm text-charcoal-ink/80">
        {running
          ? "This is already in effect. Signing records that you checked it yourself; it changes nothing else. If you cannot confirm it, switch it off from the go-live page instead."
          : "This is drafted and not yet in effect. Signing records that you verified it; it does not switch anything on."}
      </p>
      <label className="block text-sm text-charcoal-ink">
        What you checked (at least 20 characters)
        <textarea name="note" rows={3} minLength={20} maxLength={1000} required className="mt-1 w-full rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm" />
      </label>
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required />
        <span>I checked this myself and I sign it.</span>
      </label>
      <label className="block text-sm text-charcoal-ink">
        Type SIGN to confirm
        <input name="typed" autoComplete="off" required className="mt-1 w-40 rounded-lg border border-charcoal-ink/20 px-3 py-2 text-sm uppercase" />
      </label>
      <button type="submit" className="rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
        Sign
      </button>
    </form>
  );
}
