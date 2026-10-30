import { attestConditionAction } from "@/lib/go-live/actions";
import { STAGE2_CODE, STAGE2_GUARD } from "@/lib/queries/pending-stage2-attestation";

const field = "mt-1 w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink dark:border-night-ink/25";

/** The sections of the Stage 2 exit criteria document (docs/design/STAGE-2-EXIT-CRITERIA-DRAFT.md), named so the person attesting knows what they are vouching for. */
const SECTIONS = [
  "A. Stage 1 complete, safety cases passed on real phones",
  "B. Clinical safety: on-call rota, live page drills, escalation times, doctor capacity",
  "C. Payments: a real payment, a real refund, settlements reconcile",
  "D. Data protection: point-in-time recovery, a restore drill, signed processor agreements, retention",
  "E. Security reviews",
  "F. AI governance approvals and test results",
  "G. Operations: incident owner, support channel, status page, alerting",
  "H. Legal and regulatory opinions",
] as const;

/**
 * The founder's or Chief Medical Officer's own attestation that the Stage 2 exit criteria are met (go-live guard public_signup_enabled,
 * condition stage2_exit_criteria_met). It calls the same server action as the go-live page, returning to this hub. The database refuses anyone
 * but an admin or the active CMO and records the name and time. It does not open public sign-up: an administrator still switches the guard on.
 */
export function Stage2AttestationPanel() {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-heading text-base font-semibold text-charcoal-ink">Stage 2 exit criteria: attest that they are met</h3>
        <p className="mt-1 max-w-3xl text-sm text-charcoal-ink/70">
          The system cannot check these itself, so your attestation is the record. It is the one condition standing between invite-only sign-up and
          public sign-up. By attesting you say every item in the Stage 2 exit criteria document is met on the day you press the button, with its proof
          attached. A later withdrawal is possible and is also recorded.
        </p>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink">
        {SECTIONS.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>
      <p className="text-xs text-charcoal-ink/60">
        This records your attestation under your name and the time. It does not switch public sign-up on: an administrator does that from the go-live page,
        with a reason.
      </p>
      <form action={attestConditionAction} className="space-y-3 rounded-lg border border-charcoal-ink/10 p-4">
        <input type="hidden" name="viewer" value="cmo" />
        <input type="hidden" name="back" value="hub" />
        <input type="hidden" name="key" value={STAGE2_GUARD} />
        <input type="hidden" name="code" value={STAGE2_CODE} />
        <input type="hidden" name="met" value="1" />
        <label className="flex items-start gap-2 text-sm text-charcoal-ink">
          <input type="checkbox" name="read" required className="mt-1 h-5 w-5" />
          <span>I have checked the Stage 2 exit criteria and every item is met.</span>
        </label>
        <label className="block text-xs text-charcoal-ink">
          What you checked, and when (at least 10 characters)
          <input
            name="note"
            required
            minLength={10}
            maxLength={900}
            placeholder="For example: checked sections A to H against the exit criteria document on the day"
            className={field}
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green"
        >
          Attest that the Stage 2 criteria are met
        </button>
      </form>
    </div>
  );
}
