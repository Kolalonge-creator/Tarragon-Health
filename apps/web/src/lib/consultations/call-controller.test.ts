import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { CallController, type CallNotice, type CallPolicy } from "./call-controller";
import type { ZoomEmbeddedClient } from "./zoom-sdk";
import type { CallEventReport } from "./room";

const audio = getProposedConfig<Omit<CallPolicy, "reconnectGraceSeconds">>("video.audio_fallback").value;
const grace = getProposedConfig<{ reconnectGraceSeconds: number }>("consultations.policy").value.reconnectGraceSeconds;
const policy: CallPolicy = { ...audio, reconnectGraceSeconds: grace };
const STEP = policy.sampleIntervalSeconds * 1000;
const SELF = 42;

function fakeClient() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const client: ZoomEmbeddedClient = {
    init: async () => undefined,
    join: async () => undefined,
    on: (e, cb) => void (handlers.get(e) ?? handlers.set(e, new Set()).get(e)!).add(cb),
    off: (e, cb) => void handlers.get(e)?.delete(cb),
    subscribeStatisticData: jest.fn(async () => undefined),
    unSubscribeStatisticData: jest.fn(async () => undefined),
    getCurrentUser: () => ({ userId: SELF }),
    leaveMeeting: async () => undefined,
    endMeeting: async () => undefined,
    checkSystemRequirements: () => ({ audio: true, video: true, screen: true }),
  };
  const emit = (event: string, payload: unknown) => handlers.get(event)?.forEach((cb) => cb(payload));
  return { client, emit, count: (e: string) => handlers.get(e)?.size ?? 0 };
}

let clock = 0;
function setup(over: { role?: "patient" | "clinician"; initialMode?: "video" | "audio_only" | "phone"; report?: (r: CallEventReport) => Promise<{ ok: boolean }> } = {}) {
  const f = fakeClient();
  const reports: CallEventReport[] = [];
  const notices: CallNotice[] = [];
  const closed = jest.fn();
  const phone = jest.fn();
  const c = new CallController({
    client: f.client,
    policy,
    role: over.role ?? "patient",
    initialMode: over.initialMode ?? "video",
    now: () => clock,
    report: over.report ?? (async (r) => (reports.push(r), { ok: true })),
    onNotice: (n) => notices.push(n),
    onClosed: closed,
    onPhone: phone,
  });
  c.start();
  return { ...f, c, reports, notices, closed, phone };
}
const flush = () => Promise.resolve().then(() => Promise.resolve());

/** One audio statistics reading per interval, so each is its own ladder sample. */
function audioSample(f: ReturnType<typeof setup>, kind: "poor" | "good") {
  clock += STEP;
  f.emit("audio-statistic-data-change", { type: "AUDIO_QOS_DATA", data: kind === "poor" ? { avg_loss: 99, rtt: 5, encoding: true } : { avg_loss: 0, rtt: 5, encoding: true } });
}

