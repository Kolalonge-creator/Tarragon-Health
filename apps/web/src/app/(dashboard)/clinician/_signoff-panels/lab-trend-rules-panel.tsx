import { signLabTrendRulesAction } from "../clinical-signoff/lab-trend-rules-actions";
import type { LabTrendRuleView, PendingLabTrendRulesSignoff } from "@/lib/queries/pending-lab-trend-rules-signoff";

const ANALYTE_LABEL: Record<string, string> = {
  hba1c: "HbA1c",
  fasting_glucose: "Fasting glucose",
  creatinine: "Creatinine",
  ldl_cholesterol: "LDL cholesterol",
  haemoglobin: "Haemoglobin",
  potassium: "Potassium",
};
const label = (code: string) => ANALYTE_LABEL[code] ?? code;

function changeText(r: LabTrendRuleView): string {
  const amount = r.change.kind === "rise_pct" ? `${r.change.amount}%` : `${r.change.amount} ${r.unit}`;
  const verb = r.change.kind === "fall" ? "falls by" : "rises by";
  return `${verb} ${amount} or more from the first result to the latest${r.latestAtLeast !== null ? `, and the latest is ${r.latestAtLeast} ${r.unit} or higher` : ""}`;
}

function waitText(minutes: number | null): string {
  if (minutes === null) return "no review window (the active escalation SLAs have none for this pathway, so the database will refuse to sign)";
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

/**
 * Sign the lab trend rules (T2 Phase 2). Shown inline on the sign-off hub. Every value is read from the version being signed, and the
 * review window from the active escalation SLAs, so the words and the values cannot differ.
 */
export function LabTrendRulesPanel({ pending }: { pending: PendingLabTrendRulesSignoff }) {
  const { version, view, problem, slaMinutes, liveVersion, lastRun } = pending;
  if (version === null) return null;
  const btn = "min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
  const canSign = view !== null && problem === null;
  return (
    <form action={signLabTrendRulesAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Lab trend rules, version {version}: awaiting your sign-off</h3>
      {view ? (
        <div className="space-y-3 text-sm text-charcoal-ink">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-charcoal-ink/90">
            Proposed values, drafted from ADA and KDIGO guidance. Nothing here is in force until you sign
            {liveVersion !== null ? `, and version ${liveVersion} stays in force until then` : ""}. Today the nightly check runs and raises nothing.
            {lastRun ? ` Last run ${new Date(lastRun.ranAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}: ${lastRun.outcome === "awaiting_signature" ? "awaiting your signature, nothing checked" : lastRun.outcome === "failed" ? `failed (${lastRun.error ?? "no detail"})` : `${lastRun.alertsRaised} alerts raised`}.` : ""}
          </p>
          <div>
            <p className="font-medium">A trend is found when, within {view.windowMonths} months and over at least {view.minPoints} results in the same unit{view.consecutive ? ", each result moving the same way as the one before" : ""}:</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              {view.rules.map((r) => (
                <li key={r.analyte}>
                  {label(r.analyte)} {changeText(r)}.{r.note ? <span className="text-charcoal-ink/60"> ({r.note})</span> : null}
                </li>
              ))}
            </ul>
          </div>
          {view.persistent && (
            <p>
              Also found: the last {view.persistent.minPoints} results of {view.persistent.analytes.map(label).join(", ")} all outside the range the
              laboratory printed with each one.
            </p>
          )}
          <div>
            <p className="font-medium">What happens when one is found</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              <li>
                One review alert per patient per night for a doctor ({view.review.alertLevel.replace(/_/g, " ")}), due within {waitText(slaMinutes)}, the window the
                active escalation SLAs give pathway {view.review.slaPathway}, tier {view.review.slaTier.replace(/_/g, " ")}.
              </li>
              <li>The same finding on the same latest result is never raised twice; a new result that continues the trend raises a new alert.</li>
              <li>The alert names no diagnosis and suggests no medicine. The patient is told nothing by this check.</li>
              <li>Results in a different unit are not counted, and a value the patient has disputed is skipped.</li>
              <li>It appears on the clinical worklist as &quot;Lab trend to review&quot;.</li>
            </ul>
          </div>
          {problem && <p className="rounded-md bg-red-50 px-3 py-2 text-charcoal-ink">This version cannot be signed yet: {problem}.</p>}
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The values in this version could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1 h-5 w-5" required disabled={!canSign} />
        <span>I have read every rule, the review window and what the alert says, and I sign lab trend rules version {version}.</span>
      </label>
      <button type="submit" className={btn} disabled={!canSign}>Sign lab trend rules version {version}</button>
    </form>
  );
}
