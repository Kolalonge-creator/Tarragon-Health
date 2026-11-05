/**
 * The no-login check for a printed laboratory request form (T2 Phase 3, brief 6.3). Shared by the PDF (which prints the code and
 * the QR) and the public page /verify-request/[ref] (which shows the proof). Pure: no Supabase, no platform imports, so the public
 * page can use it without pulling in anything a session would reach.
 *
 * The 64-hex token (in the QR) and the 10-character code (printed, for typing in) are both bearer credentials for the same proof.
 * Never log either, never put either in a notification.
 */

export const REQUEST_TOKEN_PATTERN = /^[0-9a-f]{64}$/;
/** The code alphabet has no 0/O, 1/I/L or U, so what is read off paper is what is typed. */
export const REQUEST_CODE_PATTERN = /^[2-9A-HJKMNP-TV-Z]{10}$/;

/** Spaces and dashes removed, letters upper-cased for a code; a token stays lower case. Null when it is neither. */
export function normaliseRequestRef(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, "");
  if (REQUEST_TOKEN_PATTERN.test(s.toLowerCase()) && s.length === 64) return s.toLowerCase();
  const up = s.toUpperCase();
  return REQUEST_CODE_PATTERN.test(up) ? up : null;
}

/** "ABCDE-FGHJK", as printed. */
export function formatRequestCode(code: string): string {
  return code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code;
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "https://tarragonhealth.ng").replace(/\/+$/, "");
}

/** Where the QR points. */
export function labRequestVerifyUrl(token: string): string {
  return `${siteBase()}/verify-request/${token}`;
}

/** The address printed for someone with no camera: they type the code there. */
export function labRequestVerifyIndexText(): string {
  return `${siteBase().replace(/^https?:\/\//, "")}/verify-request`;
}

export interface PublicRequestProof {
  status: "valid" | "used" | "cancelled";
  order_number: string | null;
  issued_on: string | null;
  tests: string[];
  patient_initials: string | null;
  requested_by: string;
  requester_registration: string | null;
}

/** Narrows the RPC's first row; anything unexpected is treated as "no such request". */
export function parseRequestProof(data: unknown): PublicRequestProof | null {
  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.status !== "valid" && r.status !== "used" && r.status !== "cancelled") return null;
  if (typeof r.requested_by !== "string") return null;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    status: r.status,
    order_number: str(r.order_number),
    issued_on: str(r.issued_on),
    tests: Array.isArray(r.tests) ? r.tests.filter((t): t is string => typeof t === "string") : [],
    patient_initials: str(r.patient_initials),
    requested_by: r.requested_by,
    requester_registration: str(r.requester_registration),
  };
}

export function presentRequestStatus(status: PublicRequestProof["status"]): { tone: "good" | "warn" | "bad"; headline: string; guidance: string } {
  switch (status) {
    case "valid":
      return {
        tone: "good",
        headline: "This request form is genuine",
        guidance: "TarragonHealth issued it on the date shown. Check the initials against the person in front of you.",
      };
    case "used":
      return {
        tone: "warn",
        headline: "This request form is genuine, and a result is already on record for it",
        guidance: "It may be a repeat visit. If the person needs the tests again, they can get a new form in the app.",
      };
    case "cancelled":
      return {
        tone: "bad",
        headline: "This request form was cancelled",
        guidance: "Do not run these tests on the strength of this form. The person can get a current form in the app.",
      };
  }
}

/** What the form and the check page say about the laboratory's position (brief 6.3: never imply a contract or an obligation). */
export const LAB_NOT_CONTRACTED_STATEMENT =
  "This form is not a referral to a particular laboratory. TarragonHealth has no agreement with the laboratory that receives it, the laboratory is not obliged to accept it, and the patient pays the laboratory directly at its own price.";

export const NOT_FOUND_REQUEST_MESSAGE =
  "We could not find a request form with that code. Check the code and try again. If it still fails, do not rely on the paper alone.";

export const RATE_LIMITED_REQUEST_MESSAGE = "Too many checks from this connection. Please wait a minute and try again.";
