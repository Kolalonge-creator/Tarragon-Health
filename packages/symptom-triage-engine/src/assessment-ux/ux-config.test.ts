/**
 * S59c: which copy of a config a screen may trust (bundled, live, drift).
 */
import { describe, it, expect } from "@jest/globals";
import { CHECKBACK_DRAFT, DESCRIBE_DRAFT, EXPLAINER_DRAFT, SAFETY_NET_DRAFT } from "./drafts";
import { checkbackConfigSchema } from "./checkback";
import { describeTableSchema } from "./describe-match";
import { explainerConfigSchema } from "./explainer";
import { safetyNetConfigSchema } from "./safety-net";
import { LIVE_UNREADABLE, resolveBundled, sortKeys } from "./ux-config";

type Signed<T> = Omit<T, "status" | "clinical_sign_off"> & { status: string; clinical_sign_off: { by: string; at: string } };
const sign = <T extends object>(c: T): Signed<T> => ({ ...c, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } }) as Signed<T>;

describe("the four shipped drafts", () => {
  it("are all unsigned drafts at version 1 (an agent signs nothing)", () => {
    for (const d of [CHECKBACK_DRAFT, DESCRIBE_DRAFT, EXPLAINER_DRAFT, SAFETY_NET_DRAFT]) {
      expect(d.status).toBe("draft");
      expect(d.clinical_sign_off).toBeNull();
      expect(d.version).toBe(1);
    }
  });
});

describe("resolveBundled", () => {
  it("an unsigned bundle is never used, online or offline", () => {
    expect(resolveBundled(explainerConfigSchema, EXPLAINER_DRAFT)).toEqual({ config: null, trust: "unsigned" });
    // the server signed but this build still bundles the draft: off, and reported as such (not silently "unsigned")
    expect(resolveBundled(explainerConfigSchema, EXPLAINER_DRAFT, sign(EXPLAINER_DRAFT))).toEqual({ config: null, trust: "bundle_unsigned" });
    expect(resolveBundled(explainerConfigSchema, EXPLAINER_DRAFT, null)).toEqual({ config: null, trust: "unsigned" });
  });

  it("a signed bundle is not trusted on its own word when the live copy could not be read", () => {
    expect(resolveBundled(safetyNetConfigSchema, sign(SAFETY_NET_DRAFT), LIVE_UNREADABLE)).toEqual({ config: null, trust: "unverified" });
    expect(resolveBundled(safetyNetConfigSchema, SAFETY_NET_DRAFT, LIVE_UNREADABLE)).toEqual({ config: null, trust: "unsigned" });
  });

  it("the signer's display name and date do not decide equality (a profile rename is not drift)", () => {
    const bundled = sign(CHECKBACK_DRAFT);
    const live = { ...bundled, clinical_sign_off: { by: "Dr Renamed", at: "2026-11-02" } };
    expect(resolveBundled(checkbackConfigSchema, bundled, live).trust).toBe("in_force");
    expect(resolveBundled(checkbackConfigSchema, bundled, { ...live, expire_after_hours: 47 }).trust).toBe("drift");
  });

  it("a signed bundle is used offline", () => {
    expect(resolveBundled(safetyNetConfigSchema, sign(SAFETY_NET_DRAFT)).trust).toBe("in_force");
  });

  it("a signed bundle is used online only when it equals the live signed version, whatever the key order", () => {
    const signed = sign(CHECKBACK_DRAFT);
    const reordered = JSON.parse(JSON.stringify(sortKeys(signed))) as unknown;
    expect(resolveBundled(checkbackConfigSchema, signed, reordered).trust).toBe("in_force");
  });

  it("a signed bundle that differs from the live signed version is drift and not used", () => {
    const signed = sign(DESCRIBE_DRAFT);
    const other = { ...signed, version: 2 };
    expect(resolveBundled(describeTableSchema, signed, other)).toEqual({ config: null, trust: "drift" });
  });

  it("a signed bundle when the server has no signed version is drift and not used", () => {
    expect(resolveBundled(describeTableSchema, sign(DESCRIBE_DRAFT), null)).toEqual({ config: null, trust: "drift" });
  });

  it("a live copy that is itself unsigned or malformed is drift", () => {
    expect(resolveBundled(describeTableSchema, sign(DESCRIBE_DRAFT), DESCRIBE_DRAFT).trust).toBe("drift");
    expect(resolveBundled(describeTableSchema, sign(DESCRIBE_DRAFT), { junk: true }).trust).toBe("drift");
  });

  it("a malformed bundle is invalid", () => {
    expect(resolveBundled(describeTableSchema, { junk: true })).toEqual({ config: null, trust: "invalid" });
  });
});
