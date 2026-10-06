import { en, pcm } from "@tarragon/i18n";
import {
  CIRCLE_PERMISSIONS, circleErrorKey, inviteLinkPath, parseAlerts, parseInviteMade, parseMyCircle, parseSupported, parseSupporterView,
  parseViewLog, permissionKey,
} from "./parse";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { cancelInvite, createInvite, loadMyCircle, loadOpenAlerts, loadSupported, loadSupporterView, loadViewLog, revokeMember, updateMember } from "./api";

beforeEach(() => mockRpc.mockReset());

describe("parsing", () => {
  it("every permission has copy in both languages", () => {
    for (const p of CIRCLE_PERMISSIONS) {
      expect(en[permissionKey(p)].length).toBeGreaterThan(0);
      expect(pcm[permissionKey(p)].length).toBeGreaterThan(0);
    }
  });

  it("keeps good members and invites, drops a row with an unknown permission, and survives garbage", () => {
    const m = { member_id: "m", name: "Ada", relationship: "Daughter", permissions: ["red_alerts"], expires_at: "t" };
    const out = parseMyCircle({ members: [m, { ...m, permissions: ["view_results"] }, 3], invites: [{ invite_id: "i", hint: "+234•••4567", relationship: "Son", expires_at: "t" }, { x: 1 }] });
    expect(out.members).toHaveLength(1);
    expect(out.invites).toHaveLength(1);
    expect(parseMyCircle(null)).toEqual({ members: [], invites: [] });
    expect(parseMyCircle({ members: "no", invites: 5 })).toEqual({ members: [], invites: [] });
  });

  it("parses supported people, alerts, the log and an invite reply", () => {
    expect(parseSupported([{ patient_id: "p", member_id: "m", name: "Mum", relationship: "Mother", permissions: ["pay_for_care"], expires_at: "t" }, null])).toHaveLength(1);
    expect(parseSupported({})).toEqual([]);
    expect(parseAlerts([{ patient_id: "p", name: "Mum", since: "t" }, {}])).toHaveLength(1);
    expect(parseAlerts(7)).toEqual([]);
    expect(parseViewLog([{ viewer: "Ada", at: "t" }, {}])).toHaveLength(1);
    expect(parseViewLog(undefined)).toEqual([]);
    expect(parseInviteMade({ token: "t".repeat(43), expires_at: "t" })).toEqual({ token: "t".repeat(43), expiresAt: "t" });
    expect(parseInviteMade({ token: "short", expires_at: "t" })).toBeNull();
  });

  it("the supporter view keeps only the blocks sent, and no stray field (safety case 21, app side)", () => {
    const v = parseSupporterView({
      patient_id: "p", name: "Mum", shared_until: "t",
      bp_trend: { weeks: [{ week_start: "2026-10-05", systolic: 141, diastolic: 90, readings: 3, taken_at: "x", note: "dizzy" }, { bad: 1 }], direction: "steady" },
    });
    expect(v?.bpTrend?.weeks).toEqual([{ weekStart: "2026-10-05", systolic: 141, diastolic: 90, readings: 3 }]);
    expect(v?.adherence).toBeUndefined();
    expect(v?.appointments).toBeUndefined();
    expect(v?.canPay).toBe(false);
    expect(JSON.stringify(v)).not.toMatch(/taken_at|dizzy/);
  });

  it("parses adherence and appointments and a null direction", () => {
    const v = parseSupporterView({
      patient_id: "p", name: "Mum", shared_until: "t", can_pay: true,
      adherence: { taken: 3, due: 4, percent: 75 }, appointments: { next_at: null, missed_30d: 1 }, bp_trend: { weeks: [], direction: "weird" },
    });
    expect(v?.adherence).toEqual({ taken: 3, due: 4, percent: 75 });
    expect(v?.appointments).toEqual({ nextAt: null, missed30d: 1 });
    expect(v?.bpTrend?.direction).toBeNull();
    expect(v?.canPay).toBe(true);
    expect(parseSupporterView({ error: "x" })).toBeNull();
    expect(parseSupporterView(null)).toBeNull();
  });

  it("maps refusals to copy and puts the token in the path only", () => {
    expect(circleErrorKey("invite_rate_limited")).toBe("circle.error.invite_rate_limited");
    expect(circleErrorKey("odd")).toBe("circle.error.unknown");
    expect(circleErrorKey(3)).toBe("circle.error.unknown");
    expect(inviteLinkPath("a/b")).toBe("/patient/supporting/join/a%2Fb");
    expect(inviteLinkPath("abc")).not.toContain("?");
  });
});

