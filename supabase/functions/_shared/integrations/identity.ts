import type { ProviderResult } from "./result.ts";

/**
 * Identity verification for clinician onboarding (P5, plan item R8, decision D6): NIN or BVN lookup plus a face match against the
 * photo the ID authority holds. The interface and a mock only. NO vendor is chosen: that waits on the DPO and counsel (NDPA and
 * GAID treat national ID numbers and biometric data as sensitive personal data), so a pilot is a one-line change in
 * `identityFromEnv` once they decide. Rules every adapter must keep:
 * - The raw ID number and the selfie exist for the length of one call. They are NEVER returned, logged, put in an error or
 *   stored by the caller; what is kept is the outcome, the last four digits and the vendor's reference (`IdentityOutcome`).
 * - A call needs a recorded consent id (an opaque uuid). The adapter checks the id is well formed; the caller proves the consent
 *   row exists before it asks.
 * - The subject is an opaque uuid (a profile id), never a name, so a vendor log cannot identify a person on its own.
 * - Nothing here suspends, approves or activates anyone. A failed or inconclusive outcome is information for a human reviewer
 *   (a verification can fail because the national database is down), never an automatic rejection.
 */
export type IdKind = "nin" | "bvn";

export interface VerifyIdentityInput {
  /** Opaque reference to the person (a profile uuid). */
  readonly subjectRef: string;
  readonly idKind: IdKind;
  /** The 11-digit number. Used for this call only. */
  readonly idNumber: string;
  /** Id of the recorded consent row for this check. */
  readonly consentId: string;
  /** A live selfie for the face match, JPEG or PNG bytes. Omit to check the number only. Used for this call only. */
  readonly selfie?: Uint8Array;
}

export interface FaceMatchOutcome {
  /** The vendor's decision at its own threshold. */
  readonly matched: boolean;
  /** 0 to 100 where the vendor reports one. */
  readonly score: number | null;
  /** Whether the selfie was judged to be a live person, where the vendor checks it. */
  readonly livenessPassed: boolean | null;
}

/** The ONLY thing a caller may keep about a verification. */
export interface IdentityOutcome {
  readonly vendorReference: string;
  readonly idKind: IdKind;
  /** Last four digits, for a human to recognise the record. Never more. */
  readonly idLast4: string;
  /** The authority had a record for this number. */
  readonly idFound: boolean;
  /** Null when no selfie was sent. */
  readonly faceMatch: FaceMatchOutcome | null;
  /** ISO time the vendor produced the answer. */
  readonly checkedAt: string;
}

export interface IdentityVerificationProvider {
  readonly name: string;
  readonly isMock: boolean;
  verify(input: VerifyIdentityInput): Promise<ProviderResult<IdentityOutcome>>;
}

/** NIN and BVN are both exactly 11 digits. */
export const isIdNumberShape = (s: unknown): s is string => typeof s === "string" && /^[0-9]{11}$/.test(s);

/** The last four digits of a well-formed number. */
export const idLast4Of = (idNumber: string): string => idNumber.slice(-4);
