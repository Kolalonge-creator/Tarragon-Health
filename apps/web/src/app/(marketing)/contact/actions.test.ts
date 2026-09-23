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
