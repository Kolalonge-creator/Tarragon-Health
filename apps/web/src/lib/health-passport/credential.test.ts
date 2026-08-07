import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import {
  base64UrlDecode,
  base64UrlEncode,
  canonicalize,
  chunk,
  contentDigest,
  credentialPayloadSchema,
  decodeCompact,
  encodeCompact,
  publicKeyFromSpkiBase64,
  sha256Hex,
  shortDigest,
  verifyCompact,
  verifySignature,
  type CredentialPayload,
} from "./credential";

/**
 * These tests exist because the failure mode of this module is silent.
 *
 * A canonicaliser that orders keys differently on two machines, or a base64url
 * helper that keeps its padding, produces credentials that verify locally and
 * fail in an embassy — with no error anywhere in between, and no way to tell the
 * patient why their document was rejected. So the properties are asserted
 * directly rather than inferred from a happy-path round trip.
 */

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    privateKey,
    spkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  };
}

const PAYLOAD: CredentialPayload = {
  v: 1,
  typ: "health-passport",
  iss: "TarragonHealth",
  iss_domain: "tarragonhealth.ng",
  alg: "Ed25519",
  kid: "thp-test",
  serial: "THP-ABCD-EFGH-JKMN-PQRS",
  issued_at: "2026-08-07T09:00:00.000Z",
  expires_at: "2027-08-07T09:00:00.000Z",
  sub: { name: "Adaeze Okonkwo", dob: "1985-04-02", patient_ref: "PT-000123" },
  content_digest: "a".repeat(64),
  attestation: null,
};

