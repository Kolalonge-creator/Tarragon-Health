import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@react-native-async-storage/async-storage", () => ({ __esModule: true, default: { getItem: jest.fn(), setItem: jest.fn() } }));
jest.mock("expo-crypto", () => ({ digestStringAsync: jest.fn(), CryptoDigestAlgorithm: { SHA256: "SHA-256" }, randomUUID: () => "salt" }));
jest.mock("react-native", () => ({ AppState: { addEventListener: () => ({ remove: () => undefined }) } }));

import { hashPin, pinAllows, type Digest } from "./shared-phone";

// a deterministic stand-in digest: not a real hash, only used to prove the control flow
const fake: Digest = async (s) => `d(${s.length}:${s.split("").reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 1000003, 7)})`;

describe("shared-phone PIN logic", () => {
  it("allows when no PIN is set", async () => {
    expect(await pinAllows({ on: true }, undefined, fake, 3)).toBe(true);
  });
  it("refuses a missing, malformed or wrong PIN and accepts the right one", async () => {
    const stored = { on: true, salt: "s", hash: await hashPin("1234", "s", fake, 3) };
    expect(await pinAllows(stored, undefined, fake, 3)).toBe(false);
    expect(await pinAllows(stored, "12", fake, 3)).toBe(false);
    expect(await pinAllows(stored, "abcd", fake, 3)).toBe(false);
    expect(await pinAllows(stored, "4321", fake, 3)).toBe(false);
    expect(await pinAllows(stored, "1234", fake, 3)).toBe(true);
  });
  it("the same PIN with a different salt gives a different hash", async () => {
    expect(await hashPin("1234", "a", fake, 3)).not.toBe(await hashPin("1234", "b", fake, 3));
  });
});
