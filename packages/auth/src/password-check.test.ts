import { describe, expect, it, jest } from "@jest/globals";
import { BREACHED_PASSWORD_MESSAGE, checkPasswordAcceptable } from "./password-check";

const SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8"; // SHA-1("password") minus the 5BAA6 prefix
const respond = (body: string, ok = true) =>
  jest.fn(async () => ({ ok, text: async () => body }) as unknown as Response) as unknown as typeof fetch;

describe("checkPasswordAcceptable", () => {
  it("rejects a short password without any network call", async () => {
    const fetchImpl = respond("");
    const v = await checkPasswordAcceptable("short", { fetchImpl });
    expect(v).toMatchObject({ ok: false, reason: "too_short" });
    expect((fetchImpl as unknown as jest.Mock).mock.calls.length).toBe(0);
  });

  it("rejects a breached password with the shared message", async () => {
    const v = await checkPasswordAcceptable("password", { fetchImpl: respond(`${SUFFIX}:99`) });
    expect(v).toEqual({ ok: false, reason: "breached", message: BREACHED_PASSWORD_MESSAGE });
  });

  it("accepts a clean password and reports breach=clean", async () => {
    const v = await checkPasswordAcceptable("a-long-unusual-passphrase-42", { fetchImpl: respond("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA:1") });
    expect(v).toEqual({ ok: true, breach: "clean" });
  });

  it("fails open when the range service is down, but says so", async () => {
    const v = await checkPasswordAcceptable("a-long-unusual-passphrase-42", { fetchImpl: respond("", false) });
    expect(v).toEqual({ ok: true, breach: "unknown" });
  });
});
