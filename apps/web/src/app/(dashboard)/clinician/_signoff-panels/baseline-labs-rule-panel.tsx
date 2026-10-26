import { signBaselineLabsRuleAction } from "../clinical-signoff/baseline-labs-rule-actions";
import type { BaselineLabsRuleView } from "@/lib/queries/pending-baseline-labs-rule-signoff";

/**
 * Sign the baseline-labs prescribing rule. Shown inline on the sign-off hub. Every medicine, lab and number is read from the draft being signed, so
 * the words and the values cannot differ. Until signed, the check does nothing for anyone.
 */
export function BaselineLabsRulePanel({ version, rule }: { version: number | null; rule: BaselineLabsRuleView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signBaselineLabsRuleAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Baseline labs before a start or a dose increase, version {version}</h3>
      {rule ? (
        <div className="space-y-2 text-sm text-charcoal-ink">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-charcoal-ink/90">{rule.proposedNote}</p>
          <p><span className="font-medium">When it applies.</span> {rule.appliesTo}</p>
          <div>
            <p className="font-medium">Which medicines</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              {rule.groups.map((g) => (
                <li key={g.label}><span className="font-medium">{g.label}:</span> {g.medicines.join(", ")}</li>
              ))}
            </ul>
            <p className="mt-1 text-charcoal-ink/80">{rule.groupsNote}</p>
          </div>
          <div>
            <p className="font-medium">Labs that must be on file (proposed)</p>
            <ul className="list-disc pl-5 text-charcoal-ink/80">
              <li>For every medicine above: {rule.requiredForAll.join(", ")}.</li>
              <li>Also, when diabetes is on the patient&apos;s problem list: {rule.requiredIfDiabetes.join(", ")}.</li>
            </ul>
            <p className="mt-1 text-charcoal-ink/80">{rule.diabetesNote}</p>
          </div>
          <p><span className="font-medium">How recent (proposed): {rule.windowDays} days.</span> {rule.windowNote}</p>
          <p><span className="font-medium">If a lab is missing.</span> {rule.whenMissing}</p>
          <p><span className="font-medium">No bypass in this version.</span> {rule.bypassNote}</p>
          <p className="text-charcoal-ink/80">{rule.membershipNote}</p>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The rule in this draft could not be read, so it is not shown here. Do not sign until it can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rule} />
        <span>I have read the medicines, the labs, the {rule?.windowDays ?? "proposed"}-day window and the refusal with no bypass, and I sign baseline labs rule version {version}. Until I do, nothing is checked.</span>
      </label>
      <button type="submit" className={btn} disabled={!rule}>Sign baseline labs rule version {version}</button>
    </form>
  );
}
