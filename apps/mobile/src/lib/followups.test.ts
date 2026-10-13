import { supabase } from "./supabase";
import { loadFollowups, pickFollowupSlot, requestLongerCall } from "./followups";
import { isFollowupMember, openSlots, parseFollowups, parsePick } from "./followups-model";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;

const SLOT = { slot_id: "s1", starts_at: "2026-10-13T08:30:00Z", ends_at: "2026-10-13T08:45:00Z" };
const OFFER = { offer_id: "o1", expires_at: "2026-10-13T07:00:00Z", call_minutes: 15, kind: "monthly", longer_requested: false, slots: [SLOT] };
const MEMBER = {
  entitlement: { current: { month_index: 2, state: "available", period_end: "2026-11-01T00:00:00Z", appointment_id: null }, consumed: 1, lapsed: 0, remaining: 10 },
  offers: [OFFER],
};

beforeEach(() => rpc.mockReset());

describe("parseFollowups", () => {
  it("reads a Member with an offer", () => {
    const f = parseFollowups(MEMBER);
    expect(f?.offers[0]?.slots[0]?.slot_id).toBe("s1");
    expect(f?.entitlement?.current?.encounter_id).toBeNull();
    expect(f && isFollowupMember(f)).toBe(true);
  });

  it("reads a non-Member as nothing to show", () => {
    const f = parseFollowups({ entitlement: null, offers: [] });
    expect(f).not.toBeNull();
    expect(f && isFollowupMember(f)).toBe(false);
  });

  it("treats a changed server answer as an error, not as nothing waiting", () => {
    expect(parseFollowups(null)).toBeNull();
    expect(parseFollowups({ offers: "x" })).toBeNull();
    expect(parseFollowups({ entitlement: null, offers: [{ offer_id: "o1" }] })).toBeNull();
    expect(parseFollowups({ entitlement: { consumed: "1" }, offers: [] })).toBeNull();
    expect(parseFollowups({ entitlement: null, offers: [{ ...OFFER, kind: "other" }] })).toBeNull();
  });
});

describe("openSlots", () => {
  it("drops times that have started and sorts the rest", () => {
    const later = { ...SLOT, slot_id: "s2", starts_at: "2026-10-13T09:00:00Z" };
    const earlier = { ...SLOT, slot_id: "s0", starts_at: "2026-10-13T07:00:00Z" };
    const offer = { ...OFFER, kind: "monthly" as const, slots: [later, SLOT, earlier] };
    expect(openSlots(offer, Date.parse("2026-10-13T07:30:00Z")).map((s) => s.slot_id)).toEqual(["s1", "s2"]);
  });
});

describe("parsePick", () => {
  it("only says booked when the database says booked, with a time", () => {
    expect(parsePick({ status: "booked", starts_at: "2026-10-13T08:30:00Z" })).toEqual({ kind: "booked", startsAt: "2026-10-13T08:30:00Z" });
    expect(parsePick({ status: "booked" })).toEqual({ kind: "failed" });
    expect(parsePick({ status: "picked" })).toEqual({ kind: "failed" });
    expect(parsePick(null)).toEqual({ kind: "failed" });
  });
  it("maps taken and run-out offers to their own outcomes", () => {
    expect(parsePick({ status: "unavailable" })).toEqual({ kind: "unavailable" });
    expect(parsePick({ status: "expired" })).toEqual({ kind: "expired" });
    expect(parsePick({ status: "withdrawn" })).toEqual({ kind: "expired" });
  });
});

describe("loadFollowups", () => {
  it("reads through the database function as the signed-in Member", async () => {
    rpc.mockResolvedValue({ data: MEMBER, error: null });
    const res = await loadFollowups();
    expect(rpc).toHaveBeenCalledWith("my_followups", { p_patient: null });
    expect(res.ok).toBe(true);
  });
  it("reports a failure (never an empty card) when the call errors, throws or changes shape", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await loadFollowups()).ok).toBe(false);
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect((await loadFollowups()).ok).toBe(false);
    rpc.mockResolvedValueOnce({ data: { offers: 3 }, error: null });
    expect((await loadFollowups()).ok).toBe(false);
  });
});

describe("pickFollowupSlot", () => {
  it("sends the slot and the request for a longer call", async () => {
    rpc.mockResolvedValue({ data: { status: "booked", starts_at: "2026-10-13T08:30:00Z" }, error: null });
    const out = await pickFollowupSlot("s1", true);
    expect(rpc).toHaveBeenCalledWith("pick_followup_slot", { p_slot: "s1", p_ask_longer: true });
    expect(out).toEqual({ kind: "booked", startsAt: "2026-10-13T08:30:00Z" });
  });
  it("is failed, never booked, when the call errors or throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await pickFollowupSlot("s1", false)).toEqual({ kind: "failed" });
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await pickFollowupSlot("s1", false)).toEqual({ kind: "failed" });
  });
  it("never hangs on a stalled connection", async () => {
    jest.useFakeTimers();
    rpc.mockReturnValue(new Promise(() => {}));
    const pending = pickFollowupSlot("s1", false);
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await pending).toEqual({ kind: "failed" });
    jest.useRealTimers();
  });
});

describe("requestLongerCall", () => {
  it("is true only when the database confirms the flag", async () => {
    rpc.mockResolvedValueOnce({ data: { longer_requested: true }, error: null });
    expect(await requestLongerCall("e1")).toBe(true);
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    expect(await requestLongerCall("e1")).toBe(false);
    rpc.mockResolvedValueOnce({ data: null, error: { message: "no" } });
    expect(await requestLongerCall("e1")).toBe(false);
  });
});
