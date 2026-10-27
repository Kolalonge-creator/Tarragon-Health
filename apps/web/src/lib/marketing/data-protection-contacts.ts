/**
 * Data protection contact details shown on the public privacy page (W-55).
 *
 * NDPC registration is approved and the founder's DPO appointment was accepted by the NDPC on 2026-09-15 (CLAUDE.md). The details below
 * are FOUNDER INPUT: leave a field null until the founder supplies the real value. A null field is simply not shown, so the page never
 * carries a placeholder or an invented number. Fill these in; do not guess them.
 */
export interface DataProtectionContacts {
  /** The Data Protection Officer's name, as appointed. FOUNDER INPUT. */
  dpoName: string | null;
  /** A monitored mailbox for data protection requests. FOUNDER INPUT. */
  dpoEmail: string | null;
  /** The NDPC registration reference. FOUNDER INPUT. */
  ndpcRegistrationRef: string | null;
}

export const DATA_PROTECTION_CONTACTS: DataProtectionContacts = {
  dpoName: null,
  dpoEmail: null,
  ndpcRegistrationRef: null,
};

/** The lines to show, in order. The registration statement is always true; the rest appear only once supplied. */
export function dataProtectionLines(c: DataProtectionContacts = DATA_PROTECTION_CONTACTS): string[] {
  const lines = ["TarragonHealth is registered with the Nigeria Data Protection Commission (NDPC)."];
  if (c.ndpcRegistrationRef) lines.push(`NDPC registration reference: ${c.ndpcRegistrationRef}.`);
  if (c.dpoName) lines.push(`Our Data Protection Officer is ${c.dpoName}.`);
  if (c.dpoEmail) lines.push(`Write to the Data Protection Officer at ${c.dpoEmail}.`);
  lines.push("You may also complain to the NDPC about how your data is handled.");
  return lines;
}
