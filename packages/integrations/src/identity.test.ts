import { describe, expect, it } from "@jest/globals";
import { createMockIdentity, identityFromEnv, selectIdentity, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runIdentityContract } from "./contracts/identity.contract";

const noFetch: FetchLike = async () => {
  throw new Error("no network in this test");
};
const SUBJECT = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const CONSENT = "c1a9e4d2-83b6-4f70-a5e1-92d04b7c6f18";
const FOUND = "12345678901";
const NOT_FOUND = "12345670000";

runIdentityContract("mock", () => ({ provider: createMockIdentity(), foundNumber: FOUND, notFoundNumber: NOT_FOUND }));

describe("mock identity verification", () => {
  it("a good selfie against a found record matches, with a score and liveness", async () => {
    const r = await createMockIdentity().verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT, selfie: new Uint8Array([1, 2, 3, 4, 5]) });
    expect(r.ok && r.data.faceMatch).toEqual({ matched: true, score: 92, livenessPassed: true });
  });
  it("a bad photo, a failed liveness check, or a number with no record all fail the match without an error", async () => {
    const tiny = await createMockIdentity().verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT, selfie: new Uint8Array([1]) });
    expect(tiny.ok && tiny.data.faceMatch?.matched).toBe(false);
    const dead = await createMockIdentity({ failLiveness: true }).verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT, selfie: new Uint8Array([1, 2, 3, 4]) });
    expect(dead.ok && dead.data.faceMatch).toMatchObject({ matched: false, livenessPassed: false });
    const none = await createMockIdentity().verify({ subjectRef: SUBJECT, idKind: "bvn", idNumber: NOT_FOUND, consentId: CONSENT, selfie: new Uint8Array([1, 2, 3, 4]) });
    expect(none.ok && none.data).toMatchObject({ idFound: false, faceMatch: { matched: false, score: null } });
  });
  it("an unreachable vendor is a retryable value, never a throw", async () => {
    const r = await createMockIdentity({ failOnCall: 1 }).verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT });
    expect(r).toMatchObject({ ok: false, error: { code: "network", retryable: true } });
  });
  it("numbers an outcome per call and uses the injected clock", async () => {
    const p = createMockIdentity({ now: () => new Date("2026-10-13T10:00:00Z") });
    const a = await p.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT });
    const b = await p.verify({ subjectRef: SUBJECT, idKind: "nin", idNumber: FOUND, consentId: CONSENT });
    expect(a.ok && b.ok && a.data.vendorReference !== b.data.vendorReference).toBe(true);
    expect(a.ok && a.data.checkedAt).toBe("2026-10-13T10:00:00.000Z");
  });
  it("rejects an unknown id kind", async () => {
    const r = await createMockIdentity().verify({ subjectRef: SUBJECT, idKind: "passport" as never, idNumber: FOUND, consentId: CONSENT });
    expect(r).toMatchObject({ ok: false, error: { code: "invalid_input" } });
  });
});

describe("which vendor checks an ID", () => {
  it("no vendor is chosen: nothing is built from the environment, even with plausible keys set", () => {
    expect(identityFromEnv({ DOJAH_APP_ID: "x", SMILE_ID_PARTNER_ID: "y", PREMBLY_API_KEY: "z" }, noFetch)).toBeNull();
  });
  it("in production that is not_configured, never a mock", () => {
    for (const env of [{}, { APP_ENV: "production" }, { APP_ENV: "prod" }]) {
      expect(selectIdentity(env, noFetch)).toMatchObject({ ok: false, error: { code: "not_configured" } });
    }
  });
  it("outside production one mock per process stands in", () => {
    for (const APP_ENV of ["development", "staging", "test"]) {
      const a = selectIdentity({ APP_ENV }, noFetch);
      const b = selectIdentity({ APP_ENV }, noFetch);
      expect(a.ok && a.data.isMock).toBe(true);
      expect(a.ok && b.ok && a.data === b.data).toBe(true);
    }
  });
});
