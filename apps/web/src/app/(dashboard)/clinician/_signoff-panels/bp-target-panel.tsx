import { signBpTargetAction } from "../clinical-signoff/bp-target-actions";
import type { BpTargetView } from "@/lib/queries/pending-bp-target-signoff";

/** The measurement contexts as the W-25 schema defines them (comment on vitals_readings.measurement_context), plus clinic readings. */
const CONTEXT_LABEL: Record<string, string> = {
  home_self: "Taken by the person at home",
  home_assisted: "Taken at home with someone helping",
  diary: "Copied from the person's own diary",
  pharmacy: "Taken at a pharmacy",
  clinic: "Taken in a clinic",
};

/**
 * Sign the blood pressure targets (D-09). Shown inline on the sign-off hub. Every number is read from the database (the version being signed
 * and today's default), so the words and the values cannot differ. The panel says plainly what changes on signature and what does not.
 */
export function BpTargetPanel({
  version,
  view,
  liveVersion,
  currentDefault,
}: {
  version: number | null;
  view: BpTargetView | null;
  liveVersion: number | null;
  currentDefault: { systolic: number; diastolic: number } | null;
}) {
  if (version === null) return null;
  const btn = "min-h-11 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:opacity-50";
  const before = currentDefault ? `${currentDefault.systolic}/${currentDefault.diastolic}` : "the current default";
  return (
    <form action={signBpTargetAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Blood pressure targets, version {version}</h3>
      {view ? (
        <div className="space-y-3 text-sm text-charcoal-ink">
          <p className="rounded-md bg-amber-50 px-3 py-2 text-charcoal-ink/90">
            Proposed values. Home {view.home.systolic}/{view.home.diastolic} and clinic {view.clinic.systolic}/{view.clinic.diastolic} come from the plan
            and the home programme bands. Nothing here is in force until you sign{liveVersion !== null ? `, and version ${liveVersion} stays in force until then` : ""}.
          </p>
          <table className="w-full text-left">
            <caption className="text-left font-medium">Targets</caption>
            <tbody>
              <tr className="border-t border-charcoal-ink/10">
                <th scope="row" className="py-1 pr-3 font-normal">A home average is on target when it is below</th>
                <td className="py-1 font-medium">{view.home.systolic}/{view.home.diastolic} mmHg</td>
              </tr>
              <tr className="border-t border-charcoal-ink/10">
                <th scope="row" className="py-1 pr-3 font-normal">A clinic reading is on target when it is below</th>
                <td className="py-1 font-medium">{view.clinic.systolic}/{view.clinic.diastolic} mmHg</td>
              </tr>
              <tr className="border-t border-charcoal-ink/10">
                <th scope="row" className="py-1 pr-3 font-normal">Readings needed before anyone is judged</th>
                <td className="py-1">{view.minReadingsPerPerson}</td>
              </tr>
            </tbody>
          </table>
          <div>
            <p className="font-medium">Which target each kind of reading is judged against</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              {view.contexts.map((c) => (
                <li key={c.context}>{CONTEXT_LABEL[c.context] ?? c.context}: the {c.target} target</li>
              ))}
            </ul>
          </div>
          <div>
            <p className="font-medium">What changes when you sign</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              <li>
                A patient with no personal target set by a doctor has their monthly home average judged against {view.home.systolic}/{view.home.diastolic} instead
                of {before}. This is the patient&apos;s own monthly report and the monthly summary a family member in their Care Circle sees.
              </li>
              <li>A personal target a doctor has set for a patient still wins.</li>
              <li>Internal outcome counts start showing how many people are on target.</li>
            </ul>
          </div>
          <div>
            <p className="font-medium">What does not change</p>
            <ul className="list-disc space-y-1 pl-5 text-charcoal-ink/80">
              <li>Risk scores and the Membership offer keep their current baseline. Moving them is a separate decision.</li>
              <li>A family member sees &quot;on target&quot; and &quot;better or worse than last month&quot; only after an admin also switches on the sponsor outcome lines.</li>
              <li>No alert, triage rule or medicine is changed.</li>
              <li>The monthly average still includes readings taken at a pharmacy and unlabelled readings. Judging them against the home line is the stricter reading.</li>
            </ul>
          </div>
        </div>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The values in this version could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1 h-5 w-5" required disabled={!view} />
        <span>I have read both targets, the readings needed and which target applies to each kind of reading, and I sign blood pressure targets version {version}.</span>
      </label>
      <button type="submit" className={btn} disabled={!view}>Sign blood pressure targets version {version}</button>
    </form>
  );
}
