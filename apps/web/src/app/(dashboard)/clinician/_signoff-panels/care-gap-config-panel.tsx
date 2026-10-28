import { signCareGapConfigAction } from "../clinical-signoff/care-gap-config-actions";
import type { CareGapRulesView } from "@/lib/queries/pending-care-gap-config-signoff";

/**
 * Sign the care gap rule configuration. Shown inline on the sign-off hub. Every line is read from the draft being signed, so the words and the values
 * cannot differ. A rule with a number the CMO has not supplied is shown as inert. Until signed the engine runs in shadow mode at most (staff see
 * gaps, nobody is contacted); signing does not switch the engine on.
 */
export function CareGapConfigPanel({ version, rules }: { version: number | null; rules: CareGapRulesView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signCareGapConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Care gap rules, version {version}</h3>
      {rules ? (
        <>
          {rules.verifyAgainstSource && (
            <p className="text-sm text-charcoal-ink/80">
              The hypertension lines come from decision pack item 4.2 and carry &quot;verify against source&quot;: confirm the guideline text was opened before you sign.
            </p>
          )}
          <ol className="list-decimal space-y-2 pl-5 text-sm text-charcoal-ink">
            {rules.rules.map((r) => (
              <li key={r.code}>
                <span className="font-medium">{r.title}</span> ({r.owner === "doctor" ? "a doctor reviews it, no message to the patient" : "a coordinator follows it up"}
                {r.enabled ? "" : ", switched off in this draft"}).
                <ul className="list-disc pl-5 text-charcoal-ink/80">
                  {r.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                  {r.notSupplied.map((field) => (
                    <li key={field} className="font-medium text-amber-800">
                      Not supplied: {field.replace(/_/g, " ")}. This rule does nothing until a later version supplies it.
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-charcoal-ink/60">Basis: {r.source}</p>
              </li>
            ))}
          </ol>
          <p className="font-medium text-sm text-charcoal-ink">Outreach to the patient</p>
          <ul className="list-disc pl-5 text-sm text-charcoal-ink/80">
            {rules.ladder.map((line) => (
              <li key={line}>{line}</li>
            ))}
            <li>The wording names no condition, reading, result or medicine.</li>
            <li>{rules.experiments}</li>
          </ul>
        </>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The rules in this draft could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>
          I have read the rules, the lines and the numbers still to be supplied, and I sign care gap rules version {version}. Signing does not switch the engine on; an admin does that
          separately.
        </span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>
        Sign care gap rules version {version}
      </button>
    </form>
  );
}
