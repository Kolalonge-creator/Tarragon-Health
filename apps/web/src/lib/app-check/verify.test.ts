import { generateKeyPairSync, createSign } from "node:crypto";
import { appCheckMode, appCheckShouldRefuse, resetJwksCacheForTests, verifyAppCheckToken, APP_CHECK_HEADER } from "./verify";

const PROJECT = "17658440935";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const jwks = { keys: [{ kid: "k1", kty: "RSA", alg: "RS256", use: "sig", n: publicJwk.n, e: publicJwk.e }] };
const fetchJwks = (async () => ({ ok: true, json: async () => jwks })) as unknown as typeof fetch;

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function token(payload: Record<string, unknown>, header: Record<string, unknown> = { alg: "RS256", typ: "JWT", kid: "k1" }) {
  const head = `${b64(header)}.${b64(payload)}`;
  const sig = createSign("RSA-SHA256").update(head).sign(privateKey).toString("base64url");
  return `${head}.${sig}`;
}
const now = 1_800_000_000_000;
const good = {
  iss: `https://firebaseappcheck.googleapis.com/${PROJECT}`,
  aud: [`projects/${PROJECT}`, "projects/tarragonhealth-f19b3"],
  sub: "1:17658440935:android:3ab2b9379a6139035f8642",
  exp: now / 1000 + 3600,
};

beforeEach(() => resetJwksCacheForTests());

describe("verifyAppCheckToken", () => {
  it("accepts a correctly signed, unexpired token for this project", async () => {
    await expect(verifyAppCheckToken(token(good), { fetchImpl: fetchJwks, nowMs: now })).resolves.toEqual({
      status: "valid",
      appId: good.sub,
    });
  });

  it("rejects wrong issuer, audience, expiry, key and a tampered payload", async () => {
    const v = (t: string) => verifyAppCheckToken(t, { fetchImpl: fetchJwks, nowMs: now });
    await expect(v(token({ ...good, iss: "https://firebaseappcheck.googleapis.com/999" }))).resolves.toMatchObject({ reason: "issuer" });
    await expect(v(token({ ...good, aud: ["projects/999"] }))).resolves.toMatchObject({ reason: "audience" });
    await expect(v(token({ ...good, exp: now / 1000 - 1 }))).resolves.toMatchObject({ reason: "expired" });
    await expect(v(token(good, { alg: "RS256", typ: "JWT", kid: "other" }))).resolves.toMatchObject({ reason: "unknown_key" });
    await expect(v(token(good, { alg: "none", typ: "JWT", kid: "k1" }))).resolves.toMatchObject({ reason: "header" });
    const [h, , s] = token(good).split(".");
    await expect(v(`${h}.${b64({ ...good, sub: "attacker" })}.${s}`)).resolves.toMatchObject({ reason: "signature" });
    await expect(v("not-a-jwt")).resolves.toMatchObject({ reason: "malformed" });
    await expect(verifyAppCheckToken(null)).resolves.toEqual({ status: "missing" });
  });
});

describe("JWKS handling", () => {
  it("does not wait on a failing JWKS endpoint for every request", async () => {
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      return { ok: false, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await expect(verifyAppCheckToken(token(good), { fetchImpl: failing, nowMs: now })).resolves.toMatchObject({ reason: "unknown_key" });
    await expect(verifyAppCheckToken(token(good), { fetchImpl: failing, nowMs: now + 1000 })).resolves.toMatchObject({ reason: "unknown_key" });
    expect(calls).toBe(1);
  });

  it("refetches once when a token names a key it has not seen (rotation)", async () => {
    let served = { keys: [] as unknown[] };
    let calls = 0;
    const rotating = (async () => {
      calls += 1;
      return { ok: true, json: async () => served };
    }) as unknown as typeof fetch;
    await expect(verifyAppCheckToken(token(good), { fetchImpl: rotating, nowMs: now })).resolves.toMatchObject({ reason: "unknown_key" });
    served = jwks;
    await expect(verifyAppCheckToken(token(good), { fetchImpl: rotating, nowMs: now + 11 * 60 * 1000 })).resolves.toMatchObject({ status: "valid" });
    expect(calls).toBe(2);
  });
});

describe("appCheckShouldRefuse", () => {
  const headers = (t?: string) => new Headers(t ? { [APP_CHECK_HEADER]: t } : {});

  it("monitor mode never refuses and stays quiet about requests without a token", async () => {
    const lines: string[] = [];
    const log = (l: string) => lines.push(l);
    const never = () => 0.5;
    await expect(appCheckShouldRefuse(headers(), "/api/mobile/x", { mode: "monitor", fetchImpl: fetchJwks, log, random: never })).resolves.toBe(false);
    await expect(appCheckShouldRefuse(headers("bad.token.here"), "/api/mobile/x", { mode: "monitor", fetchImpl: fetchJwks, log, random: never })).resolves.toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("status=invalid");
    expect(lines[0]).not.toContain("bad.token");
  });

  it("enforce mode refuses a missing or invalid token and admits a valid one", async () => {
    const log = () => {};
    await expect(appCheckShouldRefuse(headers(), "/p", { mode: "enforce", fetchImpl: fetchJwks, log })).resolves.toBe(true);
    await expect(appCheckShouldRefuse(headers("x.y.z"), "/p", { mode: "enforce", fetchImpl: fetchJwks, log })).resolves.toBe(true);
    await expect(appCheckShouldRefuse(headers(token({ ...good, exp: Date.now() / 1000 + 3600 })), "/p", { mode: "enforce", fetchImpl: fetchJwks, log })).resolves.toBe(false);
  });

  it("samples valid and missing verdicts so the missing share can be measured", async () => {
    const lines: string[] = [];
    await appCheckShouldRefuse(headers(), "/p", { mode: "monitor", log: (l) => lines.push(l), random: () => 0 });
    expect(lines).toEqual(["[app-check] mode=monitor status=missing sample=0.01 path=/p"]);
  });

  it("off mode does nothing, and an unknown mode value means monitor", async () => {
    await expect(appCheckShouldRefuse(headers(), "/p", { mode: "off" })).resolves.toBe(false);
    expect(appCheckMode(undefined)).toBe("monitor");
    expect(appCheckMode("ENFORCE")).toBe("monitor");
    expect(appCheckMode("enforce")).toBe("enforce");
  });
});
