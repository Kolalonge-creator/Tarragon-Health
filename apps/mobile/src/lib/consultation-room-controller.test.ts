import { t } from "@tarragon/i18n";
import { RoomController, noteMessageKey, type RoomNote, type RoomPorts, type RoomState } from "./consultation-room-controller";
import { ROOM_POLL_MS, type RoomView } from "./consultation-room-model";

const SECRET_URL = "https://zoom.example/j/987654?pwd=SECRETPASS";

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

function ports(over: Partial<RoomPorts> = {}): jest.Mocked<RoomPorts> {
  return {
    loadRoom: jest.fn().mockResolvedValue({ ok: true, data: view() }),
    join: jest.fn().mockResolvedValue({ ok: true, data: { ok: true, url: SECRET_URL, mediaMode: "video", audioOnlyEnforced: false, recorded: true } }),
    dialIn: jest.fn().mockResolvedValue({ ok: true, data: { ok: true, dialIn: { numbers: [{ number: "+234 1 700 6000" }], meetingId: "123 456", passcode: "7788" } } }),
    answerScribe: jest.fn().mockResolvedValue(true),
    reportNobodyCame: jest.fn().mockResolvedValue("ok"),
    openUrl: jest.fn().mockResolvedValue(true),
    ...over,
  } as jest.Mocked<RoomPorts>;
}

async function started(p: jest.Mocked<RoomPorts>): Promise<RoomController> {
  const c = new RoomController("e1", p);
  c.start();
  await c.refresh();
  return c;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("loading", () => {
  it("shows the room once the server has answered", async () => {
    const c = await started(ports());
    expect(c.getState()).toMatchObject({ loading: false, offline: false, notFound: false });
    expect(c.getState().view?.encounter_id).toBe("e1");
    c.stop();
  });

  it("says not found for a consultation that is not this patient's", async () => {
    const c = await started(ports({ loadRoom: jest.fn().mockResolvedValue({ ok: true, data: null }) }));
    expect(c.getState()).toMatchObject({ notFound: true, view: null, offline: false });
    c.stop();
  });

  it("says offline, not not-found, when the server cannot be reached, and keeps trying", async () => {
    const p = ports({ loadRoom: jest.fn().mockResolvedValue({ ok: false }) });
    const c = await started(p);
    expect(c.getState()).toMatchObject({ loading: false, offline: true, notFound: false, view: null });
    p.loadRoom.mockResolvedValue({ ok: true, data: view() });
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 2);
    expect(c.getState()).toMatchObject({ offline: false });
    expect(c.getState().view).not.toBeNull();
    c.stop();
  });

  it("keeps the last view on screen, flagged offline, when a later refresh fails", async () => {
    const p = ports();
    const c = await started(p);
    p.loadRoom.mockResolvedValue({ ok: false });
    await c.refresh();
    expect(c.getState().offline).toBe(true);
    expect(c.getState().view?.encounter_id).toBe("e1");
    c.stop();
  });
});

