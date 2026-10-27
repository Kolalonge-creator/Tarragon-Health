/**
 * Data protection contact details shown on the public privacy page (W-55).
 *
 * The founder's NDPC registration and DPO appointment are recorded as approved and accepted (see docs/legal/facts.json). The details below
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

/**
 * The address the consent document itself (Schedule A) already gives for data questions, requests and complaints. It is shown even when
 * every founder field above is null, so a visitor always has a working contact.
 */
export const DATA_REQUEST_EMAIL = "privacy@tarragonhealth.ng";

/**
 * The lines to show, in order. A registration is claimed only when the founder has supplied the reference: until then the page says
 * nothing about registration (the safest wording, because an unverified registration claim is a statement to a regulator's audience).
 * The contact for data requests is always present.
 */
export function dataProtectionLines(c: DataProtectionContacts = DATA_PROTECTION_CONTACTS): string[] {
  const lines: string[] = [];
  if (c.ndpcRegistrationRef) lines.push(`TarragonHealth is registered with the Nigeria Data Protection Commission (NDPC). Registration reference: ${c.ndpcRegistrationRef}.`);
  if (c.dpoName) lines.push(`Our Data Protection Officer is ${c.dpoName}.`);
  lines.push(`For any question, request or complaint about your data, email ${c.dpoEmail ?? DATA_REQUEST_EMAIL}.`);
  lines.push("You may also complain to the NDPC about how your data is handled.");
  return lines;
}
