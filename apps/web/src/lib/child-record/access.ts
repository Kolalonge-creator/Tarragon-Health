/**
 * Who may print a child's record (S68b review fix). Every read behind the PDF is filtered by RLS, and an RLS-filtered read looks exactly like an
 * empty one: a second caregiver without the growth or vaccine categories would otherwise get a page saying "no measurements" and every dose
 * overdue, printed as fact. So the route decides access FIRST, from the caller's own visible grant, and refuses calmly when the caller cannot see
 * both parts of the record. Mirrors the access shape of private.can_read_clinical for the two categories the PDF uses; the database stays the
 * authority for every row.
 */
export interface ChildGrant {
  permissionLevel: "view" | "manage";
  categories: readonly string[];
  /** The child's profile is a minor_child dependent and is under 18. */
  childIsMinorDependant: boolean;
}

export const EXPORT_CATEGORIES = ["medical_history", "vaccinations"] as const;

export function mayPrintChildRecord(userId: string, childId: string, grant: ChildGrant | null): boolean {
  if (userId === childId) return true;
  if (!grant) return false;
  // A manage grant over a minor stands in for the child (every category). It does not once the child is 18 or more.
  if (grant.permissionLevel === "manage" && grant.childIsMinorDependant) return true;
  return EXPORT_CATEGORIES.every((c) => grant.categories.includes(c));
}
