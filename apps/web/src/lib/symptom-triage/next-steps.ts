import type { TriageCategory, UrgencyLevel } from "@tarragon/symptom-triage-engine";

/**
 * The next-step hand-off after a symptom check (spec 12.5). Pure: which doors to open for a result.
 *
 * Rules that are not negotiable:
 *   - An emergency offers emergency guidance and nothing else: no booking, no summary, nothing that could delay going now.
 *   - Consultations are for adults (OQ-129), so a check answered for a child never offers a booking or a summary to attach to one.
 *   - Every door is an existing route (the seams): booking, learning content (S55), labs and the lab directory, the care team message
 *     thread. Nothing here creates anything; sending a summary is the patient's own explicit click, handled elsewhere.
 */
export type NextStepKind =
  | "emergency_guidance"
  | "self_care_content"
  | "pharmacist"
  | "book_consultation"
  | "send_summary"
  | "message_care_team"
  | "lab_or_home_test"
  | "nearest_clinic";

export interface NextStep {
  kind: NextStepKind;
  href: string | null;
}

export interface NextStepInput {
  category: TriageCategory;
  urgencyLevel: UrgencyLevel | null;
  forDependant: boolean;
  complaintKey: string;
  /** The assessment id when it was recorded; summaries need a recorded check. */
  assessmentId: string | null;
}

export function nextSteps(input: NextStepInput): NextStep[] {
  if (input.category === "emergency") return [{ kind: "emergency_guidance", href: null }];
  const steps: NextStep[] = [];
  const adult = !input.forDependant;
  if (input.category === "self_management") {
    steps.push({ kind: "self_care_content", href: `/patient/learn?topic=${encodeURIComponent(input.complaintKey)}` });
    if (input.urgencyLevel === "see_pharmacist") steps.push({ kind: "pharmacist", href: null });
    steps.push({ kind: "message_care_team", href: "/patient/messages" });
    return steps;
  }
  // routine and urgent
  if (adult) steps.push({ kind: "book_consultation", href: "/patient/appointments" });
  if (adult && input.assessmentId) steps.push({ kind: "send_summary", href: null });
  steps.push({ kind: "message_care_team", href: "/patient/messages" });
  steps.push({ kind: "lab_or_home_test", href: "/patient/labs" });
  steps.push({ kind: "nearest_clinic", href: "/patient/labs#locations" });
  return steps;
}

/**
 * What the headline shows. The four-category result is always shown. The six-level wording is shown ONLY when a signed urgency map
 * produced a level; an unsigned or invalid map yields null and the screen falls back to the four-category result alone.
 */
export function headline(category: TriageCategory, urgencyLevel: UrgencyLevel | null): { kind: "level"; level: UrgencyLevel } | { kind: "category"; category: TriageCategory } {
  return urgencyLevel ? { kind: "level", level: urgencyLevel } : { kind: "category", category };
}
