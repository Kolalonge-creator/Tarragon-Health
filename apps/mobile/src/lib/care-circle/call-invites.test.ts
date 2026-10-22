import { supabase } from "../supabase";
import {
  activeCallPasses,
  answerCallInvite,
  callInviteWebPath,
  cancelCallInvite,
  inviteToCall,
  loadCallCaregivers,
  loadMyCallInvites,
  parseCallCaregivers,
  parseCallInvites,
} from "./call-invites";

jest.mock("../supabase", () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;

const list = (over: Record<string, unknown> = {}) => ({
  live: true,
  max: 1,
  passes: [{ pass_id: "p1", relationship: "Daughter", state: "invited", name: "Ada" }],
  invitable: [{ member_id: "m1", name: "Bola", relationship: "Son" }],
  ...over,
});

beforeEach(() => rpc.mockReset());

describe("parsing", () => {
  it("accepts the database's shapes and treats anything else as nothing to show", () => {
    expect(parseCallCaregivers(list())?.passes).toHaveLength(1);
    for (const bad of [null, {}, list({ max: 0 }), list({ passes: [{ pass_id: "p", relationship: "x", state: "cancelled", name: null }] })]) expect(parseCallCaregivers(bad)).toBeNull();
    expect(parseCallInvites([{ pass_id: "p", encounter_id: "e", patient_first_name: "Mama", state: "accepted", scheduled_at: "x", joinable: true }])).toHaveLength(1);
    expect(parseCallInvites([{ pass_id: "p", state: "removed" }])).toEqual([]);
    expect(parseCallInvites(null)).toEqual([]);
  });

  it("counts only invited and accepted people against the cap", () => {
    const l = parseCallCaregivers(list({ passes: [{ pass_id: "a", relationship: "x", state: "invited", name: null }, { pass_id: "b", relationship: "x", state: "declined", name: null }, { pass_id: "c", relationship: "x", state: "removed", name: null }] }));
    expect(l && activeCallPasses(l).map((p) => p.pass_id)).toEqual(["a"]);
  });

  it("opens the guest's call in the web room, never as a link built from anything but the id", () => {
    expect(callInviteWebPath("7b9c")).toBe("/patient/supporting/consultation/7b9c");
    expect(callInviteWebPath("a/b?x=1")).toBe("/patient/supporting/consultation/a%2Fb%3Fx%3D1");
  });
});

describe("the calls", () => {
  it("reads who is on a call; null is 'not your call', and a changed shape is a failure, never an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: list(), error: null });
    const ok = await loadCallCaregivers("e1");
    expect(rpc).toHaveBeenCalledWith("consultation_caregivers", { p_encounter: "e1" });
    expect(ok.ok && ok.data?.invitable).toHaveLength(1);
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadCallCaregivers("e1")).toEqual({ ok: true, data: null });
    rpc.mockResolvedValueOnce({ data: { nonsense: 1 }, error: null });
    expect((await loadCallCaregivers("e1")).ok).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await loadCallCaregivers("e1")).ok).toBe(false);
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect((await loadCallCaregivers("e1")).ok).toBe(false);
  });

  it("invites, cancels and answers through the database functions and maps a refusal to a code without its words", async () => {
    rpc.mockResolvedValue({ data: { pass_id: "p" }, error: null });
    expect(await inviteToCall("e1", "m1")).toBe("ok");
    expect(rpc).toHaveBeenLastCalledWith("invite_caregiver_to_consultation", { p_encounter: "e1", p_member: "m1" });
    expect(await cancelCallInvite("p1")).toBe("ok");
    expect(rpc).toHaveBeenLastCalledWith("cancel_caregiver_invite", { p_pass: "p1" });
    expect(await answerCallInvite("p1", true)).toBe("ok");
    expect(rpc).toHaveBeenLastCalledWith("respond_caregiver_consultation_invite", { p_pass: "p1", p_accept: true });
    rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "caregiver_invite_not_allowed" } });
    expect(await inviteToCall("e1", "m1")).toBe("not_allowed");
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "x" } });
    expect(await cancelCallInvite("p1")).toBe("failed");
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await answerCallInvite("p1", false)).toBe("failed");
  });

  it("reads the caregiver's own invites", async () => {
    rpc.mockResolvedValueOnce({ data: [{ pass_id: "p", encounter_id: "e", patient_first_name: "Mama", state: "invited", scheduled_at: "x", joinable: false }], error: null });
    const r = await loadMyCallInvites();
    expect(rpc).toHaveBeenCalledWith("my_consultation_invites", undefined);
    expect(r.ok && r.data).toHaveLength(1);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await loadMyCallInvites()).ok).toBe(false);
  });
});
