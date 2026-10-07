import { describe, expect, it } from "@jest/globals";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { constantTimeEqual, fromHex, hmacSha256, pbkdf2Sha256, sha256, toHex, utf8 } from "./pbkdf2";

describe("sha256, hmac and pbkdf2 match Node's crypto", () => {
  it("sha256 on edge lengths (empty, 55, 56, 63, 64, 65, 200 bytes)", () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200]) {
      const data = randomBytes(n);
      expect(toHex(sha256(new Uint8Array(data)))).toBe(createHash("sha256").update(data).digest("hex"));
    }
  });

  it("hmac-sha256 with short, 64 and long keys", () => {
    for (const keyLen of [1, 20, 64, 100]) {
      const key = randomBytes(keyLen);
      const msg = randomBytes(77);
      expect(toHex(hmacSha256(new Uint8Array(key), new Uint8Array(msg)))).toBe(createHmac("sha256", key).update(msg).digest("hex"));
    }
  });

  it("pbkdf2 RFC 7914 vectors", () => {
    expect(toHex(pbkdf2Sha256(utf8("passwd"), utf8("salt"), 1))).toBe("55ac046e56e3089fec1691c22544b605f94185216dde0465e68b9d57c20dacbc");
    expect(toHex(pbkdf2Sha256(utf8("Password"), utf8("NaCl"), 80000))).toBe(
      "4ddcd8f60b98be21830cee5ef22701f9641a4418d04c0414aeff08876b34ab56",
    );
  });

  it("pbkdf2 matches Node for random pins and salts", () => {
    for (let i = 0; i < 5; i += 1) {
      const pin = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
      const salt = randomBytes(16);
      expect(toHex(pbkdf2Sha256(utf8(pin), new Uint8Array(salt), 1000))).toBe(pbkdf2Sync(pin, salt, 1000, 32, "sha256").toString("hex"));
    }
  });

  it("rejects a bad iteration count, bad hex and compares in constant shape", () => {
    expect(() => pbkdf2Sha256(utf8("a"), utf8("b"), 0)).toThrow();
    expect(() => fromHex("zz")).toThrow();
    expect(toHex(fromHex("00ff10"))).toBe("00ff10");
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });
});
