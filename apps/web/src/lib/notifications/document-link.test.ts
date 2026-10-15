import { createHmac } from "node:crypto";
import { describe, expect, it } from "@jest/globals";
import { documentTarget, verifyDocumentLink } from "./document-link";

const SECRET = "link-secret";
const ID = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000_000;
const sign = (kind: string, id: string, e: number, secret = SECRET) => createHmac("sha256", secret).update(`${kind}.${id}.${e}`).digest("hex");

describe("verifyDocumentLink", () => {
  it("accepts a link the sender signed (the same bytes the Deno signer produces)", () => {
    expect(verifyDocumentLink(SECRET, "lab-request", ID, String(NOW + 1000), sign("lab-request", ID, NOW + 1000), NOW)).toBe(true);
    expect(verifyDocumentLink(SECRET, "care-plan", ID, String(NOW + 1000), sign("care-plan", ID, NOW + 1000), NOW)).toBe(true);
  });
  it("refuses an expired link", () => {
    expect(verifyDocumentLink(SECRET, "lab-request", ID, String(NOW - 1), sign("lab-request", ID, NOW - 1), NOW)).toBe(false);
  });
  it("refuses a tampered id, kind, expiry or signature", () => {
    const e = NOW + 1000;
    const s = sign("lab-request", ID, e);
    expect(verifyDocumentLink(SECRET, "lab-request", "22222222-2222-4222-8222-222222222222", String(e), s, NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "care-plan", ID, String(e), s, NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "lab-request", ID, String(e + 1), s, NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "lab-request", ID, String(e), s.replace(/.$/, s.endsWith("0") ? "1" : "0"), NOW)).toBe(false);
  });
  it("refuses a wrong secret and a missing secret (never an unsigned pass)", () => {
    const e = NOW + 1000;
    expect(verifyDocumentLink("other", "lab-request", ID, String(e), sign("lab-request", ID, e), NOW)).toBe(false);
    expect(verifyDocumentLink(undefined, "lab-request", ID, String(e), sign("lab-request", ID, e), NOW)).toBe(false);
    expect(verifyDocumentLink("", "lab-request", ID, String(e), sign("lab-request", ID, e, ""), NOW)).toBe(false);
  });
  it("refuses malformed input without throwing", () => {
    expect(verifyDocumentLink(SECRET, "lab-request", "not-a-uuid", "1800000000000", "ab", NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "other-kind", ID, "1800000000000", "a".repeat(64), NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "lab-request", ID, null, null, NOW)).toBe(false);
    expect(verifyDocumentLink(SECRET, "lab-request", ID, "abc", "a".repeat(64), NOW)).toBe(false);
  });
});

describe("documentTarget", () => {
  it("points at the existing in-app PDF routes", () => {
    expect(documentTarget("lab-request", ID)).toBe(`/api/patient/lab-order/${ID}/request`);
    expect(documentTarget("care-plan", ID)).toBe("/api/patient/preventive-care-plan");
  });
});
