import { fail, ok, type ProviderResult } from "./result.ts";
import { isUuid } from "./ids.ts";
import { idLast4Of, isIdNumberShape, type FaceMatchOutcome, type IdentityOutcome, type IdentityVerificationProvider, type VerifyIdentityInput } from "./identity.ts";

export interface MockIdentityOptions {
  /**
   * Numbers whose last four digits are in this set answer "no record". Default: any number ending 0000, so a test can ask for
   * the not-found case without a lookup table of real-looking numbers.
   */
  readonly notFoundLast4?: ReadonlySet<string>;
  /** Selfies shorter than this many bytes do not match (a stand-in for a bad photo). Default 4. */
  readonly minSelfieBytes?: number;
  /** When true the selfie fails liveness. */
  readonly failLiveness?: boolean;
  /** The Nth call (1-based) fails the way an unreachable vendor does. */
  readonly failOnCall?: number;
  /** Fixed clock for tests. */
  readonly now?: () => Date;
}

/** A deterministic stand-in. Never talks to anything, never keeps the number or the selfie. */
export function createMockIdentity(options: MockIdentityOptions = {}): IdentityVerificationProvider {
  let calls = 0;
  const notFound = options.notFoundLast4 ?? new Set(["0000"]);
  const minSelfie = options.minSelfieBytes ?? 4;
  const now = options.now ?? (() => new Date());
  return {
    name: "mock",
    isMock: true,
    async verify(input: VerifyIdentityInput): Promise<ProviderResult<IdentityOutcome>> {
      if (!isUuid(input.consentId)) return fail("consent_required", "A recorded consent is required before an identity check", false);
      if (!isUuid(input.subjectRef)) return fail("invalid_input", "Subject reference must be an opaque uuid");
      if (input.idKind !== "nin" && input.idKind !== "bvn") return fail("invalid_input", "ID kind must be nin or bvn");
      if (!isIdNumberShape(input.idNumber)) return fail("invalid_input", "The ID number must be 11 digits");
      if (input.selfie !== undefined && input.selfie.byteLength === 0) return fail("invalid_input", "The selfie is empty");
      calls += 1;
      if (options.failOnCall === calls) return fail("network", "Could not reach the vendor");

      const idFound = !notFound.has(idLast4Of(input.idNumber));
      let faceMatch: FaceMatchOutcome | null = null;
      if (input.selfie !== undefined) {
        const live = options.failLiveness ? false : true;
        const good = idFound && live && input.selfie.byteLength >= minSelfie;
        faceMatch = { matched: good, score: good ? 92 : idFound ? 18 : null, livenessPassed: live };
      }
      return ok({
        vendorReference: `idv_mock_${calls}`,
        idKind: input.idKind,
        idLast4: idLast4Of(input.idNumber),
        idFound,
        faceMatch,
        checkedAt: now().toISOString(),
      });
    },
  };
}
