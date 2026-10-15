import { describe, expect, it } from "@jest/globals";
import { createMockIdentity, identityFromEnv, rpcConsentLookup, selectIdentity, withConsentCheck, type ConsentLookup, type FetchLike } from "../../../supabase/functions/_shared/integrations/index.ts";
import { runIdentityContract } from "./contracts/identity.contract";

const noFetch: FetchLike = async () => {
  throw new Error("no network in this test");
};
const SUBJECT = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const CONSENT = "c1a9e4d2-83b6-4f70-a5e1-92d04b7c6f18";
const FOUND = "12345678901";
const NOT_FOUND = "12345670000";

runIdentityContract("mock", () => ({ provider: createMockIdentity(), foundNumber: FOUND, notFoundNumber: NOT_FOUND }));
// the same contract holds behind the consent check when the consent is on file
runIdentityContract("mock behind the consent check", () => ({ provider: withConsentCheck(createMockIdentity(), async () => true), foundNumber: FOUND, notFoundNumber: NOT_FOUND }));

describe("the consent check fails closed (OQ-352)", () => {
  const input = { subjectRef: SUBJECT, idKind: "nin" as const, idNumber: FOUND, consentId: CONSENT };
  function counting() {
    let calls = 0;
    const inner = createMockIdentity();
    return { calls: () => calls, provider: { ...inner, verify: (i: typeof input) => { calls += 1; return inner.verify(i); } } };
  }
  it("a lookup that says no refuses and never reaches the vendor", async () => {
    const c = counting();
    const r = await withConsentCheck(c.provider, async () => false).verify(input);
    expect(r).toMatchObject({ ok: false, error: { code: "consent_required", retryable: false } });
    expect(c.calls()).toBe(0);
  });
  it("no lookup at all refuses (a caller that forgets to wire it gets a refusal, not an unchecked call)", async () => {
    const c = counting();
    const r = await withConsentCheck(c.provider, null).verify(input);
    expect(r).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(c.calls()).toBe(0);
  });
  it("a lookup that throws, or answers something other than true, refuses", async () => {
    const c = counting();
    for (const lookup of [async () => { throw new Error("db down"); }, (async () => "yes") as unknown as ConsentLookup, (async () => 1) as unknown as ConsentLookup]) {
      expect(await withConsentCheck(c.provider, lookup).verify(input)).toMatchObject({ ok: false, error: { code: "consent_required" } });
    }
    expect(c.calls()).toBe(0);
  });
  it("a malformed consent or subject id is refused before the lookup is asked", async () => {
    let asked = 0;
    const p = withConsentCheck(createMockIdentity(), async () => { asked += 1; return true; });
    expect(await p.verify({ ...input, consentId: "yes" })).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(await p.verify({ ...input, subjectRef: "Ada Okafor" })).toMatchObject({ ok: false, error: { code: "consent_required" } });
    expect(asked).toBe(0);
  });
  it("asks about exactly this subject and this consent, and only then calls the vendor", async () => {
    const seen: string[] = [];
    const c = counting();
    const r = await withConsentCheck(c.provider, async (s, id) => { seen.push(`${s}|${id}`); return true; }).verify(input);
    expect(seen).toEqual([`${SUBJECT}|${CONSENT}`]);
    expect(r.ok).toBe(true);
    expect(c.calls()).toBe(1);
  });
  it("the refusal text carries no number and no selfie", async () => {
    const r = await withConsentCheck(createMockIdentity(), async () => false).verify({ ...input, selfie: new Uint8Array([1, 2, 3, 4]) });
    expect(JSON.stringify(r)).not.toContain(FOUND);
  });
  it("the rpc lookup is true only for data === true with no error, and calls the service function with both ids", async () => {
    const args: Array<[string, Record<string, string>]> = [];
    const mk = (res: { data: unknown; error: unknown }) => rpcConsentLookup(async (fn, a) => { args.push([fn, a]); return res; });
    expect(await mk({ data: true, error: null })(SUBJECT, CONSENT)).toBe(true);
    expect(args[0]).toEqual(["identity_consent_valid", { p_consent: CONSENT, p_subject: SUBJECT }]);
    expect(await mk({ data: false, error: null })(SUBJECT, CONSENT)).toBe(false);
    expect(await mk({ data: true, error: { message: "denied" } })(SUBJECT, CONSENT)).toBe(false);
    expect(await mk({ data: null, error: null })(SUBJECT, CONSENT)).toBe(false);
    expect(await rpcConsentLookup(async () => { throw new Error("network"); })(SUBJECT, CONSENT)).toBe(false);
  });
});

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
      expect(selectIdentity(env, noFetch, async () => true)).toMatchObject({ ok: false, error: { code: "not_configured" } });
    }
  });
  it("outside production one mock per process stands in, and the numbering continues across selections", async () => {
    for (const APP_ENV of ["development", "staging", "test"]) {
      const a = selectIdentity({ APP_ENV }, noFetch, async () => true);
      const b = selectIdentity({ APP_ENV }, noFetch, async () => true);
      expect(a.ok && a.data.isMock).toBe(true);
      const input = { subjectRef: SUBJECT, idKind: "nin" as const, idNumber: FOUND, consentId: CONSENT };
      const r1 = a.ok ? await a.data.verify(input) : null;
      const r2 = b.ok ? await b.data.verify(input) : null;
      expect(r1?.ok && r2?.ok && r1.data.vendorReference !== r2.data.vendorReference).toBe(true);
    }
  });
  it("whatever is selected is behind the consent check: no lookup, or a lookup that says no, refuses", async () => {
    const input = { subjectRef: SUBJECT, idKind: "nin" as const, idNumber: FOUND, consentId: CONSENT };
    for (const lookup of [null, async () => false]) {
      const p = selectIdentity({ APP_ENV: "test" }, noFetch, lookup);
      expect(p.ok).toBe(true);
      if (p.ok) expect(await p.data.verify(input)).toMatchObject({ ok: false, error: { code: "consent_required" } });
    }
  });
});