describe("api", () => {
  it("loads each list and reports an error message instead of throwing", async () => {
    mockRpc.mockResolvedValueOnce({ data: { members: [], invites: [] }, error: null });
    expect(await loadMyCircle()).toEqual({ ok: true, data: { members: [], invites: [] } });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadViewLog()).toEqual({ ok: true, data: [] });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadSupported()).toEqual({ ok: true, data: [] });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadOpenAlerts()).toEqual({ ok: true, data: [] });
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadMyCircle()).toEqual({ ok: false, error: "boom" });
    expect(await loadViewLog()).toEqual({ ok: false, error: "boom" });
    expect(await loadSupported()).toEqual({ ok: false, error: "boom" });
    expect(await loadOpenAlerts()).toEqual({ ok: false, error: "boom" });
  });

  it("an ended access is a normal null answer, any other error is an error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "circle_not_found" } });
    expect(await loadSupporterView("p")).toEqual({ ok: true, data: null });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "network" } });
    expect(await loadSupporterView("p")).toEqual({ ok: false, error: "network" });
    mockRpc.mockResolvedValueOnce({ data: { patient_id: "p", name: "Mum", shared_until: "t" }, error: null });
    expect((await loadSupporterView("p"))).toMatchObject({ ok: true });
    expect(mockRpc).toHaveBeenCalledWith("circle_supporter_view", { p_patient: "p" });
  });

  it("creates an invite with the right arguments and maps a refusal", async () => {
    mockRpc.mockResolvedValueOnce({ data: { invite_id: "i", token: "t".repeat(43), expires_at: "t" }, error: null });
    expect(await createInvite({ kind: "email", contact: "a@b.c", relationship: "Son", permissions: ["red_alerts"], days: 90 })).toEqual({ ok: true, token: "t".repeat(43), expiresAt: "t" });
    expect(mockRpc).toHaveBeenCalledWith("create_care_circle_invite", { p_kind: "email", p_contact: "a@b.c", p_relationship: "Son", p_permissions: ["red_alerts"], p_grant_days: 90 });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "invite_rate_limited" } });
    expect(await createInvite({ kind: "phone", contact: "x", relationship: "Son", permissions: ["red_alerts"], days: 90 })).toEqual({ ok: false, errorKey: "circle.error.invite_rate_limited" });
    mockRpc.mockResolvedValueOnce({ data: { nope: 1 }, error: null });
    expect(await createInvite({ kind: "phone", contact: "x", relationship: "Son", permissions: ["red_alerts"], days: 90 })).toEqual({ ok: false, errorKey: "circle.error.unknown" });
  });

  it("cancel, update and revoke report success only on a clean true", async () => {
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await cancelInvite("i")).toBe(true);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await cancelInvite("i")).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await updateMember("m", ["red_alerts"])).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("update_care_circle_member", { p_member: "m", p_permissions: ["red_alerts"] });
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await updateMember("m", ["red_alerts"], "2027-10-06T00:00:00Z")).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("update_care_circle_member", { p_member: "m", p_permissions: ["red_alerts"], p_expires_at: "2027-10-06T00:00:00Z" });
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await updateMember("m", ["red_alerts"])).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: true, error: null });
    expect(await revokeMember("m")).toBe(true);
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await revokeMember("m")).toBe(false);
  });
});