describe("polling", () => {
  it("refreshes no faster than every 10 seconds, and never overlaps two refreshes", async () => {
    const p = ports();
    const c = new RoomController("e1", p);
    c.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(p.loadRoom).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS - 1);
    expect(p.loadRoom).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(p.loadRoom).toHaveBeenCalledTimes(2);
    // Two calls at once share one request.
    void c.refresh();
    void c.refresh();
    await jest.advanceTimersByTimeAsync(0);
    expect(p.loadRoom).toHaveBeenCalledTimes(3);
    c.stop();
  });

  it("stops while the app is in the background and catches up when it returns", async () => {
    const p = ports();
    const c = await started(p);
    c.setForeground(false);
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 5);
    expect(p.loadRoom).toHaveBeenCalledTimes(1);
    c.setForeground(true);
    await jest.advanceTimersByTimeAsync(0);
    expect(p.loadRoom).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("stops polling once the consultation has ended", async () => {
    const p = ports({ loadRoom: jest.fn().mockResolvedValue({ ok: true, data: view({ status: "completed" }) }) });
    const c = await started(p);
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 5);
    expect(p.loadRoom).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it("keeps polling a not-found consultation, at half the pace, so it recovers when it appears or the session is renewed", async () => {
    const p = ports({ loadRoom: jest.fn().mockResolvedValue({ ok: true, data: null }) });
    const c = await started(p);
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 2);
    expect(p.loadRoom).toHaveBeenCalledTimes(2);
    p.loadRoom.mockResolvedValue({ ok: true, data: view() });
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 2);
    expect(c.getState()).toMatchObject({ notFound: false });
    expect(c.getState().view).not.toBeNull();
    c.stop();
  });

  it("keeps trying, slowly, when a retry on a not-found screen fails offline", async () => {
    const p = ports({ loadRoom: jest.fn().mockResolvedValue({ ok: true, data: null }) });
    const c = await started(p);
    p.loadRoom.mockResolvedValue({ ok: false });
    await c.refresh();
    expect(c.getState()).toMatchObject({ notFound: true, offline: true });
    p.loadRoom.mockResolvedValue({ ok: true, data: view() });
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 2);
    expect(c.getState()).toMatchObject({ notFound: false, offline: false });
    c.stop();
  });

  it("treats a load that throws as offline and recovers on the next poll", async () => {
    const p = ports({ loadRoom: jest.fn().mockImplementation(() => { throw new Error("sync boom"); }) });
    const c = new RoomController("e1", p);
    c.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(c.getState()).toMatchObject({ loading: false, offline: true });
    p.loadRoom.mockResolvedValue({ ok: true, data: view() });
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 2);
    expect(c.getState()).toMatchObject({ offline: false });
    expect(c.getState().view).not.toBeNull();
    c.stop();
  });

  it("stops for good after stop()", async () => {
    const p = ports();
    const c = await started(p);
    c.stop();
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS * 5);
    expect(p.loadRoom).toHaveBeenCalledTimes(1);
  });
});

describe("join", () => {
  it("hands the server-issued link to the Zoom app and keeps it nowhere", async () => {
    const p = ports();
    const c = await started(p);
    await c.join("video");
    expect(p.join).toHaveBeenCalledWith("e1", "video");
    expect(p.openUrl).toHaveBeenCalledWith(SECRET_URL);
    expect(JSON.stringify(c.getState())).not.toContain("SECRETPASS");
    expect(JSON.stringify(c.getState())).not.toContain("zoom.example");
    expect(c.getState().note).toBeNull();
    c.stop();
  });

  it("reminds the patient about the camera after an audio only join", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: true, data: { ok: true, url: SECRET_URL, mediaMode: "audio_only", audioOnlyEnforced: false, recorded: true } }) });
    const c = await started(p);
    await c.join("audio_only");
    expect(c.getState().audioHint).toBe(true);
    c.stop();
  });

  it("says the place is safe, and opens nothing, when the server could not issue a link", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: true, data: { ok: false, reason: "provider" } }) });
    const c = await started(p);
    await c.join("video");
    expect(c.getState().note).toEqual({ kind: "link_error" });
    expect(p.openUrl).not.toHaveBeenCalled();
    c.stop();
  });

  it("says when the room opens if it is too early", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: true, data: { ok: false, reason: "not_open", opensAt: "2026-10-07T08:50:00Z" } }) });
    const c = await started(p);
    await c.join("video");
    expect(c.getState().note).toEqual({ kind: "not_open" });
    c.stop();
  });

  it("flags offline when the request never got an answer", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: false, offline: true, unavailable: false }) });
    const c = await started(p);
    await c.join("video");
    expect(c.getState()).toMatchObject({ note: { kind: "link_error" }, offline: true });
    c.stop();
  });

  it("refuses to open anything that is not an https address", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: true, data: { ok: true, url: "tel:+2348001234567", mediaMode: "video", audioOnlyEnforced: false, recorded: true } }) });
    const c = await started(p);
    await c.join("video");
    expect(p.openUrl).not.toHaveBeenCalled();
    expect(c.getState().note).toEqual({ kind: "link_error" });
    c.stop();
  });

  it("reports a link error, without the link, if the Zoom app cannot be opened", async () => {
    const p = ports({ openUrl: jest.fn().mockRejectedValue(new Error(`cannot open ${SECRET_URL}`)) });
    const c = await started(p);
    await c.join("video");
    expect(c.getState().note).toEqual({ kind: "link_error" });
    expect(JSON.stringify(c.getState())).not.toContain("SECRETPASS");
    c.stop();
  });

  it("refreshes to the true state when the server says the room is closed", async () => {
    const p = ports({ join: jest.fn().mockResolvedValue({ ok: true, data: { ok: false, reason: "closed" } }) });
    const c = await started(p);
    p.loadRoom.mockResolvedValue({ ok: true, data: view({ status: "completed" }) });
    await c.join("video");
    expect(c.getState().view?.status).toBe("completed");
    c.stop();
  });

  it("ignores a second tap while one is in flight", async () => {
    let release: (v: unknown) => void = () => {};
    const p = ports({ join: jest.fn().mockReturnValue(new Promise((r) => (release = r))) });
    const c = await started(p);
    const first = c.join("video");
    void c.join("video");
    expect(p.join).toHaveBeenCalledTimes(1);
    release({ ok: false, offline: false, unavailable: true });
    await first;
    c.stop();
  });
});

