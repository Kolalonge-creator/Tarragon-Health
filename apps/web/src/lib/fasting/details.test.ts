import { describe, expect, it, jest } from "@jest/globals";

const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>();
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));

import { fetchFastingDetails, parseFastingDetails, UNAVAILABLE_DETAILS } from "./details";

const ok = {
  state: "ok",
  decision: "may_fast_with_guidance",
  reason: "none",
  blocks: [],
  has_timing_plan: true,
  calendar: { status: "expected", start: "2027-02-08", end: "2027-03-09" },
  timing_plans: [{ summary: "Take your tablet at sunrise.", signed_by_name: "Dr A", signed_at: "2026-10-20T10:00:00Z", valid_from: "2027-02-01", valid_to: "2027-03-12" }],
};
const plan = { id: "p1", fast: "ramadan", starts_on: "2027-02-08", ends_on: "2027-03-09" };

describe("parseFastingDetails", () => {
  it("reads a full reply", () => {
    const d = parseFastingDetails(ok, plan);
    expect(d.answer).toMatchObject({ state: "ok", decision: "may_fast_with_guidance" });
    expect(d.calendar).toEqual({ status: "expected", start: "2027-02-08", end: "2027-03-09" });
    expect(d.plan).toEqual({ id: "p1", fast: "ramadan", startsOn: "2027-02-08", endsOn: "2027-03-09" });
    expect(d.timingPlans).toEqual([{ summary: "Take your tablet at sunrise.", signedByName: "Dr A", signedAt: "2026-10-20T10:00:00Z", validFrom: "2027-02-01", validTo: "2027-03-12" }]);
    expect(d.planPaused).toBe(false);
  });

  it("the unavailable answer carries no dates or timing plan, even if the reply had them", () => {
    expect(parseFastingDetails({ state: "unavailable", timing_plans: ok.timing_plans, calendar: ok.calendar })).toEqual(UNAVAILABLE_DETAILS);
    expect(parseFastingDetails(null)).toEqual(UNAVAILABLE_DETAILS);
  });

  it("a plan stays visible, and paused, when the gate has turned unavailable (so it can still be ended)", () => {
    const d = parseFastingDetails({ state: "unavailable" }, plan);
    expect(d.plan).toEqual({ id: "p1", fast: "ramadan", startsOn: "2027-02-08", endsOn: "2027-03-09" });
    expect(d.planPaused).toBe(true);
    expect(d.timingPlans).toEqual([]);
  });

  it("a plan is paused when the gate says a clinician is needed or a stop applies, and not otherwise", () => {
    const needs = { state: "ok", decision: "needs_clinician_plan", reason: "recent_amber_event", blocks: ["recent_amber_event"], has_timing_plan: false };
    expect(parseFastingDetails(needs, plan).planPaused).toBe(true);
    expect(parseFastingDetails(ok, plan).planPaused).toBe(false);
    expect(parseFastingDetails(needs, null).planPaused).toBe(false);
  });

  it("unknown calendar, a malformed plan and malformed timing plans are dropped, not guessed", () => {
    const d = parseFastingDetails({ ...ok, calendar: { status: "unknown" }, timing_plans: [null, { summary: "", signed_at: "x" }, { summary: "ok", signed_at: "t", valid_from: "a", valid_to: "b" }] }, { id: "p", fast: "diwali" });
    expect(d.calendar).toEqual({ status: "unknown" });
    expect(d.plan).toBeNull();
    expect(d.timingPlans).toEqual([{ summary: "ok", signedByName: null, signedAt: "t", validFrom: "a", validTo: "b" }]);
  });

  it("a reply with no calendar and no timing_plans array is still readable", () => {
    const d = parseFastingDetails({ state: "ok", decision: "needs_clinician_plan", reason: "medicine_timing_plan_needed", blocks: ["medicine_timing_plan_needed"], has_timing_plan: false });
    expect(d.calendar).toEqual({ status: "unknown" });
    expect(d.plan).toBeNull();
    expect(d.timingPlans).toEqual([]);
  });
});

describe("fetchFastingDetails", () => {
  it("passes the fast and dates to the gate and also asks for the person's own plan", async () => {
    rpc.mockResolvedValueOnce({ data: ok, error: null }).mockResolvedValueOnce({ data: plan, error: null });
    const d = await fetchFastingDetails("ramadan", "2027-02-08", null);
    expect(rpc).toHaveBeenCalledWith("my_fasting_gate", { p_fast: "ramadan", p_starts_on: "2027-02-08", p_ends_on: null });
    expect(rpc).toHaveBeenCalledWith("my_fasting_plan");
    expect(d.plan?.id).toBe("p1");
  });

  it("a gate error is the unavailable answer (the plan, if it could be read, is still shown and paused)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } }).mockResolvedValueOnce({ data: plan, error: null });
    const d = await fetchFastingDetails("lent", null, null);
    expect(d.answer).toEqual({ state: "unavailable" });
    expect(d.plan?.id).toBe("p1");
    expect(d.planPaused).toBe(true);
  });

  it("a plan error shows no plan and does not change the gate answer", async () => {
    rpc.mockResolvedValueOnce({ data: ok, error: null }).mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    const d = await fetchFastingDetails("lent", null, null);
    expect(d.plan).toBeNull();
    expect(d.answer).toMatchObject({ state: "ok" });
  });
});
