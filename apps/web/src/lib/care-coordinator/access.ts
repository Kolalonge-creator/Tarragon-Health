/**
 * CC-1 (2026-11-07): who may use the care coordination workspace. Mirrors private.is_coordination_actor in the database, which is the
 * real gate on every action; this copy only decides what the app shows and where it routes.
 *
 *  - a Care Coordinator account;
 *  - a doctor (account role `clinician`) with an active clinical_staff row who is the Chief Medical Officer, or a Senior Medical
 *    Officer employed by Tarragon. A contracted partner specialist is not part of the day-to-day care team and does not do logistics.
 */
export type CoordinationStaff = {
  doctor_tier: string | null;
  employment_type: string | null;
  /** Optional: not in the generated types. The database checks it (private.is_coordination_actor); when given it must be 'active'. */
  status?: string | null;
  active: boolean | null;
};

export function canCoordinate(role: string | null | undefined, staff: CoordinationStaff | null | undefined): boolean {
  if (role === "care_coordinator") return true;
  if (role !== "clinician" || !staff || staff.active !== true) return false;
  if (staff.status !== undefined && staff.status !== "active") return false;
  if (staff.doctor_tier === "chief_medical_officer") return true;
  return staff.doctor_tier === "senior_medical_officer" && staff.employment_type === "employed";
}

const TITLES = new Set(["dr", "dr.", "doctor", "prof", "prof.", "professor", "mr", "mr.", "mrs", "mrs.", "ms", "ms.", "miss", "nurse"]);

/** The first name for "Good morning, Amaka": skips a title such as "Dr" so a doctor is not greeted as "Dr". */
export function greetingFirstName(fullName: string | null | undefined): string | null {
  const words = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  const name = words.find((w) => !TITLES.has(w.toLowerCase()));
  return name ?? null;
}

/** A doctor using the workspace is covering coordination; the copy says so instead of calling them a coordinator. */
export function isCoveringDoctor(role: string | null | undefined): boolean {
  return role === "clinician";
}
