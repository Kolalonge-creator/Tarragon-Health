import { describe, expect, it, jest } from "@jest/globals";
import { checkBreachedPassword, sha1HexWebCrypto } from "./breached-password";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PREFIX = "5BAA6";
const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

const respond = (body: string, ok = true) =>
  jest.fn(async () => ({ ok, text: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe("checkBreachedPassword", () => {
  it("hashes with SHA-1 (sanity check on the known vector)", async () => {
    expect(await sha1HexWebCrypto("password")).toBe(PREFIX + SUFFIX);
  });

  it("sends ONLY the five-character prefix, never the password or full hash", async () => {
    const fetchImpl = respond(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${SUFFIX}:3861493`);
    const result = await checkBreachedPassword("password", { fetchImpl });
    expect(result).toEqual({ status: "breached", count: 3861493 });
    const url = String((fetchImpl as unknown as jest.Mock).mock.calls[0]![0]);
    expect(url.endsWith(`/range/${PREFIX}`)).toBe(true);
    expect(url).not.toContain(SUFFIX);
    expect(new URL(url).pathname).toBe(`/range/${PREFIX}`);
  });

  it("reports clean when the suffix is absent", async () => {
    const result = await checkBreachedPassword("password", { fetchImpl: respond("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:2") });
    expect(result).toEqual({ status: "clean" });
  });

  it("ignores padded decoy rows (count 0)", async () => {
    const result = await checkBreachedPassword("password", { fetchImpl: respond(`${SUFFIX}:0`) });
    expect(result).toEqual({ status: "clean" });
  });

  it("fails open as 'unknown' on a non-200, a network error and a timeout", async () => {
    expect(await checkBreachedPassword("x", { fetchImpl: respond("", false) })).toEqual({ status: "unknown" });
    const boom = jest.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await checkBreachedPassword("x", { fetchImpl: boom })).toEqual({ status: "unknown" });
    const hang = ((_u: string, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    expect(await checkBreachedPassword("x", { fetchImpl: hang, timeoutMs: 20 })).toEqual({ status: "unknown" });
  });

  it("accepts an injected hasher for runtimes without Web Crypto", async () => {
    const sha1Hex = jest.fn(async () => (PREFIX + SUFFIX).toLowerCase());
    const result = await checkBreachedPassword("anything", { fetchImpl: respond(`${SUFFIX}:5`), sha1Hex });
    expect(result).toEqual({ status: "breached", count: 5 });
  });
});
