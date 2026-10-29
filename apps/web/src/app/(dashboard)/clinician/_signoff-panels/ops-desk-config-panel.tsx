import { signOpsDeskConfigAction } from "../clinical-signoff/capacity-config-actions";

/**
 * Sign the ops desk configuration that makes the resilience checklist a condition (OQ-441). Shown inline on the sign-off hub. The draft
 * does nothing until signed here. Signing never names anyone or attests anything: it only says that the on-call cover guard cannot be switched
 * on while the checklist is out of date or no primary ops contact is active (a deputy is optional).
 */
export function OpsDeskConfigPanel({ version }: { version: number | null }) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  if (version === null) return null;
  return (
    <form action={signOpsDeskConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Ops desk checklist gate, version {version}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
        <li>The on-call cover guard cannot be switched on until each line of the ops desk checklist (backup power, a second internet link, tested contact numbers) has a recent statement by a named person that it is in place, and a primary ops contact is active with a confirmed phone number. A deputy and the deputy-cover line are optional to start.</li>
        <li>Only switching the guard on is held back. Nothing that is already on is switched off, and no red page is ever held up by this.</li>
        <li>Today the checklist is recorded and shown and gates nothing. The ops desk page is at /clinician/ops-desk.</li>
      </ul>
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required />
        <span>I have read this and I sign ops desk configuration version {version} for use. It replaces the version in force, which stays on record.</span>
      </label>
      <button type="submit" className={btn}>Sign ops desk configuration version {version}</button>
    </form>
  );
}
