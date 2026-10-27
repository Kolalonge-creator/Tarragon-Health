import { cancelCaregiverInviteAction, inviteCaregiverAction, removeCaregiverAction, reportCaregiverLeftAction, respondCaregiverInviteAction } from "./actions";

// CGJ: the server actions a patient, a caregiver and a clinician use. Each runs as the signed-in person's own session (the database
// decides who may do what, proved in packages/db/tests/cgj_caregiver_in_consultation.sql); what is proved here is the input checking,
// the mapping of a refusal to a short code, and that nothing from the database error text reaches the caller.

const rpc = jest.fn();
let user: { id: string } | null = { id: "u1" };
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc: (...a: unknown[]) => rpc(...a) }),
}));
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({}) }));
jest.mock("./providers", () => ({ videoProvider: () => ({ ok: false }) }));

const ENC = "7b9c2f0e-5d3a-4c11-9a52-0f6d1e8b7a44";
const MEMBER = "11111111-1111-4111-8111-111111111111";
const PASS = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  rpc.mockReset();
  user = { id: "u1" };
});

describe("inviteCaregiverAction", () => {
  it("passes the two ids to the database and returns the pass id", async () => {
    rpc.mockResolvedValue({ data: { pass_id: PASS, expires_at: "x" }, error: null });
    expect(await inviteCaregiverAction(ENC, MEMBER)).toEqual({ ok: true, passId: PASS });
    expect(rpc).toHaveBeenCalledWith("invite_caregiver_to_consultation", { p_encounter: ENC, p_member: MEMBER });
  });

  it("refuses anything that is not two uuids before touching the database", async () => {
    expect(await inviteCaregiverAction("nope", MEMBER)).toEqual({ ok: false, reason: "invalid" });
    expect(await inviteCaregiverAction(ENC, "'; drop table x; --")).toEqual({ ok: false, reason: "invalid" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does nothing for a signed-out person", async () => {
    user = null;
    expect(await inviteCaregiverAction(ENC, MEMBER)).toEqual({ ok: false, reason: "signed_out" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps a refusal to a code and never passes the database's words on", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "caregiver_invite_not_allowed for Ada Okafor" } });
    expect(await inviteCaregiverAction(ENC, MEMBER)).toEqual({ ok: false, reason: "not_allowed" });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "caregiver_invite_call_full" } });
    const failed = await inviteCaregiverAction(ENC, MEMBER);
    expect(failed).toEqual({ ok: false, reason: "failed" });
    expect(JSON.stringify(failed)).not.toMatch(/full|Okafor/);
  });

  it("does not report success when the database answers something unexpected", async () => {
    rpc.mockResolvedValue({ data: { nothing: true }, error: null });
    expect(await inviteCaregiverAction(ENC, MEMBER)).toEqual({ ok: false, reason: "failed" });
  });
});

describe("cancel, respond, remove and report-left", () => {
  it("each calls its own function with the pass", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await cancelCaregiverInviteAction(PASS)).toEqual({ ok: true });
    expect(await respondCaregiverInviteAction(PASS, false)).toEqual({ ok: true });
    expect(await removeCaregiverAction(PASS)).toEqual({ ok: true });
    expect(await removeCaregiverAction(PASS, "privacy")).toEqual({ ok: true });
    expect(await reportCaregiverLeftAction(ENC)).toEqual({ ok: true });
    expect(rpc.mock.calls).toEqual([
      ["cancel_caregiver_invite", { p_pass: PASS }],
      ["respond_caregiver_consultation_invite", { p_pass: PASS, p_accept: false }],
      ["remove_caregiver_from_consultation", { p_pass: PASS, p_reason_code: null }],
      ["remove_caregiver_from_consultation", { p_pass: PASS, p_reason_code: "privacy" }],
      ["report_caregiver_left", { p_encounter: ENC }],
    ]);
  });

  it("refuses bad input, including a free-text removal reason, without calling the database", async () => {
    expect(await cancelCaregiverInviteAction("x")).toEqual({ ok: false, reason: "invalid" });
    expect(await respondCaregiverInviteAction(PASS, "yes" as unknown as boolean)).toEqual({ ok: false, reason: "invalid" });
    expect(await removeCaregiverAction("x")).toEqual({ ok: false, reason: "invalid" });
    expect(await removeCaregiverAction(PASS, "Ada was rude" as unknown as "other")).toEqual({ ok: false, reason: "invalid" });
    expect(await reportCaregiverLeftAction("x")).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns a failure from the database as not ok", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "caregiver_remove_not_allowed" } });
    expect(await removeCaregiverAction(PASS)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await respondCaregiverInviteAction(PASS, true)).toEqual({ ok: false, reason: "not_allowed" });
    expect(await reportCaregiverLeftAction(ENC)).toEqual({ ok: false });
  });
});
