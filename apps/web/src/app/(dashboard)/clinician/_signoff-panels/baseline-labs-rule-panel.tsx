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
          {rule.classRules.length > 0 ? (
            <div>
              <p className="font-medium">Labs that must be on file, by medicine (proposed)</p>
              <table className="mt-1 w-full text-left">
                <thead><tr><th className="py-1 pr-3 font-medium">Medicine</th><th className="py-1 font-medium">Results needed</th></tr></thead>
                <tbody>
                  {rule.classRules.map((c) => (
                    <tr key={c.label} className="border-t border-charcoal-ink/10 align-top">
                      <td className="py-1 pr-3">{c.label}</td>
                      <td className="py-1">{c.tests}{c.note ? <span className="block text-charcoal-ink/70">{c.note}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-charcoal-ink/80">
                {rule.extraRules.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </div>
          ) : (
            <div>
              <p className="font-medium">Labs that must be on file (proposed)</p>
              <ul className="list-disc pl-5 text-charcoal-ink/80">
                <li>For every medicine above: {rule.requiredForAll.join(", ")}.</li>
                <li>Also, for every glucose-lowering medicine: {rule.requiredForGlucoseLowering.join(", ")}.</li>
                <li>Also, for a blood-pressure-lowering medicine when diabetes is on the patient&apos;s problem list: {rule.requiredIfDiabetes.join(", ")}.</li>
              </ul>
              <p className="mt-1 text-charcoal-ink/80">{rule.diabetesNote}</p>
            </div>
          )}
          <p><span className="font-medium">How recent (proposed): {rule.windowDays} days.</span> {rule.windowNote}</p>
          <p><span className="font-medium">If a laboratory result is missing.</span> {rule.whenMissing}</p>
          <div>
            <p className="font-medium">The documented override (emergencies and pending results)</p>
            <p className="text-charcoal-ink/80">{rule.bypassNote}</p>
            <ul className="mt-1 list-disc pl-5 text-charcoal-ink/80">
              {rule.overrideReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="mt-1 text-charcoal-ink/80">{rule.overrideWho}</p>
          </div>
          <p className="text-charcoal-ink/80">{rule.membershipNote}</p>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The rule in this draft could not be read, so it is not shown here. Do not sign until it can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rule} />
        <span>I have read the medicines, the labs for each, the {rule?.windowDays ?? "proposed"}-day window, the refusal and the documented override, and I sign baseline labs rule version {version}. Until I do, nothing is checked.</span>
      </label>
      <button type="submit" className={btn} disabled={!rule}>Sign baseline labs rule version {version}</button>
    </form>
  );
}
