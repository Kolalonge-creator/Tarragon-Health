import { describe, expect, it } from "@jest/globals";
import type { IdentityVerificationProvider } from "../../../../supabase/functions/_shared/integrations/index.ts";

export interface IdentityFixture {
  readonly provider: IdentityVerificationProvider;
  /** A number the fixture answers "found" for, and one it answers "no record" for. */
  readonly foundNumber: string;
  readonly notFoundNumber: string;
}

const SUBJECT = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const CONSENT = "c1a9e4d2-83b6-4f70-a5e1-92d04b7c6f18";
const SELFIE = new Uint8Array([255, 216, 255, 224, 1, 2, 3, 4]);

/**
 * What every identity adapter must do (P5). The central rule is data minimisation: the raw number and the selfie are used for the
 * call and appear nowhere in what comes back, in any error, or in anything serialised from the result.
 */
export function runIdentityContract(name: string, make: () => IdentityFixture): void {
  describe(`IdentityVerificationProvider contract: ${name}`, () => {
    it("will not run without a recorded consent", async () => {
      const f = make();
      for (const consentId of ["", "yes", "not-a-uuid"]) {
        const r = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: f.foundNumber, consentId });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("consent_required");
      }
    });

    it("refuses a subject that is not an opaque id, and a number that is not 11 digits", async () => {
      const f = make();
      expect((await f.provider.verify({ subjectRef: "Ada Okafor", idKind: "nin", idNumber: f.foundNumber, consentId: CONSENT })).ok).toBe(false);
      for (const idNumber of ["", "123", "1234567890", "123456789012", "1234567890a", "12345 67890"]) {
        const r = await f.provider.verify({ subjectRef: SUBJECT, idKind: "bvn", idNumber, consentId: CONSENT });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("invalid_input");
      }
    });

    it("returns the outcome, the last four digits and a vendor reference, for NIN and for BVN", async () => {
      const f = make();
      for (const idKind of ["nin", "bvn"] as const) {
        const r = await f.provider.verify({ subjectRef: SUBJECT, idKind, idNumber: f.foundNumber, consentId: CONSENT });
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.data.idKind).toBe(idKind);
        expect(r.data.idLast4).toBe(f.foundNumber.slice(-4));
        expect(r.data.idFound).toBe(true);
        expect(r.data.vendorReference.length).toBeGreaterThan(0);
        expect(Number.isNaN(Date.parse(r.data.checkedAt))).toBe(false);
        expect(r.data.faceMatch).toBeNull();
      }
    });

    it("a number with no record is a normal answer, not an error", async () => {
      const f = make();
      const r = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: f.notFoundNumber, consentId: CONSENT });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.idFound).toBe(false);
    });

    it("a selfie adds a face match with a decision, a score and liveness", async () => {
      const f = make();
      const r = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: f.foundNumber, consentId: CONSENT, selfie: SELFIE });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.data.faceMatch).not.toBeNull();
      expect(typeof r.data.faceMatch?.matched).toBe("boolean");
      const score = r.data.faceMatch?.score ?? null;
      expect(score === null || (score >= 0 && score <= 100)).toBe(true);
    });

    it("never returns the raw number, never the selfie, in a result or in an error", async () => {
      const f = make();
      const good = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: f.foundNumber, consentId: CONSENT, selfie: SELFIE });
      const bad = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: `${f.foundNumber}9`, consentId: CONSENT });
      for (const r of [good, bad]) {
        const text = JSON.stringify(r);
        expect(text).not.toContain(f.foundNumber);
        expect(text).not.toContain(`${f.foundNumber}9`);
        expect(text).not.toMatch(/[0-9]{11}/);
        expect(text.toLowerCase()).not.toContain("selfie");
      }
      if (good.ok) expect(Object.keys(good.data).sort()).toEqual(["checkedAt", "faceMatch", "idFound", "idKind", "idLast4", "vendorReference"]);
    });

    it("an empty selfie is refused rather than treated as a failed match", async () => {
      const f = make();
      const r = await f.provider.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: f.foundNumber, consentId: CONSENT, selfie: new Uint8Array() });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe("invalid_input");
    });
  });
}
