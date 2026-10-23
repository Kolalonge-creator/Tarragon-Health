import { signCascadeConfigAction } from "../clinical-signoff/cascade-config-actions";
import type { CascadeRulesView } from "@/lib/queries/pending-cascade-config-signoff";

function Condition({ name, c }: { name: string; c: CascadeRulesView["hypertension"] }) {
  return (
    <div className="space-y-1 text-sm text-charcoal-ink">
      <p className="font-medium">{name}: controlled means {c.controlled}</p>
      <ol className="list-decimal space-y-1 pl-5 text-charcoal-ink/80">
        {c.stages.map((s) => (
          <li key={s.label}><span className="font-medium">{s.label}.</span> {s.definition}</li>
        ))}
      </ol>
      <p className="font-medium">Shown as not available</p>
      <ul className="list-disc pl-5 text-charcoal-ink/80">
        {c.notAvailable.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}

/**
 * Sign the cascade-of-care definitions. Shown inline on the sign-off hub. Every definition and number is read from the draft being signed, so
 * the words and the values cannot differ. Until signed, no cascade figure is shown on screen, in a file or in a sponsor pack.
 */
export function CascadeConfigPanel({ version, rules }: { version: number | null; rules: CascadeRulesView | null }) {
  if (version === null) return null;
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <form action={signCascadeConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Cascade of care definitions, version {version}</h3>
      {rules ? (
        <>
          <Condition name="Hypertension" c={rules.hypertension} />
          <Condition name="Diabetes" c={rules.diabetes} />
          <p className="text-sm text-charcoal-ink/80">{rules.differenceFromBpReports}</p>
          <p className="text-sm text-charcoal-ink/80">Fixed note on the selection panel: {rules.panelNote}</p>
        </>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The definitions in this draft could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>I have read the stage definitions, the control lines and what is shown as not available, and I sign cascade definitions version {version}. Nothing is counted anywhere until I do.</span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>Sign cascade definitions version {version}</button>
    </form>
  );
}
