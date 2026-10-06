import { supabase } from "./supabase";
import { answerScribeConsent, loadRoomView, loadUpcomingConsultations, reportNobodyCame, resetOpenedScribePrompts } from "./consultations";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
jest.mock("./api", () => ({ postConsultationJoin: jest.fn(), postConsultationDialIn: jest.fn() }));

const rpc = supabase.rpc as unknown as jest.Mock;

beforeEach(() => resetOpenedScribePrompts());

const room = {
  encounter_id: "e1",
  role: "patient",
  status: "scheduled",
  scheduled_at: "2026-10-07T09:00:00Z",
  final_media_mode: null,
  join_opens_at: "2026-10-07T08:50:00Z",
  joinable: true,
  patient_joined: false,
  clinician_joined: false,
  scribe: { asked: false, granted: null },
  can_report_clinician_absent: false,
  can_report_patient_absent: false,
  clinician_wait_minutes: 15,
  reconnect_grace_seconds: 120,
};

describe("loadUpcomingConsultations", () => {
  it("reads the patient's own list through the database function", async () => {
    rpc.mockResolvedValue({ data: [{ encounter_id: "e1", type: "video", status: "scheduled", scheduled_at: "2026-10-07T09:00:00Z", appointment_id: null, final_media_mode: null }], error: null });
    const res = await loadUpcomingConsultations();
    expect(rpc).toHaveBeenCalledWith("my_upcoming_encounters", { p_limit: 20 });
    expect(res.ok && res.data).toHaveLength(1);
  });

  it("reports a failure (never an empty list) when the call errors, throws or changes shape", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect((await loadUpcomingConsultations()).ok).toBe(false);
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect((await loadUpcomingConsultations()).ok).toBe(false);
    rpc.mockResolvedValueOnce({ data: { not: "a list" }, error: null });
    expect((await loadUpcomingConsultations()).ok).toBe(false);
  });
});

describe("a stalled connection", () => {
  afterEach(() => jest.useRealTimers());

  it("turns a read that never answers into a failure instead of waiting for ever", async () => {
    jest.useFakeTimers();
    rpc.mockReturnValue(new Promise(() => {}));
    const room = loadRoomView("e1");
    const list = loadUpcomingConsultations();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(await room).toEqual({ ok: false });
    expect(await list).toEqual({ ok: false });
  });
});

describe("loadRoomView", () => {
  it("returns the view for the patient", async () => {
    rpc.mockResolvedValue({ data: room, error: null });
    const res = await loadRoomView("e1");
    expect(rpc).toHaveBeenCalledWith("consultation_room_view", { p_encounter: "e1" });
    expect(res.ok && res.data?.encounter_id).toBe("e1");
  });

  it("treats null as not found, and a clinician's view as not found (their room stays on the web)", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await loadRoomView("e1")).toEqual({ ok: true, data: null });
    rpc.mockResolvedValueOnce({ data: { ...room, role: "clinician" }, error: null });
    expect(await loadRoomView("e1")).toEqual({ ok: true, data: null });
  });

  it("is a failure, not a not-found, when the call fails", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadRoomView("e1")).toEqual({ ok: false });
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadRoomView("e1")).toEqual({ ok: false });
  });
});

describe("answerScribeConsent", () => {
  it("opens the prompt, then records the patient's own answer", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await answerScribeConsent("e1", true)).toBe(true);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["open_scribe_prompt", "record_scribe_consent"]);
    expect(rpc).toHaveBeenLastCalledWith("record_scribe_consent", { p_encounter: "e1", p_granted: true });
  });

  it("does not log a second 'asked' when changing an answer that was already asked", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await answerScribeConsent("e1", false, true)).toBe(true);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["record_scribe_consent"]);
  });

  it("does not open the prompt again when retrying after the answer step failed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "no" } });
    expect(await answerScribeConsent("e1", true)).toBe(false);
    rpc.mockResolvedValue({ data: null, error: null });
    expect(await answerScribeConsent("e1", true)).toBe(true);
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["open_scribe_prompt", "record_scribe_consent", "record_scribe_consent"]);
  });

  it("carries a decline as a recorded false, not as silence", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await answerScribeConsent("e1", false);
    expect(rpc).toHaveBeenLastCalledWith("record_scribe_consent", { p_encounter: "e1", p_granted: false });
  });

  it("is not saved when the prompt step fails, and the answer is never sent", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "no" } });
    expect(await answerScribeConsent("e1", true)).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("is not saved when the record step fails or the network drops", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: null, error: { message: "no" } });
    expect(await answerScribeConsent("e1", true)).toBe(false);
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await answerScribeConsent("e1", true)).toBe(false);
  });
});

describe("reportNobodyCame", () => {
  it("maps the database's wait rule to wait_longer and any other error to failed", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    expect(await reportNobodyCame("e1")).toBe("ok");
    expect(rpc).toHaveBeenCalledWith("mark_encounter_no_show", { p_encounter: "e1" });
    rpc.mockResolvedValueOnce({ data: null, error: { message: "wait a little longer before reporting that nobody came" } });
    expect(await reportNobodyCame("e1")).toBe("wait_longer");
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not allowed" } });
    expect(await reportNobodyCame("e1")).toBe("failed");
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await reportNobodyCame("e1")).toBe("failed");
  });
});
