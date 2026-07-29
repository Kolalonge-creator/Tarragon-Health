import { HealthPassportDocument } from "@/lib/health-passport/health-passport-document";
import type { HealthPassportData } from "@/lib/health-passport/get-health-passport-data";

/**
 * Thin wrapper over HealthPassportDocument — same PDF layout and data
 * shape, just the "Quarterly Health Report" title so it reads as its own
 * named artifact rather than a re-skinned Health
 * Passport.
 */
export function QuarterlyReportDocument({
  patientName,
  data,
}: {
  patientName: string;
  data: HealthPassportData;
}) {
  return HealthPassportDocument({ patientName, data, documentTitle: "Quarterly Family Report" });
}
