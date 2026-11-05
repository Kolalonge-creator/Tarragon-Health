/**
 * The admin switch for two-factor sign-in per group. The database function is the authority (admin only, lock-out guards,
 * versioning, history); the action must validate the form, pass a whole-role group as a null tier, and show the database's
 * refusal as written.
 */
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

import { setTwoFactorRequirementAction } from "./actions";

const NOTE = "Doctors must use 2FA from today on";

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

describe("setTwoFactorRequirementAction", () => {
  beforeEach(() => rpc.mockReset());

  it("switches a whole-role group on, passing a null tier and the confirmation", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    const r = await setTwoFactorRequirementAction(
      undefined,
      form({ role: "clinician", doctorTier: "", required: "true", note: NOTE, confirmUnenrolled: "true" }),
    );
    expect(rpc).toHaveBeenCalledWith("set_mfa_group_requirement", {
      p_role: "clinician",
      p_doctor_tier: null,
      p_required: true,
      p_change_note: NOTE,
      p_confirm_unenrolled: true,
    });
    expect(r?.message).toContain("now required");
  });

  it("passes a doctor tier through", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });
    await setTwoFactorRequirementAction(
      undefined,
      form({ role: "clinician", doctorTier: "chief_medical_officer", required: "false", note: NOTE }),
    );
    expect(rpc).toHaveBeenCalledWith("set_mfa_group_requirement", expect.objectContaining({
      p_doctor_tier: "chief_medical_officer",
      p_required: false,
      p_confirm_unenrolled: false,
    }));
  });

  it("refuses a short change note before calling the database", async () => {
    const r = await setTwoFactorRequirementAction(undefined, form({ role: "patient", doctorTier: "", required: "true", note: "too short" }));
    expect(rpc).not.toHaveBeenCalled();
    expect(r?.error).toContain("20 characters");
  });

  it("refuses an unknown role or tier before calling the database", async () => {
    await setTwoFactorRequirementAction(undefined, form({ role: "superuser", doctorTier: "", required: "true", note: NOTE }));
    await setTwoFactorRequirementAction(undefined, form({ role: "clinician", doctorTier: "medical_officer", required: "true", note: NOTE }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("shows the database's refusal (the self lock-out guard) as written", async () => {
    const message = "You are in this group. Turn on two-factor sign-in for your own account in Profile & settings, sign in with it, then switch this group on.";
    rpc.mockResolvedValue({ data: null, error: { message } });
    const r = await setTwoFactorRequirementAction(undefined, form({ role: "admin", doctorTier: "", required: "true", note: NOTE }));
    expect(r).toEqual({ error: message });
  });
});
