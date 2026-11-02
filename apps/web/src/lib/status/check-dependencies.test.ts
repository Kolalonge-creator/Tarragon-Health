import { afterEach, describe, expect, it, jest } from "@jest/globals";

type SendsRow = { data: { sent_at: string | null } | null; error: { message: string } | null };
const sendsRpc = jest.fn(async (): Promise<SendsRow> => ({ data: null, error: null }));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({
                limit: () => ({ maybeSingle: () => sendsRpc() }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import {
  checkChannel,
  checkConfigured,
  checkDependencies,
  checkMlService,
  checkSupabase,
} from "./check-dependencies";

const realFetch = global.fetch;
const realEnv = { ...process.env };

afterEach(() => {
  global.fetch = realFetch;
  process.env = { ...realEnv };
});

// `.json()` is included even though checkSupabase's probe() never calls it —
// checkMlService goes through ml-client.ts's safeRequest(), which does call
// response.json() on a 2xx before checkMlService ever sees the result, and a
// response object missing that method throws inside safeRequest's own catch,
// silently degrading to null (i.e. "down") rather than the "up" the test means to stub.
function stubFetch(byUrlFragment: Record<string, { ok: boolean; status?: number }>) {
  global.fetch = jest.fn(async (input: unknown) => {
    const url = String(input);
    const match = Object.entries(byUrlFragment).find(([fragment]) => url.includes(fragment));
    if (!match) return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    const [, spec] = match;
    return {
      ok: spec.ok,
      status: spec.status ?? (spec.ok ? 200 : 500),
      json: async () => ({}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("checkConfigured", () => {
  it("reports configured when the var is set", () => {
    expect(checkConfigured("some-value")).toEqual({ status: "configured" });
  });

  it("reports unconfigured when the var is missing", () => {
    expect(checkConfigured(undefined)).toEqual({ status: "unconfigured" });
  });
});

describe("checkSupabase", () => {
  it("reports down with no project URL configured, without throwing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const result = await checkSupabase();
    expect(result.status).toBe("down");
  });

  it("reports up when GoTrue's health endpoint responds, even with a 2xx", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    stubFetch({ "/auth/v1/health": { ok: true } });
    const result = await checkSupabase();
    expect(result.status).toBe("up");
    expect(result.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("reports up on a 401 — proves the project answered, not that the caller is authorised", async () => {
    // Confirmed empirically against the live project (2026-08-30): GoTrue's
    // /auth/v1/health returns 401 without an apikey header, not 200 — this
    // guards against treating that as "down" again by accident.
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    stubFetch({ "/auth/v1/health": { ok: false, status: 401 } });
    const result = await checkSupabase();
    expect(result.status).toBe("up");
  });

  it("reports down when the request never gets a response at all", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    global.fetch = jest.fn(async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    const result = await checkSupabase();
    expect(result.status).toBe("down");
  });
});

describe("checkMlService", () => {
  it("reports not_deployed, not down, without throwing when ML_SERVICE_URL/KEY are unset", async () => {
    delete process.env.ML_SERVICE_URL;
    delete process.env.ML_SERVICE_KEY;
    const result = await checkMlService();
    expect(result.status).toBe("not_deployed");
  });

  it("reports up when the ML service's own /health responds ok", async () => {
    process.env.ML_SERVICE_URL = "https://ml.example.com";
    process.env.ML_SERVICE_KEY = "test-key";
    stubFetch({ "/health": { ok: true } });
    const result = await checkMlService();
    expect(result.status).toBe("up");
  });

  it("reports down, never throws, when the configured ML service is unreachable", async () => {
    process.env.ML_SERVICE_URL = "https://ml.example.com";
    process.env.ML_SERVICE_KEY = "test-key";
    global.fetch = jest.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    await expect(checkMlService()).resolves.toEqual(
      expect.objectContaining({ status: "down" })
    );
  });
});

describe("checkDependencies", () => {
  it("assembles all the checks without throwing, using presence-only checks for providers", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    delete process.env.ML_SERVICE_URL;
    process.env.TERMII_API_KEY = "set";
    stubFetch({ "/auth/v1/health": { ok: true } });

    const report = await checkDependencies();

    expect(report.supabase.status).toBe("up");
    expect(report.ml_service.status).toBe("not_deployed");
    sendsRpc.mockResolvedValue({ data: null, error: null });
    expect(report.termii).toEqual({ status: "configured", evidence: "env" });
    expect(typeof report.checked_at).toBe("string");
  });
});

describe("checkChannel: email and SMS are judged by evidence of sends, because the edge sender holds the keys", () => {
  it("a successful send inside the window counts as configured even with no env var in this process", async () => {
    sendsRpc.mockResolvedValueOnce({ data: { sent_at: "2026-11-02T13:25:45.924Z" }, error: null });
    expect(await checkChannel("email", undefined)).toEqual({ status: "configured", evidence: "recent_send", last_sent_at: "2026-11-02T13:25:45.924Z" });
  });
  it("no send and no env var is unconfigured; a failed read is unconfigured, never a throw", async () => {
    sendsRpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await checkChannel("sms", undefined)).toEqual({ status: "unconfigured" });
    sendsRpc.mockRejectedValueOnce(new Error("boom"));
    expect(await checkChannel("sms", undefined)).toEqual({ status: "unconfigured" });
  });
  it("the env var alone is enough and skips the database", async () => {
    sendsRpc.mockClear();
    expect(await checkChannel("email", "re_key")).toEqual({ status: "configured", evidence: "env" });
    expect(sendsRpc).not.toHaveBeenCalled();
  });
});
