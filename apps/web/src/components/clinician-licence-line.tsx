"use client";

import { t, type Locale } from "@tarragon/i18n";
import { formatPatientDate } from "@/lib/format-date";
import { useClinicianLicence } from "@/lib/queries/directory";

/**
 * The regulator number and the day it was checked, for a clinician shown in a directory or booking screen (S65, CMO Q19).
 * Null-gated like `ReviewedByDoctor`: when no checked licence exists this renders NOTHING, never a placeholder and never a hardcoded number.
 */
export function ClinicianLicenceLine({ profileId, locale }: { profileId: string | null | undefined; locale: Locale }) {
  const q = useClinicianLicence(profileId);
  const l = q.data;
  if (!l) return null;
  return (
    <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
      {t("licence.line", locale, { type: l.credential_type, number: l.credential_number, date: formatPatientDate(l.checked_on) })}
    </p>
  );
}
