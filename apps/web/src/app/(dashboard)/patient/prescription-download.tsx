import { formatPatientDate } from "@/lib/format-date";

/**
 * The patient's side of a clinician prescription: the identifiers a pharmacist asks for, and the PDF to take
 * to one (docs/PRESCRIPTION_PDF_SCOPE.md). The Rx number and verification code are shown here in clear text
 * because until this card existed no screen showed the code to anyone.
 *
 * Shown only for a clinician-prescribed, current prescription. The route enforces the same rules (and refuses
 * a superseded, stopped or expired one), so this never offers a button that would only fail for those cases.
 * The "not a controlled medicine" line is the founder's wording (2026-10-01): TarragonHealth does not
 * prescribe controlled medicines, and patients should be told.
 */
export function PrescriptionDownload({
  medicationId,
  rxNumber,
  verificationCode,
  expiresAt,
}: {
  medicationId: string;
  rxNumber: string | null;
  verificationCode: string | null;
  expiresAt: string | null;
}) {
  if (!rxNumber || !verificationCode) return null;
  const expired = !!expiresAt && new Date(expiresAt).getTime() < new Date().getTime();
  const href = `/api/patient/prescriptions/${medicationId}/pdf`;

  return (
    <div className="mt-2 rounded-md border border-charcoal-ink/10 dark:border-night-ink/15 p-3 text-xs space-y-2">
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        <span>
          <span className="text-charcoal-ink/50 dark:text-night-ink/55">Rx number </span>
          <span className="font-medium tabular-nums">{rxNumber}</span>
        </span>
        <span>
          <span className="text-charcoal-ink/50 dark:text-night-ink/55">Verification code </span>
          <span className="font-medium tracking-wider tabular-nums">{verificationCode}</span>
        </span>
        {expiresAt && (
          <span className={expired ? "text-red-700 dark:text-red-300" : "text-charcoal-ink/70 dark:text-night-ink/70"}>
            {expired ? "Expired" : "Valid until"} {formatPatientDate(expiresAt)}
          </span>
        )}
      </div>
      {expired ? (
        <p className="text-charcoal-ink/60 dark:text-night-ink/60">
          This prescription has expired. Use “Request renewal” to ask your care team for a new one.
        </p>
      ) : (
        <p>
          <a
            href={href}
            className="inline-flex items-center rounded-md border border-brand-green px-3 py-1.5 font-medium text-brand-green hover:bg-brand-green/5 dark:text-brand-green-bright dark:border-brand-green-bright"
          >
            Download prescription (PDF)
          </a>
        </p>
      )}
      <p className="text-charcoal-ink/50 dark:text-night-ink/55">
        Take this to any pharmacy. This is not a controlled medicine: TarragonHealth does not prescribe controlled
        medicines. A pharmacy can check the Rx number and code with us before dispensing.
      </p>
    </div>
  );
}
