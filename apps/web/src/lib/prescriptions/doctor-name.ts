/**
 * A doctor's name without a leading title. Staff names are typed by hand and often already carry one ("Dr Isaac Longe"),
 * and every place that prints a prescriber adds "Dr." itself, which would otherwise read "Dr. Dr Isaac Longe".
 */
export function stripDoctorTitle(name: string): string {
  return name.trim().replace(/^(?:dr|doctor)\.?\s+/i, "").replace(/\s+/g, " ").trim();
}