describe("canonicalize", () => {
  it("sorts object keys so two builders produce identical bytes", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(canonicalize({ a: 2, b: 1 })).toBe(canonicalize({ b: 1, a: 2 }));
  });

  it("sorts nested keys too", () => {
    expect(canonicalize({ z: { d: 1, c: 2 }, a: 3 })).toBe('{"a":3,"z":{"c":2,"d":1}}');
  });

  it("leaves array order alone — order is meaning in a list of readings", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("emits no insignificant whitespace", () => {
    expect(canonicalize({ a: 1, b: [1, 2] })).not.toMatch(/\s/);
  });

  it("preserves null rather than dropping the key", () => {
    expect(canonicalize({ a: null })).toBe('{"a":null}');
  });

  it("rejects undefined instead of silently dropping it", () => {
    // A key that vanishes from the signed bytes is the exact difference that
    // passes in a test and fails in production.
    expect(() => canonicalize(undefined)).toThrow(/undefined/);
  });

  it("rejects non-finite numbers, which have no canonical JSON form", () => {
    expect(() => canonicalize({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalize({ a: Infinity })).toThrow(/non-finite/);
  });

  it("escapes strings the same way JSON does", () => {
    expect(canonicalize({ a: 'he said "hi"\n' })).toBe('{"a":"he said \\"hi\\"\\n"}');
  });

  it("handles non-ASCII names, which this platform has by default", () => {
    const out = canonicalize({ name: "Chiamaka Ọlá" });
    expect(JSON.parse(out).name).toBe("Chiamaka Ọlá");
  });
});

describe("contentDigest", () => {
  it("is stable across key insertion order", () => {
    expect(contentDigest({ bmi: 24.1, vitals: [] })).toBe(
      contentDigest({ vitals: [], bmi: 24.1 })
    );
  });

  it("changes when any value changes", () => {
    expect(contentDigest({ bmi: 24.1 })).not.toBe(contentDigest({ bmi: 24.2 }));
  });

  it("is lowercase sha256 hex, as the database CHECK requires", () => {
    expect(contentDigest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("base64url", () => {
  it("round-trips bytes", () => {
    const bytes = Buffer.from([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(base64UrlDecode(base64UrlEncode(bytes)).equals(bytes)).toBe(true);
  });

  it("uses the URL-safe alphabet and strips padding", () => {
    const encoded = base64UrlEncode(Buffer.from([251, 255, 190, 255, 255]));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("round-trips UTF-8 strings", () => {
    const s = 'Ọlá — "quoted"';
    expect(base64UrlDecode(base64UrlEncode(s)).toString("utf8")).toBe(s);
  });
});

describe("sign and verify", () => {
  function signPayload(payload: CredentialPayload, privateKey: ReturnType<typeof keypair>["privateKey"]) {
    const canonical = canonicalize(payload);
    const signature = base64UrlEncode(cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey));
    return { canonical, compact: encodeCompact(canonical, signature) };
  }

  it("verifies a credential it just signed", () => {
    const { privateKey, spkiBase64 } = keypair();
    const { compact } = signPayload(PAYLOAD, privateKey);
    const result = verifyCompact(compact, spkiBase64);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.serial).toBe(PAYLOAD.serial);
  });

  it("rejects a credential signed by a different key", () => {
    const signer = keypair();
    const impostor = keypair();
    const { compact } = signPayload(PAYLOAD, signer.privateKey);
    expect(verifyCompact(compact, impostor.spkiBase64)).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
  });

  it("rejects a credential whose claims were edited after signing", () => {
    // The attack this whole scheme exists to stop: a real document with the
    // name swapped.
    const { privateKey, spkiBase64 } = keypair();
    const { compact } = signPayload(PAYLOAD, privateKey);
    const [format, payloadPart, signaturePart] = compact.split(".");
    const tampered = canonicalize({ ...PAYLOAD, sub: { ...PAYLOAD.sub, name: "Someone Else" } });
    const forged = `${format}.${base64UrlEncode(tampered)}.${signaturePart}`;
    expect(verifyCompact(forged, spkiBase64)).toEqual({
      ok: false,
      reason: "signature_mismatch",
    });
    expect(payloadPart).not.toBe(base64UrlEncode(tampered));
  });

  it("rejects a flipped bit in the signature", () => {
    const { privateKey, spkiBase64 } = keypair();
    const { compact } = signPayload(PAYLOAD, privateKey);
    const [format, payloadPart, signaturePart] = compact.split(".");
    const sig = base64UrlDecode(signaturePart);
    sig[0] ^= 0x01;
    expect(
      verifyCompact(`${format}.${payloadPart}.${base64UrlEncode(sig)}`, spkiBase64)
    ).toEqual({ ok: false, reason: "signature_mismatch" });
  });

  it("verifies against the raw canonical bytes, not a re-serialisation", () => {
    // A verifier who parses the JSON and re-stringifies it gets different bytes
    // and a failed check. Documented in the key endpoint; asserted here.
    const { privateKey, spkiBase64 } = keypair();
    const { canonical } = signPayload(PAYLOAD, privateKey);
    const key = publicKeyFromSpkiBase64(spkiBase64);
    expect(key).not.toBeNull();
    const signature = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey);
    expect(verifySignature(canonical, signature, key!)).toBe(true);
    const reserialised = JSON.stringify(JSON.parse(canonical));
    if (reserialised !== canonical) {
      expect(verifySignature(reserialised, signature, key!)).toBe(false);
    }
  });

  it("carries an attestation through the round trip intact", () => {
    const { privateKey, spkiBase64 } = keypair();
    const attested: CredentialPayload = {
      ...PAYLOAD,
      attestation: {
        doctor_name: "Ada Nwosu",
        credential_type: "MDCN",
        credential_number: "MDCN/R/12345",
        attested_at: "2026-08-06T10:00:00.000Z",
        statement: "Record reviewed and consistent with this patient's chart.",
      },
    };
    const { compact } = signPayload(attested, privateKey);
    const result = verifyCompact(compact, spkiBase64);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.attestation?.credential_number).toBe("MDCN/R/12345");
    }
  });
});

describe("decodeCompact", () => {
  it("returns null rather than throwing on junk from a QR scanner", () => {
    expect(decodeCompact("")).toBeNull();
    expect(decodeCompact("not a credential")).toBeNull();
    expect(decodeCompact("THP1.notbase64!!.sig")).toBeNull();
    expect(decodeCompact("JWT.eyJhIjoxfQ.sig")).toBeNull();
  });

  it("rejects a well-formed payload that is not a passport credential", () => {
    const notOurs = base64UrlEncode(canonicalize({ hello: "world" }));
    expect(decodeCompact(`THP1.${notOurs}.AAAA`)).toBeNull();
  });

  it("rejects an unknown format version rather than guessing", () => {
    const payload = base64UrlEncode(canonicalize(PAYLOAD));
    expect(decodeCompact(`THP2.${payload}.AAAA`)).toBeNull();
  });
});

describe("schema", () => {
  it("refuses an attestation that names a doctor with no registration number", () => {
    // The database refuses this too. Two independent refusals, because an
    // attested passport that cannot name a registered doctor is the exact
    // unverifiable claim the feature exists to stop making.
    const result = credentialPayloadSchema.safeParse({
      ...PAYLOAD,
      attestation: {
        doctor_name: "Ada Nwosu",
        credential_type: "MDCN",
        credential_number: "",
        attested_at: "2026-08-06T10:00:00.000Z",
        statement: null,
      },
    });
    expect(result.success).toBe(false);
  });

  it("refuses a malformed content digest", () => {
    expect(
      credentialPayloadSchema.safeParse({ ...PAYLOAD, content_digest: "nope" }).success
    ).toBe(false);
  });

  it("refuses a credential claiming a different issuer", () => {
    expect(
      credentialPayloadSchema.safeParse({ ...PAYLOAD, iss: "SomeoneElseHealth" }).success
    ).toBe(false);
  });
});

describe("presentation helpers", () => {
  it("groups the short digest for reading aloud", () => {
    expect(shortDigest("0123456789abcdef" + "f".repeat(48))).toBe("0123 4567 89AB CDEF");
  });

  it("chunks a long credential into printable lines", () => {
    const lines = chunk("x".repeat(130), 58);
    expect(lines).toHaveLength(3);
    expect(lines.join("")).toBe("x".repeat(130));
  });

  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });
});
