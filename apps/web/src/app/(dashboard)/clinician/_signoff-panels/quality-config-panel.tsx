import { signCredentialingConfigAction, signQualityConfigAction } from "../clinical-signoff/quality-config-actions";

/**
 * Sign the S20 v2 quality and credentialing configurations. Shown inline on the sign-off hub. Each version is a draft that does nothing until
 * signed here; signing one switches it on and retires the one in force (which stays on record). Neither is signed by anything else.
 */
export function QualityConfigPanel({ qualityVersion, credentialingVersion }: { qualityVersion: number | null; credentialingVersion: number | null }) {
  const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green";
  return (
    <div className="space-y-6">
      {qualityVersion !== null && (
        <form action={signQualityConfigAction} className="space-y-3">
          <input type="hidden" name="version" value={qualityVersion} />
          <h3 className="font-medium text-charcoal-ink">Clinical audits and speak-up, version {qualityVersion}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>The audit draw uses a secret monthly seed, so nobody can predict which tasks are chosen. Every clinician still gets the monthly floor, with a catch-up later in the month.</li>
            <li>Notes drafted by the AI scribe are sampled at 20 percent and scored separately for anything left out and anything invented.</li>
            <li>A critical miss needs a second, independent reviewer before the audit is final. The audit form adds comments by phase and an avoidability rating.</li>
            <li>People who raised a concern get a neutral check-in at 30 and 90 days. Concerns by or about the clinical lead go only to an independent reader.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I sign quality configuration version {qualityVersion} for use. It replaces the version in force, which stays on record.</span>
          </label>
          <button type="submit" className={btn}>Sign quality configuration version {qualityVersion}</button>
        </form>
      )}
      {credentialingVersion !== null && (
        <form action={signCredentialingConfigAction} className="space-y-3">
          <input type="hidden" name="version" value={credentialingVersion} />
          <h3 className="font-medium text-charcoal-ink">Licences and cover, version {credentialingVersion}</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
            <li>Licence and indemnity notices go out at 90, 30, 7 and 0 days. The proof-of-renewal deadline is 15 December for the 31 December cycle.</li>
            <li>A licence with no date recorded stops counting as eligible. This will be refused until every active clinician has a licence date on file.</li>
            <li>Nobody is scheduled for a shift that starts after their licence or indemnity ends. A grace period stays 1 to 14 days and only you can grant it.</li>
          </ul>
          <label className="flex items-start gap-2 text-sm text-charcoal-ink">
            <input type="checkbox" name="understood" className="mt-1" required />
            <span>I have read this and I sign credentialing configuration version {credentialingVersion} for use.</span>
          </label>
          <button type="submit" className={btn}>Sign credentialing configuration version {credentialingVersion}</button>
        </form>
      )}
    </div>
  );
}
