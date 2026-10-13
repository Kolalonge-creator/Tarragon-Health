/**
 * The optional programme code at sign-up (S03b, spec 1.8, OQ-41): checked, held pending, never claimed here.
 */

const reportMock = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureMessage: (...a: unknown[]) => reportMock(...a) }));

const rateLimitMock = jest.fn();
jest.mock("@/lib/rate-limit", () => ({ checkAuthRateLimit: (...a: unknown[]) => rateLimitMock(...a) }));

const rpc = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }) }));

import { normaliseCohortCode, readSignupCohortCode } from "./signup-cohort-code";

const form = (code?: string) => {
  const fd = new FormData();
  if (code !== undefined) fd.set("cohortCode", code);
  return fd;
};

beforeEach(() => {
  jest.clearAllMocks();
  rateLimitMock.mockResolvedValue({ success: true });
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("readSignupCohortCode", () => {
  it("is a no-op when no code was typed (the common case): no limiter, no database", async () => {
    for (const fd of [form(), form(""), form("   ")]) {
      expect(await readSignupCohortCode(fd, "en")).toEqual({ ok: true, code: null });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimitMock).not.toHaveBeenCalled();
  });

  it("normalises case, dashes and spaces and asks the database about the normalised code only", async () => {
    expect(await readSignupCohortCode(form("grpa-2345"), "en")).toEqual({ ok: true, code: "GRPA2345" });
    expect(rpc).toHaveBeenCalledWith("check_cohort_code_for_signup", { p_code: "GRPA2345" });
  });

  it("refuses a code that cannot be a cohort code without touching the limiter or the database", async () => {
    for (const bad of ["SHORT", "TOOLONG123", "GRPA23O5", "GRPA2315"]) {
      const res = await readSignupCohortCode(form(bad), "en");
      expect(res).toMatchObject({ ok: false });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gives one answer for unknown, expired, closed and full: the database said no", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const res = await readSignupCohortCode(form("GRPA2345"), "en");
    expect(res).toEqual({ ok: false, error: expect.stringContaining("not valid or has expired") });
  });

  it("is rate limited per IP before the database is asked", async () => {
    rateLimitMock.mockResolvedValue({ success: false });
    expect(await readSignupCohortCode(form("GRPA2345"), "en")).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    expect(rateLimitMock).toHaveBeenCalledWith("signup-cohort-code", null, expect.anything());
  });

  it("a database failure blocks the sign-up with a generic message and is reported without the code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "down" } });
    expect(await readSignupCohortCode(form("GRPA2345"), "en")).toMatchObject({ ok: false });
    expect(JSON.stringify(reportMock.mock.calls)).not.toContain("GRPA2345");
  });
});

describe("normaliseCohortCode", () => {
  it("keeps letters and digits only, upper-cased", () => {
    expect(normaliseCohortCode(" ab-c d.2 ")).toBe("ABCD2");
  });
});
