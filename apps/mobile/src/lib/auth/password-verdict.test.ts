import { checkPasswordAcceptable } from "@tarragon/auth/password-check";
import { checkNewPassword, sha1HexUpper } from "./password-verdict";

describe("sha1HexUpper", () => {
  it("returns uppercase SHA-1 hex (known vector for 'password')", async () => {
    expect(await sha1HexUpper("password")).toBe("5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8");
  });
});

describe("checkNewPassword", () => {
  const sha = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";

  function rangeFetch(body: string, status = 200): typeof fetch {
    return (async () => new Response(body, { status })) as unknown as typeof fetch;
  }

  it("rejects a too-short password with the rule message key", async () => {
    expect(await checkNewPassword("short")).toEqual({ ok: false, key: "auth.password.rule" });
  });

  it("rejects a breached password using only a 5 char prefix on the wire", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string) => {
      urls.push(url);
      return new Response(`${sha.slice(5)}:9545824\r\nAAAAA:1`, { status: 200 });
    }) as unknown as typeof fetch;
    const out = await checkNewPassword("password", (p, o) => checkPasswordAcceptable(p, { ...o, fetchImpl }));
    expect(out).toEqual({ ok: false, key: "auth.password.breached" });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/range\/5BAA6$/);
    expect(urls[0]).not.toContain(sha.slice(5));
  });

  it("allows a clean password", async () => {
    const out = await checkNewPassword("a-very-unusual-passphrase", (p, o) =>
      checkPasswordAcceptable(p, { ...o, fetchImpl: rangeFetch("AAAAA:1") }),
    );
    expect(out).toEqual({ ok: true });
  });

  it("fails open when the range service is down", async () => {
    const out = await checkNewPassword("a-very-unusual-passphrase", (p, o) =>
      checkPasswordAcceptable(p, { ...o, fetchImpl: rangeFetch("", 503) }),
    );
    expect(out).toEqual({ ok: true });
  });
});
