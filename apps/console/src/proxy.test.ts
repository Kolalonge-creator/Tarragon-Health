/**
 * Console proxy authorisation-boundary tests. Only `updateSession` is mocked;
 * the routing and role logic under test is the real thing. These pin the
 * isolation guarantees the S01d split rests on: a patient (or any role with
 * no console area) never reaches a console page, an anonymous caller never
 * reaches anything but the sign-in pages, an unreadable profile fails closed,
 * and no request header can switch the gate off.
 */
import { NextRequest } from "next/server";

const updateSession = jest.fn();

jest.mock("@tarragon/auth/supabase/middleware", () => ({
  updateSession: (...args: unknown[]) => updateSession(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { proxy, config } = require("./proxy") as typeof import("./proxy");

type SessionOptions = {
  user: { id: string } | null;
  profile?: { role: string } | null;
  aal?: { currentLevel: string | null; nextLevel: string | null } | null;
};

function stubSession({ user, profile = null, aal = null }: SessionOptions) {
  const { NextResponse } = jest.requireActual<typeof import("next/server")>("next/server");
  updateSession.mockImplementation((request: NextRequest) => ({
    response: NextResponse.next({ request }),
    user,
    supabase: {
      auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: aal }) } },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: profile }) }) }) }),
    },
  }));
}

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://console.tarragonhealth.ng"), {
    headers: { host: "console.tarragonhealth.ng", ...headers },
  });
}

const PREFETCH_HEADERS = { "next-router-prefetch": "1", purpose: "prefetch" };
const location = (res: Response) => {
  const raw = res.headers.get("location");
  return raw ? new URL(raw) : null;
};

beforeEach(() => updateSession.mockReset());

describe("matcher config", () => {
  it("never lets a request header decide whether the proxy runs", () => {
    const [entry] = config.matcher as { source: string; missing?: unknown }[];
    expect(entry).toBeDefined();
    expect(entry).not.toHaveProperty("missing");
  });

  it("still covers every page and excludes only assets and liveness", () => {
    const source = (config.matcher as { source: string }[])[0]!.source;
    const re = new RegExp(`^${source}$`);
    expect(re.test("/ngo")).toBe(true);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/clinician/patients/abc")).toBe(true);
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/_next/static/x.js")).toBe(false);
  });
});

describe("anonymous caller", () => {
  it("is sent to login, remembering where they were going", async () => {
    stubSession({ user: null });
    const res = await proxy(request("/ngo?tab=invites"));
    const loc = location(res)!;
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("redirect")).toBe("/ngo?tab=invites");
  });

  it("is sent to login even when claiming to be a prefetch", async () => {
    stubSession({ user: null });
    const res = await proxy(request("/ngo", PREFETCH_HEADERS));
    expect(location(res)!.pathname).toBe("/login");
  });

  it("may see the sign-in pages", async () => {
    stubSession({ user: null });
    expect(location(await proxy(request("/login")))).toBeNull();
    expect(location(await proxy(request("/login/mfa-challenge")))).toBeNull();
  });
});

describe("a role with no console area", () => {
  it.each(["patient", "clinician", "finance", "admin", "care_coordinator"])(
    "%s is never served a console page",
    async (role) => {
      stubSession({ user: { id: "u1" }, profile: { role } });
      const res = await proxy(request("/ngo"));
      expect(location(res)!.pathname).toBe("/login");
    }
  );

  it("may sit on the login page (which explains and offers sign-out) without a redirect loop", async () => {
    stubSession({ user: { id: "u1" }, profile: { role: "patient" } });
    expect(location(await proxy(request("/login")))).toBeNull();
  });
});

describe("unreadable profile row", () => {
  it("fails closed on a console path", async () => {
    stubSession({ user: { id: "u1" }, profile: null });
    expect(location(await proxy(request("/ngo")))!.pathname).toBe("/login");
  });

  it("does not bounce /login to itself", async () => {
    stubSession({ user: { id: "u1" }, profile: null });
    expect(location(await proxy(request("/login")))).toBeNull();
  });
});

describe("MFA step-up gate", () => {
  it("redirects a session that has not completed its TOTP challenge", async () => {
    stubSession({
      user: { id: "u1" },
      profile: { role: "ngo_admin" },
      aal: { currentLevel: "aal1", nextLevel: "aal2" },
    });
    const loc = location(await proxy(request("/ngo")))!;
    expect(loc.pathname).toBe("/login/mfa-challenge");
    expect(loc.searchParams.get("redirect")).toBe("/ngo");
  });

  it("still redirects when the caller claims to be a prefetch", async () => {
    stubSession({
      user: { id: "u1" },
      profile: { role: "ngo_admin" },
      aal: { currentLevel: "aal1", nextLevel: "aal2" },
    });
    expect(location(await proxy(request("/ngo", PREFETCH_HEADERS)))!.pathname).toBe("/login/mfa-challenge");
  });

  it("leaves a session that has completed the challenge alone", async () => {
    stubSession({
      user: { id: "u1" },
      profile: { role: "ngo_admin" },
      aal: { currentLevel: "aal2", nextLevel: "aal2" },
    });
    expect(location(await proxy(request("/ngo")))).toBeNull();
  });
});

describe("a console role", () => {
  beforeEach(() => stubSession({ user: { id: "u1" }, profile: { role: "ngo_admin" } }));

  it("reaches its own area", async () => {
    expect(location(await proxy(request("/ngo")))).toBeNull();
    expect(location(await proxy(request("/ngo/anything")))).toBeNull();
  });

  it("is sent home from / and from /login", async () => {
    expect(location(await proxy(request("/")))!.pathname).toBe("/ngo");
    expect(location(await proxy(request("/login")))!.pathname).toBe("/ngo");
  });

  it("is sent home from a path that is not an extracted area", async () => {
    expect(location(await proxy(request("/clinician")))!.pathname).toBe("/ngo");
    expect(location(await proxy(request("/patient/vitals")))!.pathname).toBe("/ngo");
    expect(location(await proxy(request("/anything-else")))!.pathname).toBe("/ngo");
  });
});