beforeEach(() => {
  jest.useFakeTimers();
  clock = 1_000_000;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("video to audio only", () => {
  it("one poor sample changes nothing; a sustained run records audio only and tells the person to switch their camera off", async () => {
    const f = setup();
    audioSample(f, "poor");
    expect(f.notices).toEqual([]);
    for (let i = 1; i < policy.poorSamplesToDowngrade; i++) audioSample(f, "poor");
    await flush();
    expect(f.notices).toEqual(["audio_only"]);
    expect(f.reports).toEqual([{ kind: "mode_changed", mode: "audio_only" }]);
    expect(f.c.mode).toBe("audio_only");
  });

  it("thins statistics to one sample per interval, so a burst of readings is one sample", () => {
    const f = setup();
    clock += STEP;
    for (let i = 0; i < 20; i++) f.emit("audio-statistic-data-change", { data: { avg_loss: 99, rtt: 1, encoding: false } });
    expect(f.c.mode).toBe("video");
    expect(f.notices).toEqual([]);
  });

  it("reads the vendor's network level while the camera is on, but only for the person's own link", () => {
    const f = setup();
    for (let i = 0; i < policy.poorSamplesToDowngrade; i++) {
      clock += STEP;
      f.emit("network-quality-change", { level: 4, type: "uplink", userId: 7 }); // someone else, ignored
      f.emit("network-quality-change", { level: 0, type: i % 2 ? "downlink" : "uplink", userId: SELF });
    }
    expect(f.c.mode).toBe("audio_only");
  });

  it("ignores readings it cannot use", () => {
    const f = setup();
    f.emit("network-quality-change", { level: 99, type: "uplink", userId: SELF });
    f.emit("network-quality-change", null);
    f.emit("audio-statistic-data-change", { data: {} });
    f.emit("audio-statistic-data-change", "nope");
    expect(f.notices).toEqual([]);
  });

  it("the vendor reports its network level when it CHANGES, so one poor level stays true until replaced and the call downgrades while audio looks fine", () => {
    const f = setup();
    clock += STEP;
    f.emit("network-quality-change", { level: 0, type: "uplink", userId: SELF });
    for (let i = 0; i < policy.poorSamplesToDowngrade - 1; i++) audioSample(f, "good");
    expect(f.c.mode).toBe("audio_only");
  });

  it("but a level cannot stay true for ever (it stops arriving when the camera goes off): it expires after the time a downgrade takes", () => {
    const f = setup();
    clock += STEP;
    f.emit("network-quality-change", { level: 0, type: "uplink", userId: SELF });
    clock += STEP * policy.poorSamplesToDowngrade * 2;
    for (let i = 0; i < policy.poorSamplesToDowngrade + 2; i++) audioSample(f, "good");
    expect(f.c.mode).toBe("video");
  });

  it("counts a network level that arrives with no self user as nothing", () => {
    const f = setup();
    f.client.getCurrentUser = () => null;
    for (let i = 0; i < 5; i++) {
      clock += STEP;
      f.emit("network-quality-change", { level: 0, type: "uplink", userId: SELF });
    }
    expect(f.c.mode).toBe("video");
  });
});

describe("audio only back to video", () => {
  async function downgraded(role: "patient" | "clinician") {
    const f = setup({ role });
    for (let i = 0; i < policy.poorSamplesToDowngrade; i++) audioSample(f, "poor");
    await flush();
    f.reports.length = 0;
    f.notices.length = 0;
    return f;
  }

  it("offers video to the patient after a sustained good run, and only the patient's tap brings it back", async () => {
    const f = await downgraded("patient");
    for (let i = 0; i < policy.goodSamplesToOfferVideo; i++) audioSample(f, "good");
    await flush();
    expect(f.notices).toEqual(["offer_video"]);
    expect(f.reports).toEqual([{ kind: "fallback_offered" }]);
    expect(f.c.mode).toBe("audio_only"); // never by itself
    f.c.patientTakesVideo();
    await flush();
    expect(f.c.mode).toBe("video");
    expect(f.notices).toEqual(["offer_video", "video_back"]);
    expect(f.reports.at(-1)).toEqual({ kind: "mode_changed", mode: "video" });
  });

  it("never offers anything to the clinician, and the clinician cannot take video for the patient", async () => {
    const f = await downgraded("clinician");
    for (let i = 0; i < policy.goodSamplesToOfferVideo + 2; i++) audioSample(f, "good");
    await flush();
    expect(f.notices).toEqual([]);
    expect(f.reports).toEqual([]);
    f.c.patientTakesVideo();
    expect(f.c.mode).toBe("audio_only");
  });
});

describe("a lost connection", () => {
  it("holds the place, then says so when the link returns inside the window", async () => {
    const f = setup();
    f.emit("connection-change", { state: "Reconnecting" });
    await flush();
    expect(f.notices).toEqual(["held_place"]);
    expect(f.reports).toEqual([{ kind: "reconnect_grace_started" }]);
    clock += (grace - 1) * 1000;
    jest.advanceTimersByTime((grace - 1) * 1000);
    expect(f.phone).not.toHaveBeenCalled();
    f.emit("connection-change", { state: "Connected" });
    expect(f.notices).toEqual(["held_place", "reconnected"]);
    // the clock stops running once the person is back
    jest.advanceTimersByTime(10 * grace * 1000);
    expect(f.phone).not.toHaveBeenCalled();
  });

  it("moves to the phone by itself when the window runs out, once, and shows the phone card", async () => {
    const f = setup();
    f.emit("connection-change", { state: "Reconnecting" });
    clock += grace * 1000;
    jest.advanceTimersByTime(grace * 1000);
    expect(f.notices).toEqual(["held_place", "phone"]);
    expect(f.phone).toHaveBeenCalledTimes(1);
    // phone is the end of the ladder: nothing else fires, and the server is never told the consultation is on the phone
    jest.advanceTimersByTime(60_000);
    f.emit("connection-change", { state: "Connected" });
    expect(f.phone).toHaveBeenCalledTimes(1);
    expect(f.reports.every((r) => r.kind !== ("phone" as never))).toBe(true);
    expect(f.c.mode).toBe("phone");
  });

  it("a second drop notice while already holding does not start a second clock", () => {
    const f = setup();
    f.emit("connection-change", { state: "Reconnecting" });
    f.emit("connection-change", { state: "Reconnecting" });
    expect(f.notices).toEqual(["held_place"]);
  });

  it("a close that arrives while a drop is being held means the link is gone for good: the phone card is shown at once, not nothing", () => {
    const f = setup();
    f.emit("connection-change", { state: "Reconnecting" });
    f.emit("connection-change", { state: "Closed" });
    expect(f.notices).toEqual(["held_place", "phone"]);
    expect(f.phone).toHaveBeenCalledTimes(1);
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.c.mode).toBe("phone");
    // and the clock that was counting down has stopped, so nothing fires a second time
    jest.advanceTimersByTime(10 * grace * 1000);
    expect(f.phone).toHaveBeenCalledTimes(1);
  });

  it("closing is the call ending, not a lost connection", () => {
    const f = setup();
    f.emit("connection-change", { state: "Closed" });
    expect(f.closed).toHaveBeenCalledTimes(1);
    expect(f.notices).toEqual([]);
    f.emit("connection-change", { state: "Fail" });
    f.emit("connection-change", undefined);
    expect(f.closed).toHaveBeenCalledTimes(1);
  });
});

describe("reports and cleanup", () => {
  it("shows a notice when the server refuses or fails to take a report, and does not break the call", async () => {
    for (const report of [async () => ({ ok: false }), async () => Promise.reject(new Error("offline"))]) {
      const f = setup({ report });
      for (let i = 0; i < policy.poorSamplesToDowngrade; i++) audioSample(f, "poor");
      await flush();
      await flush();
      expect(f.notices).toEqual(["audio_only", "report_failed"]);
      expect(f.c.mode).toBe("audio_only");
    }
  });

  it("starts in audio only when the consultation already is, and does nothing once on the phone", () => {
    const a = setup({ initialMode: "audio_only" });
    expect(a.c.mode).toBe("audio_only");
    const p = setup({ initialMode: "phone" });
    p.emit("connection-change", { state: "Reconnecting" });
    expect(p.notices).toEqual([]);
  });

  it("subscribes to audio statistics, tolerates the SDK refusing that, and stops listening on stop", async () => {
    const f = setup();
    expect(f.client.subscribeStatisticData).toHaveBeenCalledWith({ audio: true, video: false, share: false });
    expect(f.count("connection-change")).toBe(1);
    f.c.stop();
    expect(f.count("connection-change")).toBe(0);
    expect(f.client.unSubscribeStatisticData).toHaveBeenCalled();
    // after stop, a late event changes nothing
    f.emit("connection-change", { state: "Reconnecting" });
    expect(f.notices).toEqual([]);

    const g = fakeClient();
    g.client.subscribeStatisticData = async () => Promise.reject(new Error("nope"));
    g.client.unSubscribeStatisticData = async () => Promise.reject(new Error("nope"));
    const c = new CallController({ client: g.client, policy, role: "patient", initialMode: "video", now: () => clock, report: async () => ({ ok: true }), onNotice: () => undefined, onClosed: () => undefined, onPhone: () => undefined });
    c.start();
    c.stop();
    await flush();
  });
});
