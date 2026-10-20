import { GLUCOSE_WORDING_DATA, GLUCOSE_WORDING_SIGNED } from "@tarragon/i18n";
import { attestConditionAction } from "@/lib/go-live/actions";
import { FAST_SUGAR_CONDITION, FAST_SUGAR_GUARD } from "@/lib/queries/pending-fast-sugar-wording-signoff";

/** The two glucose messages that carry the fast-sugar treatment instruction. Read from the same file the phone and the web bundle, so what is shown is what would ship. */
const FAST_SUGAR_CODES = ["GLU-E01", "GLU-T01"] as const;
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/**
 * The Chief Medical Officer's own signature on the fast-sugar treatment wording (OQ-326), inline on the sign-off hub. It is separate from the glucose rules on
 * purpose: those are thresholds, this is the sentence a patient with a low sugar reads. It shows the exact proposed text beside what is shown today, then one form
 * that records the attestation through the same server action the go-live page uses. Nothing is switched on by this, and the proposed text reaches patients only
 * once the build marks the wording signed.
 */
export function FastSugarWordingPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-base font-semibold text-charcoal-ink">Fast-sugar treatment wording</h3>
        <p className="mt-1 text-sm text-charcoal-ink/70">
          Read the two messages below. They tell a patient with a low sugar to take about 15 grams of fast sugar (half a glass of a sweet drink, or 3 to 4 teaspoons of sugar or honey) and to check again in 15 minutes. The Nigerian guideline draft says 10 to 15 minutes; the final text could not be opened. This is a separate signature from the glucose rules.
        </p>
        {GLUCOSE_WORDING_SIGNED ? (
          <p className="mt-1 text-sm text-charcoal-ink/70">The build marks the wording signed by {GLUCOSE_WORDING_SIGNED.by} on {GLUCOSE_WORDING_SIGNED.on}.</p>
        ) : (
          <p className="mt-1 text-sm text-charcoal-ink/70">Today the plain text is shown. The proposed text below is not in force and stays unsigned until you record your signature here and the build is updated to match.</p>
        )}
      </div>
      <ul className="grid gap-2">
        {FAST_SUGAR_CODES.map((code) => {
          const w = GLUCOSE_WORDING_DATA.codes[code];
          return (
            <li key={code} className="rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm dark:border-night-ink/15 dark:bg-night-card">
              <p className="font-mono text-xs text-charcoal-ink/60">{code}</p>
              <p className="text-charcoal-ink"><span className="font-semibold">Shown today:</span> {w.current.title}. {w.current.body}</p>
              <p className="mt-1 text-charcoal-ink"><span className="font-semibold">Proposed:</span> {w.proposed.title}. {w.proposed.body}</p>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-charcoal-ink/60">Recording this switches nothing on and does not sign the glucose rules.</p>
      <form action={attestConditionAction} className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
        <input type="hidden" name="viewer" value="cmo" />
        <input type="hidden" name="back" value="hub" />
        <input type="hidden" name="key" value={FAST_SUGAR_GUARD} />
        <input type="hidden" name="code" value={FAST_SUGAR_CONDITION} />
        <input type="hidden" name="met" value="1" />
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="read" required className="mt-1 h-5 w-5" />
          <span>I have read both messages in full and sign this wording as written.</span>
        </label>
        <label className="block text-xs text-charcoal-ink">
          What you checked (a sentence)
          <input name="note" required minLength={10} maxLength={1000} placeholder="For example: read both messages and the quantities against the guideline" className={field} />
        </label>
        <button type="submit" className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">
          Sign the fast-sugar wording
        </button>
      </form>
    </div>
  );
}
