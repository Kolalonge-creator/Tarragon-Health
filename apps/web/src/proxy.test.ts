/**
 * Proxy authorization-boundary tests.
 *
 * These cover the two ways this file has been able to hand out an
 * unauthorized response without failing loudly:
 *
 *  1. A client-supplied header skipping the proxy entirely via the matcher's
 *     `missing:` clause — which took the MFA step-up gate, the supporter
 *     default-deny gate and every role redirect with it.
 *  2. `profile` coming back null and the function continuing anyway, past
 *     every check that is derived from that row.
 *
 * Only `updateSession` is mocked — the routing/role logic under test is the
 * real thing.
 */
import { NextRequest } from "next/server";

const updateSession = jest.fn();

jest.mock("@/lib/supabase/middleware", () => ({
  updateSession: (...args: unknown[]) => updateSession(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { proxy, config } = require("./proxy") as typeof import("./proxy");

type ProfileRow = {
  role: string;
  custom_role_id: string | null;
  receives_care: boolean | null;
} | null;

type SessionOptions = {
  user: { id: string } | null;
  profile?: ProfileRow;
  /** What auth.mfa.getAuthenticatorAssuranceLevel() reports. */
  aal?: { currentLevel: string | null; nextLevel: string | null } | null;
};

function stubSession({ user, profile = null, aal = null }: SessionOptions) {
  const { NextResponse } = jest.requireActual<typeof import("next/server")>(
    "next/server"
  );
  updateSession.mockImplementation((request: NextRequest) => ({
    response: NextResponse.next({ request }),
    user,
    supabase: {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: aal }),
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: profile }),
          }),
        }),
      }),
    },
  }));
}

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "https://app.tarragonhealth.ng"), {
    headers: { host: "app.tarragonhealth.ng", ...headers },
  });
}

/** Headers Next sends on its own Link prefetches — and that anyone can send. */
const PREFETCH_HEADERS = {
  "next-router-prefetch": "1",
  purpose: "prefetch",
};

beforeEach(() => {
  updateSession.mockReset();
});

describe("matcher config", () => {
  it("never lets a request header decide whether the proxy runs", () => {
    // `missing`/`has` are evaluated against raw client-supplied headers, so
    // either one turns this gate into an opt-out. The specific regression:
    // `missing: [{ header: next-router-prefetch }, { header: purpose=prefetch }]`,
    // which let `curl -H 'purpose: prefetch'` skip the MFA and supporter gates.
    for (const entry of config.matcher) {
      expect(entry).not.toHaveProperty("missing");
      expect(entry).not.toHaveProperty("has");
    }
  });

  it("still runs over the protected role areas", () => {
    const [{ source }] = config.matcher;
    const pattern = new RegExp(`^${source}$`);
    expect(pattern.test("/patient/vitals")).toBe(true);
    expect(pattern.test("/clinician/patients")).toBe(true);
    // Unchanged exclusions.
    expect(pattern.test("/api/status")).toBe(false);
    expect(pattern.test("/_next/static/chunk.js")).toBe(false);
  });
});

describe("MFA step-up gate", () => {
  const mfaPending = { currentLevel: "aal1", nextLevel: "aal2" };

  it("redirects a session that has not completed its TOTP challenge", async () => {
    stubSession({ user: { id: "u1" }, aal: mfaPending });
    const res = await proxy(request("/clinician/patients"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login/mfa-challenge");
  });

  it("still redirects when the caller claims to be a prefetch", async () => {
    // The headers that used to skip this function entirely at the matcher.
    stubSession({ user: { id: "u1" }, aal: mfaPending });
    const res = await proxy(request("/clinician/patients", PREFETCH_HEADERS));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login/mfa-challenge");
  });

  it("leaves a session that has completed the challenge alone", async () => {
    stubSession({
      user: { id: "u1" },
      aal: { currentLevel: "aal2", nextLevel: "aal2" },
      profile: { role: "clinician", custom_role_id: null, receives_care: null },
    });
    const res = await proxy(request("/clinician/patients"));
    expect(res.status).toBe(200);
  });
});

describe("unreadable profile row", () => {
  it("fails closed on a protected path", async () => {
    stubSession({ user: { id: "u1" }, profile: null });
    const res = await proxy(request("/patient/vitals"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain("redirect=%2Fpatient%2Fvitals");
  });

  it("fails closed even when the caller claims to be a prefetch", async () => {
    stubSession({ user: { id: "u1" }, profile: null });
    const res = await proxy(request("/clinician/patients", PREFETCH_HEADERS));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("does not bounce /login to itself", async () => {
    stubSession({ user: { id: "u1" }, profile: null });
    const res = await proxy(request("/login"));
    expect(res.status).toBe(200);
  });

  // Control: the redirects above must come from the missing row, not from
  // the path being protected at all.
  it("lets a readable profile through to its own role area", async () => {
    stubSession({
      user: { id: "u1" },
      profile: { role: "patient", custom_role_id: null, receives_care: true },
    });
    const res = await proxy(request("/patient/vitals"));
    expect(res.status).toBe(200);
  });
});

describe("supporter default-deny gate", () => {
  const supporter = {
    role: "patient",
    custom_role_id: null,
    receives_care: false,
  };

  it("refuses a clinical patient surface", async () => {
    stubSession({ user: { id: "u1" }, profile: supporter });
    const res = await proxy(request("/patient/vitals"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/patient/supporting");
  });

  it("still refuses it when the caller claims to be a prefetch", async () => {
    stubSession({ user: { id: "u1" }, profile: supporter });
    const res = await proxy(request("/patient/vitals", PREFETCH_HEADERS));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/patient/supporting");
  });

  it("still allows the surfaces a supporter is here for", async () => {
    stubSession({ user: { id: "u1" }, profile: supporter });
    const res = await proxy(request("/patient/supporting"));
    expect(res.status).toBe(200);
  });
});

describe("marketing pages on the app host", () => {
  // Every public page was reachable and crawlable on app.* as well as the root
  // domain: a duplicate of the whole marketing site, saved from an indexing
  // penalty only by the canonical tags.
  it("redirects a marketing path on app.* to the root domain, permanently", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(request("/pricing"));

    expect(res.status).toBe(308);
    const location = new URL(res.headers.get("location") as string);
    expect(location.hostname).toBe("tarragonhealth.ng");
    expect(location.pathname).toBe("/pricing");
  });

  it("keeps the port, so app.localhost:3000 goes to localhost:3000 in development", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(
      new NextRequest(new URL("/pricing", "http://app.localhost:3000"), {
        headers: { host: "app.localhost:3000" },
      })
    );

    expect(res.status).toBe(308);
    const location = new URL(res.headers.get("location") as string);
    expect(location.hostname).toBe("localhost");
    expect(location.port).toBe("3000");
  });

  it("still resolves / on the app host to the role home rather than redirecting off it", async () => {
    // "/" is a legitimate platform entry point on app.*, which is why the
    // marketing redirect sits after that branch and excludes it.
    stubSession({
      user: { id: "u1" },
      profile: { role: "patient", custom_role_id: null, receives_care: true },
    });
    const res = await proxy(request("/"));

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/patient");
  });

  it("leaves a platform path on the app host alone", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(request("/patient/vitals"));

    // Bounced to login because there is no session, NOT redirected to the
    // root domain.
    const location = res.headers.get("location");
    expect(location).not.toBeNull();
    expect(new URL(location as string).hostname).toBe("app.tarragonhealth.ng");
  });
});
