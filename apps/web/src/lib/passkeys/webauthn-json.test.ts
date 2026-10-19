/**
 * The browser-side WebAuthn glue: base64url both ways, JSON options to native options, a cancelled prompt versus a failure, and
 * the small "this device has used a passkey" note that decides whether the sign-in page offers the button.
 */
import {
  base64UrlToBytes,
  bytesToBase64Url,
  ceremonyFailureReason,
  creationOptionsFromJSON,
  forgetPasskeyOnThisDevice,
  PASSKEY_DEVICE_NOTE,
  passkeyHintedOnThisDevice,
  rememberPasskeyOnThisDevice,
  requestOptionsFromJSON,
  webAuthnSupported,
} from "./webauthn-json";

describe("base64url", () => {
  it("round-trips every byte value, with no padding and url-safe characters", () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const text = bytesToBase64Url(all);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Array.from(base64UrlToBytes(text))).toEqual(Array.from(all));
  });

  it("decodes values whose length needs 0, 1 and 2 padding characters", () => {
    for (const bytes of [[1], [1, 2], [1, 2, 3], [255, 254, 253, 252]]) {
      const text = bytesToBase64Url(new Uint8Array(bytes));
      expect(text.includes("=")).toBe(false);
      expect(Array.from(base64UrlToBytes(text))).toEqual(bytes);
    }
  });
});

describe("options conversion", () => {
  it("turns the challenge, user id and excluded credentials of a registration into bytes", () => {
    const out = creationOptionsFromJSON({
      rp: { id: "tarragonhealth.ng", name: "Tarragon Health" },
      user: { id: bytesToBase64Url(new Uint8Array([9, 8, 7])), name: "ada", displayName: "Ada" },
      challenge: bytesToBase64Url(new Uint8Array([1, 2, 3])),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      excludeCredentials: [{ id: bytesToBase64Url(new Uint8Array([4, 5])), type: "public-key" }],
    });
    expect(Array.from(out.challenge as Uint8Array)).toEqual([1, 2, 3]);
    expect(Array.from(out.user.id as Uint8Array)).toEqual([9, 8, 7]);
    expect(Array.from(out.excludeCredentials?.[0]?.id as Uint8Array)).toEqual([4, 5]);
    expect(out.rp.id).toBe("tarragonhealth.ng");
  });

  it("turns the challenge of a sign-in into bytes and keeps an empty allow-list empty (a discoverable passkey)", () => {
    const out = requestOptionsFromJSON({ challenge: bytesToBase64Url(new Uint8Array([7, 7])), rpId: "tarragonhealth.ng" });
    expect(Array.from(out.challenge as Uint8Array)).toEqual([7, 7]);
    expect(out.allowCredentials).toBeUndefined();
  });
});

describe("ceremonyFailureReason", () => {
  it("treats a cancelled or timed-out prompt as cancelled, anything else as a failure", () => {
    expect(ceremonyFailureReason({ name: "NotAllowedError" })).toBe("cancelled");
    expect(ceremonyFailureReason({ name: "AbortError" })).toBe("cancelled");
    expect(ceremonyFailureReason({ name: "InvalidStateError" })).toBe("failed");
    expect(ceremonyFailureReason(new Error("x"))).toBe("failed");
    expect(ceremonyFailureReason(null)).toBe("failed");
    expect(ceremonyFailureReason("boom")).toBe("failed");
  });
});

describe("support and the device note (no browser here)", () => {
  it("says unsupported when there is no window, and never throws on a missing or blocked store", () => {
    expect(webAuthnSupported()).toBe(false);
    expect(passkeyHintedOnThisDevice()).toBe(false);
    expect(() => rememberPasskeyOnThisDevice()).not.toThrow();
    expect(() => forgetPasskeyOnThisDevice()).not.toThrow();
  });

  it("remembers and forgets with a working store, and reads false when the store throws", () => {
    const store = new Map<string, string>();
    const local = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    (globalThis as unknown as { window: unknown }).window = { localStorage: local };
    try {
      expect(passkeyHintedOnThisDevice()).toBe(false);
      rememberPasskeyOnThisDevice();
      expect(store.get(PASSKEY_DEVICE_NOTE)).toBe("1");
      expect(passkeyHintedOnThisDevice()).toBe(true);
      forgetPasskeyOnThisDevice();
      expect(passkeyHintedOnThisDevice()).toBe(false);

      (globalThis as unknown as { window: unknown }).window = {
        localStorage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {
            throw new Error("blocked");
          },
          removeItem: () => {
            throw new Error("blocked");
          },
        },
      };
      expect(passkeyHintedOnThisDevice()).toBe(false);
      expect(() => rememberPasskeyOnThisDevice()).not.toThrow();
      expect(() => forgetPasskeyOnThisDevice()).not.toThrow();
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
