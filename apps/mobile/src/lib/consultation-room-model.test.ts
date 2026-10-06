import {
  ROOM_POLL_MS,
  canTellNobodyCame,
  canWithdrawScribe,
  formatWhen,
  isLive,
  isOpenableJoinUrl,
  joinAvailability,
  parseRoomView,
  parseUpcoming,
  pollDelayMs,
  roomPhase,
  shouldAskScribe,
  telUrl,
  type RoomView,
} from "./consultation-room-model";

function view(over: Partial<RoomView> = {}): RoomView {
  return {
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
    ...over,
  };
}

describe("polling", () => {
  it("never allows a refresh faster than every 10 seconds", () => {
    expect(ROOM_POLL_MS).toBeGreaterThanOrEqual(10_000);
    expect(pollDelayMs(1000)).toBe(10_000);
    expect(pollDelayMs(0)).toBe(10_000);
    expect(pollDelayMs(Number.NaN)).toBe(10_000);
    expect(pollDelayMs(45_000)).toBe(45_000);
  });
});

describe("room phase", () => {
  it("is a waiting room while the consultation is live and ended or cancelled after", () => {
    for (const s of ["scheduled", "waiting", "in_progress"] as const) expect(roomPhase(view({ status: s }))).toBe("waiting_room");
    expect(roomPhase(view({ status: "cancelled" }))).toBe("cancelled");
    for (const s of ["completed", "no_show_patient", "no_show_clinician", "failed"] as const) expect(roomPhase(view({ status: s }))).toBe("ended");
    expect(isLive("completed")).toBe(false);
  });
});

describe("scribe question", () => {
  it("is asked until the patient has answered, for this live consultation only", () => {
    expect(shouldAskScribe(view())).toBe(true);
    expect(shouldAskScribe(view({ scribe: { asked: true, granted: false } }))).toBe(false);
    expect(shouldAskScribe(view({ scribe: { asked: true, granted: true } }))).toBe(false);
    expect(shouldAskScribe(view({ status: "completed" }))).toBe(false);
    expect(shouldAskScribe(view({ role: "clinician" }))).toBe(false);
  });

  it("offers withdrawal only after a yes", () => {
    expect(canWithdrawScribe(view({ scribe: { asked: true, granted: true } }))).toBe(true);
    expect(canWithdrawScribe(view({ scribe: { asked: true, granted: false } }))).toBe(false);
    expect(canWithdrawScribe(view())).toBe(false);
  });
});

describe("join buttons", () => {
  it("are off until the server says the room is open", () => {
    expect(joinAvailability(view({ joinable: false }))).toEqual({ video: false, audio: false });
    expect(joinAvailability(view())).toEqual({ video: true, audio: true });
  });

  it("drop video once the call has fallen back to audio only", () => {
    expect(joinAvailability(view({ final_media_mode: "audio_only" }))).toEqual({ video: false, audio: true });
  });

  it("drop video once the consultation has moved to the phone", () => {
    expect(joinAvailability(view({ final_media_mode: "phone" }))).toEqual({ video: false, audio: true });
  });

  it("are off once the consultation is over", () => {
    expect(joinAvailability(view({ status: "cancelled" }))).toEqual({ video: false, audio: false });
  });
});

describe("tell us nobody came", () => {
  it("shows only when the server's own flag says so", () => {
    expect(canTellNobodyCame(view())).toBe(false);
    expect(canTellNobodyCame(view({ can_report_clinician_absent: true }))).toBe(true);
    expect(canTellNobodyCame(view({ can_report_clinician_absent: true, status: "completed" }))).toBe(false);
  });
});

describe("tap-to-call link", () => {
  it("keeps a leading plus and digits only", () => {
    expect(telUrl("+234 1 700 6000")).toBe("tel:+23417006000");
    expect(telUrl("(01) 700-6000")).toBe("tel:017006000");
  });

  it("refuses something that is not a number, so nothing else can ride in the link", () => {
    expect(telUrl("")).toBeNull();
    expect(telUrl("call me")).toBeNull();
    expect(telUrl("+2348001234567;rm -rf")).toBe("tel:+2348001234567");
    expect(telUrl("+23")).toBeNull();
  });
});

describe("time", () => {
  it("is shown in Africa/Lagos whatever the phone's zone", () => {
    // 23:30 UTC on the 6th is 00:30 on the 7th in Lagos (UTC+1).
    expect(formatWhen("2026-10-06T23:30:00Z")).toContain("00:30");
    expect(formatWhen("2026-10-06T23:30:00Z")).toContain("7");
    expect(formatWhen("not a date")).toBe("");
  });
});

describe("parsing what the server returns", () => {
  it("accepts a well-formed room view and rejects anything else", () => {
    expect(parseRoomView(view())).not.toBeNull();
    expect(parseRoomView(null)).toBeNull();
    expect(parseRoomView({})).toBeNull();
    expect(parseRoomView({ ...view(), role: "stranger" })).toBeNull();
    expect(parseRoomView({ ...view(), scribe: undefined })).toBeNull();
    // The consent answer is exactly yes, no or not yet: a renamed or missing field must not read as "answered".
    expect(parseRoomView({ ...view(), scribe: { asked: true } })).toBeNull();
    expect(parseRoomView({ ...view(), scribe: { asked: true, granted: "yes" } })).toBeNull();
    expect(parseRoomView({ ...view(), scribe: { asked: true, granted: false } })).not.toBeNull();
    expect(parseRoomView({ ...view(), joinable: "yes" })).toBeNull();
    // No active policy: the server answers null for both. That is "not joinable yet", not an error.
    expect(parseRoomView({ ...view(), joinable: null, join_opens_at: null })).toMatchObject({ joinable: false, join_opens_at: "" });
  });

  it("accepts a list of upcoming consultations and rejects a changed shape", () => {
    const row = { encounter_id: "e1", type: "video", status: "scheduled", scheduled_at: "2026-10-07T09:00:00Z", appointment_id: null, final_media_mode: null };
    expect(parseUpcoming([row])).toHaveLength(1);
    expect(parseUpcoming([])).toEqual([]);
    expect(parseUpcoming({})).toBeNull();
    expect(parseUpcoming([{ ...row, encounter_id: 1 }])).toBeNull();
  });
});

describe("join link check", () => {
  it("opens only ordinary https addresses", () => {
    expect(isOpenableJoinUrl("https://zoom.example/j/1?pwd=x")).toBe(true);
    expect(isOpenableJoinUrl("http://zoom.example/j/1")).toBe(false);
    expect(isOpenableJoinUrl("tel:+2348001234567")).toBe(false);
    expect(isOpenableJoinUrl("intent://scan#Intent;end")).toBe(false);
    expect(isOpenableJoinUrl("not a url")).toBe(false);
  });
});
