import { signCapacityConfigAction, signLeadConfigAction } from "../clinical-signoff/capacity-config-actions";

/**
 * Sign the capacity and cover configuration and the pilot lead cap (S16-S20 Stage 5). Shown inline on the sign-off hub. Each version is a
 * draft that does nothing until signed here; signing one switches it on and retires the one in force (which stays on record).
 */
export function CapacityConfigPanel({ capacityVersion, leadVersion }: { capacityVersion: number | null; leadVersion: number | null }) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <div className="space-y-6">
      {capacityVersion !== null && (
        <form action={signCapacityConfigAction} className="space-y-3">
          <input type="hidden" name="version" value={capacityVersion} />
          <h3 className="font-medium text-charcoal-ink">Capacity, rest and fire drills, version {capacityVersion}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>New care pack sales and new enrolments stop by themselves when fewer than 3 places are free with lead clinicians, when any hour of the next 72 has no primary and backup on call, or when urgent clinical work has waited past its limit. Patients already enrolled, urgent pages and work already taken are never affected. You can override with a written reason, for a few hours.</li>
            <li>After a shift with overnight pages nobody can be put on call or declare queue time until they have had 11 hours of rest. Only you can override, with a written reason.</li>
            <li>After 2 or more overnight pages in a shift, the next shift is offered for cover and the clinician is asked to confirm they are fit to work.</li>
            <li>Each on-call clinician gets one unannounced test page a month during the day. The target is 90 percent acknowledged within 5 minutes. Results are for information only: they are never used for pay or removal.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I sign capacity configuration version {capacityVersion} for use. It replaces the version in force, which stays on record. Signing is refused until the on-call cover guard is switched on (it needs a rota covering the next 7 days); otherwise every new care pack sale would be refused.</span>
          </label>
          <button type="submit" className={btn}>Sign capacity configuration version {capacityVersion}</button>
        </form>
      )}
      {leadVersion !== null && (
        <form action={signLeadConfigAction} className="space-y-3">
          <input type="hidden" name="version" value={leadVersion} />
          <h3 className="font-medium text-charcoal-ink">Pilot lead cap, lead configuration version {leadVersion}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>Each lead clinician takes at most 40 patients for the pilot (the cap in force is 60). 40 is a cautious starting guess, not a proven figure. A clinician with their own cap on file keeps it.</li>
            <li>Patients already assigned stay with their lead even if that lead is then over the new cap; only new assignments follow it. The nightly check raises an incident for any lead who is over the cap so you can decide what to do.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I sign lead configuration version {leadVersion} for use.</span>
          </label>
          <button type="submit" className={btn}>Sign lead configuration version {leadVersion}</button>
        </form>
      )}
    </div>
  );
}
