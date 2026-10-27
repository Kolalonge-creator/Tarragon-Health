/**
 * Pain programme calls on the phone (S96): which database function each call uses, how the rest / not-enough-days / flare-up answers are read,
 * and that an unreadable answer is never a "continue".
 */
const mockRpc = jest.fn();
jest.mock("@/lib/supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a), auth: { getSession: jest.fn() }, from: jest.fn() } }));
jest.mock("@react-native-async-storage/async-storage", () => ({ getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() }));

import { completeSession, rateExercise, reportFlareUp, startSession } from "./therapy-programmes";

beforeEach(() => mockRpc.mockReset());

describe("startSession", () => {
  it("opens a pain programme through start_msk_session and any other programme through the S63 start", async () => {
    mockRpc.mockResolvedValue({ data: { status: "not_active" }, error: null });
    await startSession("e1", 1, {}, "pain_knee");
    expect(mockRpc).toHaveBeenLastCalledWith("start_msk_session", expect.anything());
    await startSession("e1", 1, {}, "panic_breathing");
    expect(mockRpc).toHaveBeenLastCalledWith("start_therapy_session", expect.anything());
  });

  it("an activity-gate rest answer is its own result", async () => {
    mockRpc.mockResolvedValue({ data: { status: "activity_rest" }, error: null });
    expect(await startSession("e1", 1, {}, "pain_back")).toEqual({ kind: "rest" });
  });

  it("an error is unknown, never ok", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "x" } });
    expect(await startSession("e1", 1, {}, "pain_back")).toEqual({ kind: "unknown" });
  });
});

describe("completeSession", () => {
  it("uses complete_msk_session for pain programmes and reports a week with too few days", async () => {
    mockRpc.mockResolvedValue({ data: { status: "not_enough_days", days_done: 1, days_needed: 3 }, error: null });
    expect(await completeSession("e1", 1, null, "pain_hip")).toEqual({ kind: "short", daysNeeded: 3 });
    expect(mockRpc).toHaveBeenLastCalledWith("complete_msk_session", expect.anything());
  });

  it("other programmes keep the S63 completion", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", completed_count: 1 }, error: null });
    await completeSession("e1", 1, null, "pelvic_floor");
    expect(mockRpc).toHaveBeenLastCalledWith("complete_therapy_session", expect.anything());
  });
});

describe("rateExercise", () => {
  it("sends a valid rating and reads the easier-version flag", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", offer_easier: true, days_done: 2 }, error: null });
    expect(await rateExercise("e1", 1, "walk", 5)).toEqual({ offerEasier: true, daysDone: 2 });
    expect(mockRpc).toHaveBeenLastCalledWith("record_msk_exercise_rating", { p_enrolment: "e1", p_ordinal: 1, p_exercise_key: "walk", p_rating: 5 });
  });

  it("refuses an out-of-range rating without calling the database, and a failure is null", async () => {
    expect(await rateExercise("e1", 1, "walk", 9)).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: null, error: { message: "offline" } });
    expect(await rateExercise("e1", 1, "walk", 3)).toBeNull();
  });
});

describe("reportFlareUp", () => {
  it("reads a pause, a step-down and an unreadable answer", async () => {
    mockRpc.mockResolvedValueOnce({ data: { status: "stopped", route: "same_day_clinician", task_failed: false }, error: null });
    expect(await reportFlareUp("e1", { fever: true }, 7)).toEqual({ kind: "stopped", route: "same_day_clinician", taskFailed: false });
    expect(mockRpc).toHaveBeenLastCalledWith("report_msk_flare_up", { p_enrolment: "e1", p_recheck: { fever: true }, p_pain_now: 7 });
    mockRpc.mockResolvedValueOnce({ data: { status: "step_down", until: "2026-10-30" }, error: null });
    expect(await reportFlareUp("e1", {})).toEqual({ kind: "step_down", until: "2026-10-30" });
    mockRpc.mockResolvedValueOnce({ data: { status: "weird" }, error: null });
    expect(await reportFlareUp("e1", {})).toEqual({ kind: "unknown" });
    mockRpc.mockRejectedValueOnce(new Error("network"));
    expect(await reportFlareUp("e1", {})).toEqual({ kind: "unknown" });
  });
});
