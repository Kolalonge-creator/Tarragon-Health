/**
 * Whose reminder is this? (OQ-70) A notification whose doses all belong to ONE dependant names that person by first name; any mix, or
 * the device owner's own doses, keeps the plain generic wording. The first name only tells people apart: no medicine, dose or
 * condition is ever in the text (INV-07). Slot keys start with the medicine id.
 */
export function ownerOfNotification(slotKeys: readonly string[], dependantOfMedicine: ReadonlyMap<string, string>): string | null {
  let owner: string | null = null;
  for (const key of slotKeys) {
    const medId = key.split("|")[0] ?? "";
    const dep = dependantOfMedicine.get(medId) ?? null;
    if (dep === null) return null;
    if (owner === null) owner = dep;
    else if (owner !== dep) return null;
  }
  return owner;
}
