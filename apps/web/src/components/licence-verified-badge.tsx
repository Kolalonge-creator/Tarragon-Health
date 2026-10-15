import { formatLicenceVerifiedDate } from "@/lib/clinical/licence-verified";

/**
 * The single shared "Licence verified on <date>" line (CMO answer Q17), null-gated like ReviewedByDoctor: it renders nothing unless
 * it is given a verification date that comes from a stored record. It is deliberately a dumb component: callers pass the date the
 * database returned (LicenceVerifiedFor / LicenceVerifiedForClient fetch it), and there is no way to give it text, a number or a
 * "verified" flag. It never shows the folio number, and it never claims more than a date.
 */
export function LicenceVerifiedBadge({ verifiedOn, className }: { verifiedOn: string | null | undefined; className?: string }) {
  if (!verifiedOn || !/^\d{4}-\d{2}-\d{2}$/.test(verifiedOn)) return null;
  const date = formatLicenceVerifiedDate(verifiedOn);
  if (date === "Invalid Date") return null;
  return (
    <span
      className={className ?? "inline-flex items-center rounded-full bg-brand-green/10 px-2 py-0.5 text-xs font-medium text-brand-green dark:bg-brand-green/20"}
      title="We checked this doctor's registration with the Medical and Dental Council of Nigeria."
    >
      Licence verified on {date}
    </span>
  );
}
