import { isUuid } from "./ids.ts";
import { fail, type ProviderResult } from "./result.ts";

/**
 * Identity verification for clinician onboarding (P5, plan item R8, decision D6): NIN or BVN lookup plus a face match against the
 * photo the ID authority holds. The interface and a mock only. NO vendor is chosen: that waits on the DPO and counsel (NDPA and
 * GAID treat national ID numbers and biometric data as sensitive personal data), so a pilot is a one-line change in
 * `identityFromEnv` once they decide. Rules every adapter must keep:
 * - The raw ID number and the selfie exist for the length of one call. They are NEVER returned, logged, put in an error or
 *   stored by the caller; what is kept is the outcome, the last four digits and the vendor's reference (`IdentityOutcome`).
 * - A call needs a recorded consent id (an opaque uuid). FAIL CLOSED (OQ-352): `selectIdentity` always returns the provider behind
 *   `withConsentCheck`, which asks a `ConsentLookup` whether a live stored consent row exists for THIS subject and THIS consent id,
 *   and refuses (`consent_required`, never retried) when the answer is no, when the lookup is missing, or when it throws.
 *   The lookup in production is `rpcConsentLookup` over `public.identity_consent_valid` (service role only).
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

/** Answers: is there a live (not withdrawn) stored consent row with this id for this subject? Must never throw; a throw is read as "no". */
export type ConsentLookup = (subjectRef: string, consentId: string) => Promise<boolean>;

/**
 * Puts the consent check in front of any identity provider. The vendor is not called unless the lookup says yes. A missing lookup
 * (`null`), a lookup that throws and a lookup that says no all refuse the same way, so a caller that forgets to wire the check
 * gets a refusal, never an unchecked vendor call.
 */
export function withConsentCheck(inner: IdentityVerificationProvider, lookup: ConsentLookup | null): IdentityVerificationProvider {
  return {
    name: inner.name,
    isMock: inner.isMock,
    async verify(input: VerifyIdentityInput): Promise<ProviderResult<IdentityOutcome>> {
      if (!isUuid(input.consentId) || !isUuid(input.subjectRef)) return fail("consent_required", "A recorded consent is required before an identity check", false);
      if (lookup === null) return fail("consent_required", "The consent could not be checked, so no identity check was made", false);
      let allowed = false;
      try {
        allowed = (await lookup(input.subjectRef, input.consentId)) === true;
      } catch {
        allowed = false;
      }
      if (!allowed) return fail("consent_required", "No live consent is stored for this person, so no identity check was made", false);
      return inner.verify(input);
    },
  };
}

/** The shape of a Supabase client's `rpc` that the lookup needs (kept structural so this file imports no client). */
export type ConsentRpc = (fn: string, args: Record<string, string>) => PromiseLike<{ readonly data: unknown; readonly error: unknown }>;

/** The production lookup: `public.identity_consent_valid(p_consent, p_subject)`, callable by the service role only. Any error answers false. */
export function rpcConsentLookup(rpc: ConsentRpc): ConsentLookup {
  return async (subjectRef, consentId) => {
    try {
      const r = await rpc("identity_consent_valid", { p_consent: consentId, p_subject: subjectRef });
      return r.error === null || r.error === undefined ? r.data === true : false;
    } catch {
      return false;
    }
  };
}