describe("join by phone call", () => {
  it("keeps the numbers, meeting id and passcode in state for the screen, and nowhere else", async () => {
    const p = ports();
    const c = await started(p);
    await c.phoneFallback();
    expect(p.dialIn).toHaveBeenCalledWith("e1");
    expect(c.getState().dialIn).toEqual({ numbers: [{ number: "+234 1 700 6000" }], meetingId: "123 456", passcode: "7788" });
    c.stop();
  });

  it("drops the numbers once the consultation has ended", async () => {
    const p = ports();
    const c = await started(p);
    await c.phoneFallback();
    p.loadRoom.mockResolvedValue({ ok: true, data: view({ status: "completed" }) });
    await c.refresh();
    expect(c.getState().dialIn).toBeNull();
    c.stop();
  });

  it("explains a refusal in words, with no number shown", async () => {
    const early = ports({ dialIn: jest.fn().mockResolvedValue({ ok: true, data: { ok: false, reason: "not_open" } }) });
    const a = await started(early);
    await a.phoneFallback();
    expect(a.getState()).toMatchObject({ note: { kind: "phone_not_open" }, dialIn: null });
    a.stop();

    const none = ports({ dialIn: jest.fn().mockResolvedValue({ ok: true, data: { ok: false, reason: "phone_unavailable" } }) });
    const b = await started(none);
    await b.phoneFallback();
    expect(b.getState()).toMatchObject({ note: { kind: "phone_unavailable" }, dialIn: null });
    b.stop();
  });

  it("says the place is safe when the request never got an answer", async () => {
    const p = ports({ dialIn: jest.fn().mockResolvedValue({ ok: false, offline: true, unavailable: false }) });
    const c = await started(p);
    await c.phoneFallback();
    expect(c.getState()).toMatchObject({ note: { kind: "link_error" }, offline: true, dialIn: null });
    c.stop();
  });

  it("keeps the try-again wording for a server hiccup or an expired session", async () => {
    const p = ports({ dialIn: jest.fn().mockResolvedValue({ ok: false, offline: false, unavailable: false }) });
    const c = await started(p);
    await c.phoneFallback();
    expect(c.getState()).toMatchObject({ note: { kind: "link_error" }, dialIn: null });
    c.stop();
  });

  it("says there is no number to give when the server says the vendor is not set up (503)", async () => {
    const p = ports({ dialIn: jest.fn().mockResolvedValue({ ok: false, offline: false, unavailable: true }) });
    const c = await started(p);
    await c.phoneFallback();
    expect(c.getState()).toMatchObject({ note: { kind: "phone_unavailable" }, dialIn: null });
    c.stop();
  });
});

