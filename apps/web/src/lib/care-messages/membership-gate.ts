import type { CareMessageCategory } from "@/lib/validation/care-messages";

/** Categories that open a clinical conversation, which is a Membership benefit (MSG-1). Must match
 * private.care_thread_member_clinical_gate() in 20261105092316_msg1_free_members_no_clinical_threads.sql. */
export const MEMBER_ONLY_CATEGORIES: readonly CareMessageCategory[] = ["clinical", "medication"];

export function isMemberOnlyCategory(category: CareMessageCategory): boolean {
  return MEMBER_ONLY_CATEGORIES.includes(category);
}

/** True when start_care_thread refused because the patient is not a Member. The database raises with hint
 * 'membership_required'; PostgREST passes the hint through on the error object. */
export function isMembershipRequiredError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "hint" in error &&
    (error as { hint?: unknown }).hint === "membership_required"
  );
}
