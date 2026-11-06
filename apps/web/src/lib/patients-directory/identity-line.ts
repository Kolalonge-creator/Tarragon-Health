import { calendarAgeInYears } from "@tarragon/shared";
import { formatPatientDate } from "@/lib/format-date";

/** "DOB 3 Sept 1970 (55), female": date of birth with calendar age, and sex, each only when known. Built on the server. */
export function identityLine(dateOfBirth: string | null, sex: "male" | "female" | null, now: Date): string | null {
  const age = calendarAgeInYears(dateOfBirth, now);
  const dob = dateOfBirth && age !== null ? `DOB ${formatPatientDate(dateOfBirth)} (${age})` : null;
  const parts = [dob, sex].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(", ") : null;
}