describe("AI note-taker question", () => {
  it("shows the answer as saved only after the server confirmed it", async () => {
    const p = ports();
    const c = await started(p);
    p.loadRoom.mockResolvedValue({ ok: true, data: view({ scribe: { asked: true, granted: true } }) });
    await c.answerScribe(true);
    expect(p.answerScribe).toHaveBeenCalledWith("e1", true, false);
    expect(c.getState().view?.scribe).toEqual({ asked: true, granted: true });
    expect(c.getState().note).toBeNull();
    c.stop();
  });

  it("does not let a poll that was already in flight bring the question back after it was answered", async () => {
    // The 10 second poll goes out before the patient answers; its answer (granted null) lands after the save.
    let answerStalePoll: (v: { ok: true; data: RoomView }) => void = () => {};
    const p = ports();
    const c = await started(p);
    p.loadRoom.mockReturnValueOnce(new Promise((r) => (answerStalePoll = r)));
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS);
    p.loadRoom.mockResolvedValue({ ok: true, data: view({ scribe: { asked: true, granted: true } }) });
    const answering = c.answerScribe(true);
    await jest.advanceTimersByTimeAsync(0);
    answerStalePoll({ ok: true, data: view() });
    await answering;
    expect(c.getState().view?.scribe).toEqual({ asked: true, granted: true });
    c.stop();
  });

  it("keeps the answer on screen when the load after saving fails (offline)", async () => {
    let answerStalePoll: (v: { ok: true; data: RoomView }) => void = () => {};
    const p = ports();
    const c = await started(p);
    p.loadRoom.mockReturnValueOnce(new Promise((r) => (answerStalePoll = r)));
    await jest.advanceTimersByTimeAsync(ROOM_POLL_MS);
    p.loadRoom.mockResolvedValue({ ok: false });
    const answering = c.answerScribe(true);
    await jest.advanceTimersByTimeAsync(0);
    answerStalePoll({ ok: true, data: view() });
    await answering;
    expect(c.getState().view?.scribe).toEqual({ asked: true, granted: true });
    expect(c.getState().offline).toBe(true);
    c.stop();
  });

  it("never looks saved when the save failed: the question stays and an error shows", async () => {
    const p = ports({ answerScribe: jest.fn().mockResolvedValue(false) });
    const c = await started(p);
    await c.answerScribe(true);
    expect(c.getState().view?.scribe.granted).toBeNull();
    expect(c.getState().note).toEqual({ kind: "save_error" });
    c.stop();
  });

  it("records a withdrawal as a false answer", async () => {
    const p = ports({ loadRoom: jest.fn().mockResolvedValue({ ok: true, data: view({ scribe: { asked: true, granted: true } }) }) });
    const c = await started(p);
    p.loadRoom.mockResolvedValue({ ok: true, data: view({ scribe: { asked: true, granted: false } }) });
    await c.answerScribe(false);
    expect(p.answerScribe).toHaveBeenCalledWith("e1", false, true);
    expect(c.getState().view?.scribe.granted).toBe(false);
    c.stop();
  });
});

describe("tell us nobody came", () => {
  it("passes the server's wait rule through as a message", async () => {
    const p = ports({ reportNobodyCame: jest.fn().mockResolvedValue("wait_longer") });
    const c = await started(p);
    await c.tellNobodyCame();
    expect(c.getState().note).toEqual({ kind: "wait_longer" });
    c.stop();
  });

  it("shows a save error when it fails and refreshes when it works", async () => {
    const failing = ports({ reportNobodyCame: jest.fn().mockResolvedValue("failed") });
    const a = await started(failing);
    await a.tellNobodyCame();
    expect(a.getState().note).toEqual({ kind: "save_error" });
    a.stop();

    const ok = ports();
    const b = await started(ok);
    ok.loadRoom.mockResolvedValue({ ok: true, data: view({ status: "no_show_clinician" }) });
    await b.tellNobodyCame();
    expect(b.getState().view?.status).toBe("no_show_clinician");
    b.stop();
  });
});

describe("note wording", () => {
  const kinds: RoomNote["kind"][] = ["link_error", "not_open", "wait_longer", "save_error", "phone_unavailable", "phone_not_open"];
  it("has real wording in English and Pidgin for every note, with no raw key shown", () => {
    for (const kind of kinds) {
      const key = noteMessageKey({ kind });
      for (const locale of ["en", "pcm"] as const) {
        const text = t(key, locale, { when: "Wed 09:00" });
        expect(text).not.toBe(key);
        expect(text.length).toBeGreaterThan(5);
      }
    }
  });
});

describe("subscription", () => {
  it("tells listeners about each change and stops after unsubscribe", async () => {
    const seen: RoomState[] = [];
    const c = new RoomController("e1", ports());
    const off = c.subscribe((s) => seen.push(s));
    c.start();
    await c.refresh();
    expect(seen.length).toBeGreaterThan(0);
    const count = seen.length;
    off();
    await c.refresh();
    expect(seen.length).toBe(count);
    c.stop();
  });
});
