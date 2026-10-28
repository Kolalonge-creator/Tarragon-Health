import { signAdjustmentConfigAction, signReliableChangeConfigAction } from "../clinical-signoff/outcome-definitions-actions";
import type { AdjustmentView, ReliableChangeView } from "@/lib/queries/pending-outcome-definitions-signoff";

const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";

/**
 * Sign the reliable change definition for the PHQ-9 and GAD-7 (D4). Inline on the sign-off hub. Every number is read from the draft being signed, so the
 * words and the values cannot differ. Until signed, no reliable change figure is shown anywhere.
 */
export function ReliableChangeConfigPanel({ version, view }: { version: number | null; view: ReliableChangeView | null }) {
  if (version === null) return null;
  return (
    <form action={signReliableChangeConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Reliable change for the PHQ-9 and GAD-7, version {version}</h3>
      {view ? (
        <div className="space-y-1 text-sm text-charcoal-ink/80">
          <p>A change in the total score of <span className="font-medium">{view.phq9Points} points</span> on the PHQ-9 and <span className="font-medium">{view.gad7Points} points</span> on the GAD-7, up or down, is counted as a reliable change.</p>
          <p>{view.source}</p>
          <p>{view.note}</p>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The definition in this draft could not be read, so it is not shown here. Do not sign until it can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!view} />
        <span>I have read the points and where they come from, and I sign reliable change version {version}. Nothing is counted until I do.</span>
      </label>
      <button type="submit" className={btn} disabled={!view}>Sign reliable change version {version}</button>
    </form>
  );
}

/** Sign what counts as a doctor adjusting a hypertension medicine (D3). Inline on the sign-off hub. */
export function AdjustmentConfigPanel({ version, view }: { version: number | null; view: AdjustmentView | null }) {
  if (version === null) return null;
  return (
    <form action={signAdjustmentConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">What counts as a doctor adjusting a blood pressure medicine, version {version}</h3>
      {view ? (
        <div className="space-y-1 text-sm text-charcoal-ink/80">
          <p>The window is the <span className="font-medium">{view.windowDays} days</span> up to the day of the figures. A person counts as adjusted when any of these is true:</p>
          <ul className="list-disc pl-5">{view.signals.map((s) => <li key={s}>{s}</li>)}</ul>
          <p className="font-medium">The two groups</p>
          <ul className="list-disc pl-5">{view.groups.map((g) => <li key={g}>{g}</li>)}</ul>
          <p>{view.limitations}</p>
          <p>{view.note}</p>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The definition in this draft could not be read, so it is not shown here. Do not sign until it can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!view} />
        <span>I have read the window and what counts, and I sign adjustment version {version}. Nothing is counted until I do.</span>
      </label>
      <button type="submit" className={btn} disabled={!view}>Sign adjustment version {version}</button>
    </form>
  );
}
