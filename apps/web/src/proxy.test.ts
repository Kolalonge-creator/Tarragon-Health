/**
 * Proxy authorisation-boundary tests.
 *
 * These cover the two ways this file has been able to hand out an
 * unauthorised response without failing loudly:
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

// The phone app's bearer client, for the 2FA requirement on /api/mobile/*.
const bearerRpc = jest.fn();
jest.mock("@/lib/supabase/bearer", () => ({
  createBearerClient: () => ({ rpc: (...args: unknown[]) => bearerRpc(...args) }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { proxy, config } = require("./proxy") as typeof import("./proxy");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { resetMfaRequirementCache } = require("@tarragon/auth/mfa-policy") as typeof import("@tarragon/auth/mfa-policy");

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
  /** The 2FA group requirement RPCs. Default: no group is on (the shipped state). */
  mfa?: { anyOn: boolean; required: boolean; error?: { code: string } };
};

const rpcCalls: string[] = [];

function stubSession({ user, profile = null, aal = null, mfa = { anyOn: false, required: false } }: SessionOptions) {
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
      rpc: async (fn: string) => {
        rpcCalls.push(fn);
        if (fn === "mfa_required_roles") return { data: mfa.anyOn ? ["admin", "care_coordinator", "clinician", "ngo_admin", "patient"] : [], error: null };
        if (fn === "my_mfa_requirement") {
          return mfa.error
            ? { data: null, error: mfa.error }
            : { data: [{ required: mfa.required, has_verified_factor: false }], error: null };
        }
        throw new Error(`unexpected rpc ${fn}`);
      },
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
  rpcCalls.length = 0;
  resetMfaRequirementCache();
  bearerRpc.mockReset();
  bearerRpc.mockResolvedValue({ data: [], error: null });
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
    // SR1: the deep health check is secret-authenticated and must answer even when Supabase Auth is down.
    expect(pattern.test("/api/health/deep")).toBe(false);
    expect(pattern.test("/api/healthcheck-lookalike")).toBe(true);
    // Anonymous CSP violation reports skip the session and 2FA work.
    expect(pattern.test("/api/csp-report")).toBe(false);
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

  it("keeps the query of a signed document link through the challenge (OQ-336)", async () => {
    stubSession({ user: { id: "u1" }, aal: mfaPending });
    const res = await proxy(request("/d/care-plan/u1?e=1760000000&s=abc"));
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/login/mfa-challenge");
    expect(loc.searchParams.get("redirect")).toBe("/d/care-plan/u1?e=1760000000&s=abc");
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

  // S29 Care Circle: a supporter-only account joins by a link, reads one page about the person, and pays for them.
  it.each([
    "/patient/supporting/join/abcdefghijklmnopqrstuvwxyz0123456789",
    "/patient/supporting/circle/11111111-2222-4333-8444-555555555555",
    "/patient/supporting/circle/11111111-2222-4333-8444-555555555555/pay",
    "/patient/membership/paid",
    // the supporter menu links here, and the page is for any patient account, support-only included
    "/patient/screening-days",
  ])("allows %s", async (path) => {
    stubSession({ user: { id: "u1" }, profile: supporter });
    const res = await proxy(request(path));
    expect(res.status).toBe(200);
  });

  it.each(["/patient/membership", "/patient/care-circle"])("still refuses %s (a supporter-only account has no plan or circle of its own)", async (path) => {
    stubSession({ user: { id: "u1" }, profile: supporter });
    const res = await proxy(request(path));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/patient/supporting");
  });
});

describe("Care Circle join link opened while signed out (supporter join path)", () => {
  const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789_-AB";

  it("sends a signed-out visitor to the landing, not to a bare sign-in form, with no Referer", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(request(`/patient/supporting/join/${TOKEN}`));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") as string).pathname).toBe(`/circle/join/${TOKEN}`);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
  });

  it("does not carry a malformed token: that falls back to the ordinary sign-in redirect", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(request("/patient/supporting/join/not%20a%20token"));
    expect(new URL(res.headers.get("location") as string).pathname).toBe("/login");
  });

  it("serves the landing itself to anyone, signed in or not, with no Referer", async () => {
    stubSession({ user: null, profile: null });
    const res = await proxy(request(`/circle/join/${TOKEN}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
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

describe("staff areas extracted to apps/console", () => {
  const original = process.env.CONSOLE_BASE_URL;
  afterEach(() => {
    if (original === undefined) delete process.env.CONSOLE_BASE_URL;
    else process.env.CONSOLE_BASE_URL = original;
  });

  it("redirects an extracted area to the console host, keeping path and query, before touching the session", async () => {
    process.env.CONSOLE_BASE_URL = "https://console.tarragonhealth.ng";
    const res = await proxy(request("/ngo/roster?tab=invites"));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://console.tarragonhealth.ng/ngo/roster?tab=invites");
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("redirects even when the caller claims to be a prefetch", async () => {
    process.env.CONSOLE_BASE_URL = "https://console.tarragonhealth.ng";
    const res = await proxy(request("/ngo", PREFETCH_HEADERS));

    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://console.tarragonhealth.ng/ngo");
  });

  it("does not redirect an area that has not been extracted", async () => {
    process.env.CONSOLE_BASE_URL = "https://console.tarragonhealth.ng";
    stubSession({
      user: { id: "u1" },
      profile: { role: "clinician", custom_role_id: null, receives_care: null },
    });
    const res = await proxy(request("/clinician/worklist"));

    expect(res.headers.get("location")).toBeNull();
  });

  it("redirects nobody when no console is configured, so shipping this first is safe", async () => {
    delete process.env.CONSOLE_BASE_URL;
    stubSession({ user: null, profile: null });
    const res = await proxy(request("/ngo"));

    expect(res.headers.get("location")).not.toContain("console");
  });
});

describe("mobile API rate limit (OQ-267)", () => {
  it("answers 429 with Retry-After once one session passes its allowance, and never reaches the session logic for that request", async () => {
    stubSession({ user: null, profile: null });
    const headers = { authorization: "Bearer proxy-test-session-a", "x-forwarded-for": "10.20.30.1" };
    for (let i = 0; i < 240; i++) {
      const res = await proxy(request("/api/mobile/lifestyle", headers));
      expect(res.status).not.toBe(429);
    }
    updateSession.mockClear();
    const blocked = await proxy(request("/api/mobile/lifestyle", headers));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("does not limit the other sessions on the same shared address, nor non-mobile paths", async () => {
    stubSession({ user: null, profile: null });
    const other = await proxy(request("/api/mobile/lifestyle", { authorization: "Bearer proxy-test-session-b", "x-forwarded-for": "10.20.30.1" }));
    expect(other.status).not.toBe(429);
    const web = await proxy(request("/login", { authorization: "Bearer proxy-test-session-a", "x-forwarded-for": "10.20.30.1" }));
    expect(web.status).not.toBe(429);
  });
});

describe("2FA required per group", () => {
  const clinician = { role: "clinician", custom_role_id: null, receives_care: null };
  const patient = { role: "patient", custom_role_id: null, receives_care: true };
  const noFactor = { currentLevel: "aal1", nextLevel: "aal1" };

  it("changes nothing while no group is on (the shipped state), and never asks for the caller's own answer", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor });
    const res = await proxy(request("/clinician/patients"));
    expect(res.headers.get("location")).toBeNull();
    expect(rpcCalls).toEqual(["mfa_required_roles"]);
  });

  it("caches 'no group is on' so a second request costs no database call", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor });
    await proxy(request("/clinician/patients"));
    await proxy(request("/clinician/escalations"));
    expect(rpcCalls).toEqual(["mfa_required_roles"]);
  });

  it("sends a required account without a factor to Profile & settings, keeping where it was going", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/clinician/patients?tab=open"));
    const loc = new URL(res.headers.get("location") ?? "");
    expect(loc.pathname).toBe("/account");
    expect(loc.searchParams.get("mfa")).toBe("required");
    expect(loc.searchParams.get("redirect")).toBe("/clinician/patients?tab=open");
  });

  it("applies to patients when the patient group is on", async () => {
    stubSession({ user: { id: "u1" }, profile: patient, aal: noFactor, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/patient/vitals"));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/account");
  });

  it("refuses an API call with 403 instead of redirecting it", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/api/admin/search"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("mfa_enrolment_required");
  });

  it("lets the account reach the set-up page itself, so it is never trapped in a loop", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/account?mfa=required"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("leaves the public pages open, so a held account can still sign out and sign in again", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/login"));
    expect(new URL(res.headers.get("location") ?? "").pathname).not.toBe("/account");
    expect(rpcCalls).toEqual([]);
  });

  it("asks nothing per request for a role with no group on, while another group is on", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: true } });
    // Only the patient group is on: the clinician is never asked about, so a wrong "required" answer cannot hold them.
    updateSession.mockImplementationOnce((req: NextRequest) => {
      const base = updateSession.getMockImplementation()!(req) as { supabase: { rpc: (fn: string) => Promise<unknown> } };
      return {
        ...base,
        supabase: {
          ...base.supabase,
          rpc: async (fn: string) => {
            rpcCalls.push(fn);
            if (fn === "mfa_required_roles") return { data: ["patient"], error: null };
            return { data: [{ required: true, has_verified_factor: false }], error: null };
          },
        },
      };
    });
    const res = await proxy(request("/clinician/patients"));
    expect(res.headers.get("location")).toBeNull();
    expect(rpcCalls).toEqual(["mfa_required_roles"]);
  });

  it("does not hold an account in another group", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: false } });
    const res = await proxy(request("/clinician/patients"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("sends a required account WITH a factor to the challenge, not to set-up", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: { currentLevel: "aal1", nextLevel: "aal2" }, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/clinician/patients"));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login/mfa-challenge");
  });

  it("lets a required account through once its session is AAL2, without asking the database", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: { currentLevel: "aal2", nextLevel: "aal2" }, mfa: { anyOn: true, required: true } });
    const res = await proxy(request("/clinician/patients"));
    expect(res.headers.get("location")).toBeNull();
    expect(rpcCalls).toEqual([]);
  });

  it("fails closed when the account's own requirement cannot be read", async () => {
    stubSession({ user: { id: "u1" }, profile: clinician, aal: noFactor, mfa: { anyOn: true, required: false, error: { code: "57014" } } });
    const res = await proxy(request("/clinician/patients"));
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/account");
  });
});

describe("2FA required per group, phone app (/api/mobile/*, bearer token)", () => {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tokenWith = (aal: string) => `${b64url({ alg: "HS256" })}.${b64url({ sub: "u1", aal })}.sig`;
  const mobile = (path: string, aal: string, method = "GET") =>
    new NextRequest(new URL(path, "https://app.tarragonhealth.ng"), {
      method,
      headers: { host: "app.tarragonhealth.ng", authorization: `Bearer ${tokenWith(aal)}` },
    });
  const answers = (anyOn: boolean, mine: { data: unknown; error: unknown }) =>
    bearerRpc.mockImplementation(async (fn: string) =>
      fn === "mfa_required_roles" ? { data: anyOn ? ["admin", "care_coordinator", "clinician", "ngo_admin", "patient"] : [], error: null } : mine,
    );

  beforeEach(() => {
    bearerRpc.mockReset();
    // No cookie session on a phone request.
    stubSession({ user: null });
  });

  it("changes nothing while no group is on", async () => {
    answers(false, { data: [], error: null });
    const res = await proxy(mobile("/api/mobile/lifestyle", "aal1"));
    expect(res.status).not.toBe(403);
    expect(bearerRpc).toHaveBeenCalledTimes(1);
  });

  it("refuses an AAL1 token from an account in a required group, factor or not", async () => {
    answers(true, { data: [{ required: true, has_verified_factor: true }], error: null });
    const res = await proxy(mobile("/api/mobile/lifestyle", "aal1"));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("mfa_required");
  });

  it("lets an account in another group through", async () => {
    answers(true, { data: [{ required: false, has_verified_factor: false }], error: null });
    expect((await proxy(mobile("/api/mobile/vitals", "aal1"))).status).not.toBe(403);
  });

  it("lets an AAL2 token through without asking", async () => {
    answers(true, { data: [{ required: true, has_verified_factor: true }], error: null });
    expect((await proxy(mobile("/api/mobile/vitals", "aal2"))).status).not.toBe(403);
    expect(bearerRpc).not.toHaveBeenCalled();
  });

  it("never refuses SENDING to a safety route (a reading, a symptom, an emergency)", async () => {
    answers(true, { data: [{ required: true, has_verified_factor: false }], error: null });
    expect((await proxy(mobile("/api/mobile/vitals", "aal1", "POST"))).status).not.toBe(403);
    expect((await proxy(mobile("/api/mobile/emergency-card", "aal1"))).status).not.toBe(403);
  });

  it("never refuses the safety flows' own reads either (the symptom checker's open state, check-backs due)", async () => {
    answers(true, { data: [{ required: true, has_verified_factor: false }], error: null });
    expect((await proxy(mobile("/api/mobile/symptom-check", "aal1", "GET"))).status).not.toBe(403);
    expect((await proxy(mobile("/api/mobile/symptom-checkback", "aal1", "GET"))).status).not.toBe(403);
  });

  it("finds an AAL1 token in ?token= too, the way the PDF routes do", async () => {
    answers(true, { data: [{ required: true, has_verified_factor: false }], error: null });
    const res = await proxy(
      new NextRequest(new URL(`/api/mobile/prescriptions/pdf?token=${tokenWith("aal1")}`, "https://app.tarragonhealth.ng"), {
        headers: { host: "app.tarragonhealth.ng" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("passes a failed lookup through, so an expired token still gets the route's 401", async () => {
    answers(true, { data: null, error: { code: "PGRST303", message: "JWT expired" } });
    expect((await proxy(mobile("/api/mobile/vitals", "aal1"))).status).not.toBe(403);
  });
});

describe("report-only nonce script policy", () => {
  it("puts the same fresh nonce policy on the forwarded request and the response for an app-host page", async () => {
    stubSession({ user: null });
    const res = await proxy(request("/login"));
    const policy = res.headers.get("content-security-policy-report-only");
    expect(policy).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'/);
    expect(policy).toContain("report-uri /api/csp-report");
    // Next reads the nonce from the request header; updateSession forwards it (x-middleware-request-*).
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(policy);
    // Never the enforcing header: this step only reports.
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("uses a different nonce on every request", async () => {
    stubSession({ user: null });
    const a = (await proxy(request("/login"))).headers.get("content-security-policy-report-only");
    const b = (await proxy(request("/login"))).headers.get("content-security-policy-report-only");
    expect(a).not.toEqual(b);
  });

  it("adds wasm eval only on the in-app consultation call pages", async () => {
    stubSession({ user: null });
    const call = await proxy(request("/patient/consultation/0b7e2f7a-1111-4a4a-9999-123456789abc"));
    expect(call.headers.get("content-security-policy-report-only")).toContain("'wasm-unsafe-eval'");
    const other = await proxy(request("/login"));
    expect(other.headers.get("content-security-policy-report-only")).not.toContain("wasm-unsafe-eval");
  });

  it("leaves the marketing host and API routes alone", async () => {
    stubSession({ user: null });
    const marketing = await proxy(
      new NextRequest(new URL("/pricing", "https://tarragonhealth.ng"), { headers: { host: "tarragonhealth.ng" } }),
    );
    expect(marketing.headers.get("content-security-policy-report-only")).toBeNull();
    const api = await proxy(request("/api/csp-report"));
    expect(api.headers.get("content-security-policy-report-only")).toBeNull();
  });
});
