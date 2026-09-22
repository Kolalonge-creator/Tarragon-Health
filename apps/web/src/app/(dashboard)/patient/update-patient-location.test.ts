/**
 * Regression test for a data-loss bug caught by /code-review high before it
 * shipped: React resets every uncontrolled field in an action-bound <form>
 * once the action returns, success or failure. `updatePatientLocation`
 * originally returned only `{error}` on failure, so PatientLocationForm's
 * state/city/area <Input>/<Select> defaultValues had nothing fresh to fall
 * back to - a transient DB error, or a plain validation failure on one
 * field, would silently wipe whatever the patient had just typed into all
 * three. This proves the action now echoes back exactly what was submitted
 * on both ways it can fail.
 */

jest.mock("@/lib/auth/current-profile", () => ({
  getCurrentProfile: jest.fn(),
}));

const getUser = jest.fn();
const update = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: { getUser },
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return { update: () => ({ eq: update }) };
    },
  }),
}));

import { updatePatientLocation } from "./actions";

function formDataFor(overrides: Record<string, string> = {}) {
  const fd = new FormData();
  fd.set("state", "Lagos");
  fd.set("city", "Ikeja");
  fd.set("area", "Allen Avenue");
  for (const [key, value] of Object.entries(overrides)) fd.set(key, value);
  return fd;
}

describe("updatePatientLocation — submitted values survive a failed submission", () => {
  beforeEach(() => {
    getUser.mockReset();
    update.mockReset();
    getUser.mockResolvedValue({ data: { user: { id: "patient-1" } } });
  });

  it("echoes back every submitted field when Zod validation fails", async () => {
    const result = await updatePatientLocation(undefined, formDataFor({ city: "X".repeat(150) }));

    expect(result?.error).toContain("100 characters");
    expect(result?.values).toEqual({
      state: "Lagos",
      city: "X".repeat(150),
      area: "Allen Avenue",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("echoes back every submitted field when the database update fails", async () => {
    update.mockResolvedValue({ error: { message: "connection reset" } });

    const result = await updatePatientLocation(undefined, formDataFor());

    expect(result?.error).toBe("connection reset");
    expect(result?.values).toEqual({ state: "Lagos", city: "Ikeja", area: "Allen Avenue" });
  });

  it("also echoes back the submitted values on success", async () => {
    // The same reset-on-any-outcome React behavior applies on success too:
    // without this, a successful save could flash the visible fields back
    // to their stale pre-edit values for the moment before router.refresh()
    // lands a fresh `initial` prop from the server, looking like the edit
    // itself was silently lost even though it saved correctly.
    update.mockResolvedValue({ error: null });

    const result = await updatePatientLocation(undefined, formDataFor());

    expect(result).toEqual({
      success: true,
      values: { state: "Lagos", city: "Ikeja", area: "Allen Avenue" },
    });
  });
});
