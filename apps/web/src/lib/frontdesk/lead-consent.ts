/**
 * The consent a visitor gives when they tick the box on the website contact form (Front Desk F4). The text shown beside the box and the text
 * whose hash is stored as evidence are THE SAME constant, so the record can never describe wording the person did not see. Changing the text
 * means a new version string; old consents keep pointing at the wording they actually agreed to.
 */
export const ENQUIRY_CONSENT_VERSION = "enquiry-consent-v1";

export const ENQUIRY_CONSENT_WORDING =
  "I agree that TarragonHealth may email me about my enquiry and keep my details and message in its customer records, which are held with its CRM provider (HubSpot), as described in the Privacy Notice. I can ask it to stop at any time.";

export interface LeadContactDetails {
  readonly email: string | null;
  readonly phone: string | null;
}

/**
 * Splits the form's single "email or phone" field. A Nigerian number written locally (0803 123 4567) or with the country code (234803...)
 * becomes +234803...; any other international number must already be +E.164. Anything that is neither a usable email nor a usable phone gives
 * nulls, so the caller can skip capture without guessing.
 */
export function parseLeadContact(raw: string): LeadContactDetails {
  const v = raw.trim();
  if (v.includes("@")) {
    const email = v.toLowerCase();
    return { email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && email.length <= 200 ? email : null, phone: null };
  }
  const digits = v.replace(/[\s\-().]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return { email: null, phone: digits };
  if (/^0[789]\d{9}$/.test(digits)) return { email: null, phone: `+234${digits.slice(1)}` };
  if (/^234[789]\d{9}$/.test(digits)) return { email: null, phone: `+${digits}` };
  return { email: null, phone: null };
}
