import { signAiMonitoringConfigAction } from "../clinical-signoff/ai-monitoring-actions";
import type { AiMonitoringRulesView } from "@/lib/queries/pending-ai-monitoring-signoff";

/**
 * Sign the AI monitoring rules. Shown inline on the sign-off hub. Every number is read from the draft being signed. Until signed, no monthly AI
 * review sample is drawn. Signing does not load any model price (finance enters those) and does not turn any assistant on.
 */
export function AiMonitoringPanel({ version, rules }: { version: number | null; rules: AiMonitoringRulesView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signAiMonitoringConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">AI monitoring rules, version {version}</h3>
      {rules ? (
        <div className="space-y-1 text-sm text-charcoal-ink">
          <p>Each month, on the 1st, the system draws last month&apos;s sample of assistant answers for a doctor to check.</p>
          <p className="font-medium">Always drawn</p>
          <ul className="list-disc pl-5 text-charcoal-ink/80">{rules.alwaysSampled.map((g) => <li key={g}>{g}</li>)}</ul>
          <p>An &quot;unusually large call&quot; is one of at least {rules.costSpikeMinTokens.toLocaleString("en-NG")} tokens that is more than {rules.costSpikeFactor} times the middle call for that assistant that month.</p>
          <p>On top of that, {rules.sampleRatePercent} percent of the remaining answers are drawn at random, for each assistant and grade. Test accounts are never drawn.</p>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The rules in this draft could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>I have read the groups that are always drawn and the random share, and I sign AI monitoring rules version {version}. Nothing is drawn each month until I do.</span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>Sign AI monitoring rules version {version}</button>
    </form>
  );
}
