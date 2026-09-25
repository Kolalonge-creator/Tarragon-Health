/**
 * Prefixes "Dr." only when the stored name doesn't already begin with a
 * title — clinical_staff.full_name is free text, and "Dr. Dr. Adaeze" would
 * read as sloppy exactly where trust matters most. Every patient-facing
 * doctor mention on mobile goes through this one helper (mirrors web's
 * DoctorNameLink, PR #788) rather than inline template-string
 * interpolation, so a new call site can't reintroduce an unguarded
 * "Dr. {name}" independently.
 */
export function formatDoctorName(name: string): string {
  return /^(dr|prof|professor)\.?\s/i.test(name) ? name : `Dr. ${name}`;
}
