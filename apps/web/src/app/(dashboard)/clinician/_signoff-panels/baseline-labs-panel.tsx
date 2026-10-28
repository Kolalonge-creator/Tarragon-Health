import { signBaselineLabsConfigAction } from "../clinical-signoff/baseline-labs-actions";
import type { BaselineRulesView } from "@/lib/clinical/baseline-labs-view";

/**
 * Sign the baseline labs prescribing rule. Shown inline on the sign-off hub. Every row and number is read from the draft being signed, so the words
 * and the values cannot differ. Until signed, the prescribing check adds nothing.
 */
export function BaselineLabsPanel({ version, rules }: { version: number | null; rules: BaselineRulesView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signBaselineLabsConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Baseline labs before blood pressure or glucose medicines, version {version}</h3>
      {rules ? (
        <>
          <table className="w-full text-left text-sm text-charcoal-ink">
            <thead><tr><th className="py-1 pr-3 font-medium">Medicine</th><th className="py-1 font-medium">Results needed in the record</th></tr></thead>
            <tbody>
              {rules.classes.map((c) => (
                <tr key={c.label} className="border-t border-charcoal-ink/10"><td className="py-1 pr-3">{c.label}</td><td className="py-1">{c.tests}</td></tr>
              ))}
            </tbody>
          </table>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            {rules.thresholds.map((t) => <li key={t}>{t}</li>)}
            {rules.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        </>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The rule in this draft could not be read, so it is not shown here. Do not sign until it can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>I have read the table and the thresholds, and I sign baseline labs rule version {version}. The prescribing check starts to apply when I do.</span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>Sign baseline labs rule version {version}</button>
    </form>
  );
}
