import { createDecipheriv } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { buildManifest, buildShlink, deriveShlKey, encryptJwe, parseShlink, ShlTooLarge } from "./smart-health-link";

const SECRET = "x".repeat(40);
const TOKEN = "a".repeat(64);

function decryptJwe(jwe: string, key: Buffer): string {
  const [header, encryptedKey, iv, ciphertext, tag] = jwe.split(".") as [string, string, string, string, string];
  expect(encryptedKey).toBe("");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(header, "ascii"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  const packed = Buffer.concat([d.update(Buffer.from(ciphertext, "base64url")), d.final()]);
  return inflateRawSync(packed).toString("utf8");
}

describe("deriveShlKey", () => {
  it("is stable for the same token and secret, 32 bytes", () => {
    const a = deriveShlKey(TOKEN, SECRET);
    expect(a?.length).toBe(32);
    expect(deriveShlKey(TOKEN, SECRET)?.equals(a as Buffer)).toBe(true);
  });
  it("differs by token and by secret", () => {
    expect(deriveShlKey("b".repeat(64), SECRET)?.equals(deriveShlKey(TOKEN, SECRET) as Buffer)).toBe(false);
    expect(deriveShlKey(TOKEN, "y".repeat(40))?.equals(deriveShlKey(TOKEN, SECRET) as Buffer)).toBe(false);
  });
  it("refuses with no secret, a short secret or a short token (no unkeyed fallback)", () => {
    expect(deriveShlKey(TOKEN, undefined)).toBeNull();
    expect(deriveShlKey(TOKEN, "short")).toBeNull();
    expect(deriveShlKey("tooshort", SECRET)).toBeNull();
  });
});

describe("buildShlink / parseShlink", () => {
  const base = { token: TOKEN, origin: "https://app.example.test/", expiresAt: "2026-10-27T09:00:00Z", pinProtected: true, recipientLabel: "Dr Okafor", secret: SECRET };

  it("round-trips and sets the passcode flag only for a PIN link", () => {
    const link = buildShlink(base) as string;
    expect(link.startsWith("shlink:/")).toBe(true);
    const p = parseShlink(link);
    expect(p?.v).toBe(1);
    expect(p?.flag).toBe("P");
    expect(p?.url).toBe(`https://app.example.test/api/shl/${TOKEN}`);
    expect(p?.exp).toBe(Math.floor(new Date("2026-10-27T09:00:00Z").getTime() / 1000));
    expect(p?.label).toContain("Dr Okafor");
    expect(Buffer.from(p?.key as string, "base64url").length).toBe(32);
    expect(parseShlink(buildShlink({ ...base, pinProtected: false }) as string)?.flag).toBeUndefined();
  });

  it("keeps the label inside the 80 character limit", () => {
    const p = parseShlink(buildShlink({ ...base, recipientLabel: "n".repeat(200) }) as string);
    expect((p?.label ?? "").length).toBeLessThanOrEqual(80);
  });

  it("makes no link without a secret", () => {
    expect(buildShlink({ ...base, secret: undefined, })).toBeNull();
  });

  it("rejects garbage", () => {
    expect(parseShlink("shlink:/not-base64-json")).toBeNull();
    expect(parseShlink("https://example.test")).toBeNull();
  });
});

describe("encryptJwe / buildManifest", () => {
  const key = deriveShlKey(TOKEN, SECRET) as Buffer;

  it("produces a compact JWE a standard A256GCM dir reader can open, and the header names the content type", () => {
    const jwe = encryptJwe('{"resourceType":"Bundle"}', key);
    const header = JSON.parse(Buffer.from(jwe.split(".")[0] as string, "base64url").toString("utf8"));
    expect(header).toEqual({ alg: "dir", enc: "A256GCM", zip: "DEF", cty: "application/fhir+json" });
    expect(decryptJwe(jwe, key)).toBe('{"resourceType":"Bundle"}');
  });

  it("uses a fresh nonce each time", () => {
    expect(encryptJwe("x", key)).not.toBe(encryptJwe("x", key));
  });

  it("fails to open with another key or a tampered header", () => {
    const jwe = encryptJwe("secret", key);
    expect(() => decryptJwe(jwe, deriveShlKey("c".repeat(64), SECRET) as Buffer)).toThrow();
    const parts = jwe.split(".");
    parts[0] = Buffer.from(JSON.stringify({ alg: "dir", enc: "A256GCM", zip: "DEF", cty: "text/plain" })).toString("base64url");
    expect(() => decryptJwe(parts.join("."), key)).toThrow();
  });

  it("builds a one-file manifest and refuses when the recipient cannot take it inline", () => {
    const m = buildManifest('{"a":1}', key);
    expect(m.files).toHaveLength(1);
    expect(m.files[0]?.contentType).toBe("application/fhir+json");
    expect(decryptJwe(m.files[0]?.embedded as string, key)).toBe('{"a":1}');
    expect(() => buildManifest('{"a":1}', key, 10)).toThrow(ShlTooLarge);
  });

  it("rejects a key of the wrong length", () => {
    expect(() => encryptJwe("x", Buffer.alloc(16))).toThrow();
  });
});
