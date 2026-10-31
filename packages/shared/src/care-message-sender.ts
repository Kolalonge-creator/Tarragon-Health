import type { DoctorTier } from "./clinical-tier";

/** The least a message needs to say who replied: the staff directory's own display name and tier. */
export type CareMessageSenderInput = {
  full_name: string | null;
  doctor_tier: DoctorTier | null;
} | null;

export type CareMessageSender = {
  /** The sender's real name, or null when the record carries none. */
  name: string | null;
  /** A plain role word, or null when the tier is unknown. */
  role: string | null;
};

const TEAM_LABEL = "Care team";

/**
 * Per-message attribution for a care-team reply. Server-derived data only:
 * the name and tier come from the message's actor_clinical_staff_id via
 * clinical_staff_directory, never from a hardcoded string. Null-gated: with no
 * actor (or no name) the sender is just "Care team" and no role is claimed.
 * This names the person who wrote THIS message; it never implies one
 * continuous named doctor across a thread.
 */
export function careMessageSender(actor: CareMessageSenderInput): CareMessageSender {
  const name = actor?.full_name?.trim() || null;
  if (!name) return { name: null, role: null };
  switch (actor?.doctor_tier) {
    case "care_coordinator":
      return { name, role: "Care coordinator" };
    case "chief_medical_officer":
      return { name, role: "Chief Medical Officer" };
    case "senior_medical_officer":
      return { name, role: "Doctor" };
    default:
      return { name, role: null };
  }
}

/** One-line text for places that cannot lay out a name and a role separately. */
export function careMessageSenderLine(actor: CareMessageSenderInput): string {
  const { name, role } = careMessageSender(actor);
  if (!name) return TEAM_LABEL;
  return role ? `${name}, ${role}` : name;
}
