import { attestConditionAction } from "@/lib/go-live/actions";
import { signMentalHealthWorklistConfigAction } from "../clinical-signoff/mental-wellbeing-actions";
import { wordingFingerprint, wordingLines, type AttestationSlot, type WorklistRulesView } from "@/lib/clinical/mental-wellbeing-signoff-model";

const btn = "min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

function Attestation({ slot }: { slot: AttestationSlot }) {
  const fp = slot.wordingSet ? wordingFingerprint(slot.wordingSet) : null;
  const lines = slot.wordingSet ? wordingLines(slot.wordingSet) : [];
  return (
    <div className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
      <h4 className="font-medium text-charcoal-ink">{slot.title}</h4>
      <p className="text-sm text-charcoal-ink/80">{slot.intro}</p>
      {lines.length > 0 && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-charcoal-ink">
          {lines.map((l) => <li key={l.key}>{l.text}</li>)}
        </ol>
      )}
      <form action={attestConditionAction} className="space-y-3">
        <input type="hidden" name="viewer" value="cmo" />
        <input type="hidden" name="back" value="hub" />
        <input type="hidden" name="key" value={slot.guard} />
        <input type="hidden" name="code" value={slot.code} />
        <input type="hidden" name="met" value="1" />
        {fp && <input type="hidden" name="fingerprint" value={fp} />}
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="read" required className="mt-1 h-5 w-5" />
          <span>I have read this in full. Recording it switches nothing on.</span>
        </label>
        <label className="block text-xs text-charcoal-ink">
          Note (optional, kept with your name and the time)
          <input name="note" required={!fp} minLength={fp ? undefined : 10} maxLength={900} className={field} />
        </label>
        <button type="submit" className={btn}>Record this</button>
      </form>
    </div>
  );
}

/**
 * The sign-off block for the S56b wellbeing features, inline on the hub: the worklist rules to sign (read from the draft itself), and the
 * attestations each guard needs (cover, the exact wording with its fingerprint, the accessibility check). Signing or recording switches
 * nothing on; each guard is switched on separately, by the CMO, on the go-live page.
 */
export function MentalWellbeingPanel({ worklistVersion, worklistRules, attestations }: { worklistVersion: number | null; worklistRules: WorklistRulesView | null; attestations: AttestationSlot[] }) {
  return (
    <div className="space-y-5">
      {worklistVersion !== null && (
        <form action={signMentalHealthWorklistConfigAction} className="space-y-3">
          <input type="hidden" name="version" value={worklistVersion} />
          <h3 className="font-medium text-charcoal-ink">Mental health follow-up list, rules version {worklistVersion}</h3>
          {worklistRules ? (
            <>
              <p className="text-sm text-charcoal-ink/80">A tied clinician sees a patient on this list when any of these is true. The list is not a risk predictor and says so on the screen.</p>
              <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
                {worklistRules.lines.map((l) => <li key={l}>{l}</li>)}
              </ul>
            </>
          ) : (
            <p className="text-sm text-charcoal-ink/80">The rules in this draft could not be read, so they are not shown here. Do not sign until they can be.</p>
          )}
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1 h-5 w-5" required disabled={!worklistRules} />
            <span>I have read the rules and the numbers, and I sign version {worklistVersion} for use. The list stays hidden until the guard is switched on.</span>
          </label>
          <button type="submit" className={btn} disabled={!worklistRules}>Sign follow-up list rules version {worklistVersion}</button>
        </form>
      )}
      {attestations.map((slot) => <Attestation key={`${slot.guard}:${slot.code}`} slot={slot} />)}
    </div>
  );
}
