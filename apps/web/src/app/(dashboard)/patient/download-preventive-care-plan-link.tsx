import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * The take-anywhere download for the combined screening + vaccination + AHC
 * plan (see generate-preventive-care-plan-pdf.ts). Sits above the
 * screening/vaccination cards rather than inside either one, since it covers
 * both plus the Annual Health Check, which neither card shows.
 *
 * `patientId` is passed through unchanged to the download URL as
 * `?patientId=`, defaulting server-side to the caller's own id — see
 * api/patient/preventive-care-plan/route.ts. Passing it explicitly here
 * (rather than relying on that default) is what lets a parent download the
 * plan for whichever dependent's record they are currently viewing.
 */
export function DownloadPreventiveCarePlanLink({
  patientId,
}: {
  patientId: string;
}) {
  return (
    <a
      href={`/api/patient/preventive-care-plan?patientId=${patientId}`}
      className="flex items-center gap-2 rounded-lg border border-brand-green/30 dark:border-brand-green-bright/30 bg-brand-green/5 dark:bg-brand-green-bright/10 px-3 py-2 text-xs font-medium text-brand-green dark:text-brand-green-bright hover:bg-brand-green/10 dark:hover:bg-brand-green-bright/15"
    >
      <SEMANTIC_ICON.preventive
        className="h-4 w-4 shrink-0"
        strokeWidth={2}
        aria-hidden
      />
      Download your preventive &amp; chronic care plan (PDF)
    </a>
  );
}
