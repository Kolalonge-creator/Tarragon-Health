/**
 * Regression test for the same data-loss bug class the signup, patient
 * location, and guest checkout forms were fixed for: React resets every
 * uncontrolled field in an action-bound <form> once the action returns,
 * success or failure. `submitLead` originally returned only `{error}` on
 * failure, so ContactForm's name/contact/role/message inputs had nothing
 * fresh to fall back to — a Zod rejection on one field, a missing service
 * role key, or a transient DB insert failure would silently wipe the whole
 * marketing contact form (used by prospective patients, employers, and
 * HMOs) and force a full re-type.
 */

const insert = jest.fn();
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({
    from: () => ({ insert: (...args: unknown[]) => insert(...args) }),
  }),
}));

import { submitLead } from "./actions";

function formDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("name", "Ada Lovelace");
  fd.set("contact", "ada@example.com");
  fd.set("role", "patient");
  fd.set("message", "I'd like to know more about the chronic care programme.");
  fd.set("source", "homepage");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("submitLead — submitted values survive a failed submission", () => {
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    insert.mockReset();
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
  });

  afterAll(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("echoes back every submitted field when Zod validation fails", async () => {
    const result = await submitLead(undefined, formDataFor({ contact: "x" }));

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      name: "Ada Lovelace",
      contact: "x",
      role: "patient",
      message: "I'd like to know more about the chronic care programme.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when the service role key isn't configured", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const result = await submitLead(undefined, formDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      name: "Ada Lovelace",
      contact: "ada@example.com",
      role: "patient",
      message: "I'd like to know more about the chronic care programme.",
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when the DB insert fails", async () => {
    insert.mockResolvedValue({ error: { message: "insert failed" } });

    const result = await submitLead(undefined, formDataFor());

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      name: "Ada Lovelace",
      contact: "ada@example.com",
      role: "patient",
      message: "I'd like to know more about the chronic care programme.",
    });
  });

  it("echoes back the submitted values with an empty optional message", async () => {
    const result = await submitLead(undefined, formDataFor({ contact: "x", message: "" }));

    expect(result?.error).toBeTruthy();
    expect(result?.values).toEqual({
      name: "Ada Lovelace",
      contact: "x",
      role: "patient",
      message: "",
    });
  });

  it("returns no values on a genuine success, since the form is replaced by a thank-you panel", async () => {
    insert.mockResolvedValue({ error: null });

    const result = await submitLead(undefined, formDataFor());

    expect(result).toEqual({ success: true });
  });
});


describe("submitLead: Front Desk capture needs the explicit consent tick", () => {
  const rpc = jest.fn();
  beforeEach(() => {
    jest.resetModules();
  });

  const limiter = jest.fn();
  async function load(rpcImpl: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>) {
    jest.doMock("@/lib/supabase/service-role", () => ({
      createServiceRoleClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }), rpc: (fn: string, args: Record<string, unknown>) => rpcImpl(fn, args) }),
    }));
    jest.doMock("@/lib/rate-limit", () => ({ getClientIp: async () => "203.0.113.9", rateLimit: () => limiter() }));
    limiter.mockResolvedValue({ success: true, retryAfterSeconds: 0 });
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
    return (await import("./actions")).submitLead;
  }

  it("captures with the exact wording and version, and a normalised phone, when the box is ticked", async () => {
    rpc.mockReset().mockResolvedValue({ data: { captured: true }, error: null });
    const submit = await load((fn, args) => rpc(fn, args));
    const r = await submit(undefined, formDataFor({ consent: "on", contact: "0803 123 4567" }));
    expect(r).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("service_fd_capture_lead");
    expect(args).toMatchObject({ p_email: null, p_phone: "+2348031234567", p_source: "website_form", p_consent: true, p_wording_version: "enquiry-consent-v1" });
    expect(String(args.p_wording)).toMatch(/email me about my enquiry/);
  });

  it("does NOT capture when the box is not ticked, but still saves the enquiry", async () => {
    rpc.mockReset();
    const submit = await load((fn, args) => rpc(fn, args));
    expect(await submit(undefined, formDataFor({ contact: "ada@example.com" }))).toEqual({ success: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("over the capture rate limit the enquiry is still saved but nothing is captured", async () => {
    rpc.mockReset();
    const submit = await load((fn, args) => rpc(fn, args));
    limiter.mockResolvedValue({ success: false, retryAfterSeconds: 600 });
    expect(await submit(undefined, formDataFor({ consent: "on" }))).toEqual({ success: true });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a limiter fault fails open: the lead is still captured", async () => {
    rpc.mockReset().mockResolvedValue({ data: { captured: true }, error: null });
    const submit = await load((fn, args) => rpc(fn, args));
    limiter.mockRejectedValue(new Error("redis down"));
    expect(await submit(undefined, formDataFor({ consent: "on" }))).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("still reports success to the visitor when capture fails (the enquiry itself is saved)", async () => {
    rpc.mockReset().mockResolvedValue({ data: null, error: { message: "boom" } });
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const submit = await load((fn, args) => rpc(fn, args));
    expect(await submit(undefined, formDataFor({ consent: "on" }))).toEqual({ success: true });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("still reports success when capture throws", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const submit = await load(async () => { throw new Error("network"); });
    expect(await submit(undefined, formDataFor({ consent: "on" }))).toEqual({ success: true });
    spy.mockRestore();
  });
});
