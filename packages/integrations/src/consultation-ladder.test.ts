import { describe, expect, it } from "@jest/globals";
import {
  INITIAL_LADDER,
  remainingSessionMs,
  stepLadder,
  type LadderInput,
  type LadderPolicy,
  type LadderState,
} from "../../../supabase/functions/_shared/integrations/index.ts";
import { getProposedConfig } from "../../shared/src/proposed-config/index";

const base = getProposedConfig<{ poorSamplesToDowngrade: number; goodSamplesToOfferVideo: number; poorBelowKbps: number }>("video.audio_fallback").value;
const grace = getProposedConfig<{ reconnectGraceSeconds: number }>("consultations.policy").value.reconnectGraceSeconds;
const policy: LadderPolicy = { ...base, reconnectGraceSeconds: grace };
const GRACE_MS = grace * 1000;

const poor = (atMs: number): LadderInput => ({ kind: "sample", sample: { quality: "poor" }, atMs });
const good = (atMs: number): LadderInput => ({ kind: "sample", sample: { quality: "good", bitrateKbps: 900 }, atMs });

function run(inputs: readonly LadderInput[], from: LadderState = INITIAL_LADDER) {
  let state = from;
  const actions: (string | null)[] = [];
  for (const i of inputs) {
    const s = stepLadder(state, i, policy);
    state = s.state;
    actions.push(s.action);
  }
  return { state, actions };
}
const downgraded = (): LadderState => run([poor(1), poor(2), poor(3)]).state;
const offered = (): LadderState => run([good(10), good(11), good(12), good(13), good(14), good(15)], downgraded()).state;

describe("consultation ladder", () => {
  it("starts in video, connected, with no pause", () => {
    expect(INITIAL_LADDER).toMatchObject({ mode: "video", lostAtMs: null, pausedMs: 0 });
  });

  describe("video to audio only", () => {
    it("one poor sample never downgrades", () => {
      const r = run([poor(1)]);
      expect(r.state.mode).toBe("video");
      expect(r.actions).toEqual([null]);
    });
    it("a sustained poor run downgrades once, then stays quiet", () => {
      const r = run([poor(1), poor(2), poor(3), poor(4)]);
      expect(r.state.mode).toBe("audio_only");
      expect(r.actions).toEqual([null, null, "to_audio_only", null]);
    });
    it("a good sample in the middle resets the run", () => {
      expect(run([poor(1), poor(2), good(3), poor(4), poor(5)]).state.mode).toBe("video");
    });
  });

  describe("audio only back to video", () => {
    it("offers video after a sustained good run, but never switches by itself", () => {
      const r = run([good(10), good(11), good(12), good(13), good(14), good(15)], downgraded());
      expect(r.state.mode).toBe("audio_only");
      expect(r.state.fallback.videoOffered).toBe(true);
      expect(r.actions.at(-1)).toBe("offer_video");
    });
    it("a bad sample withdraws an offer that nobody took up", () => {
      const r = run([poor(20)], offered());
      expect(r.state.fallback.videoOffered).toBe(false);
    });
    it("the patient taking the offer returns to video and starts counting afresh", () => {
      const s = stepLadder(offered(), { kind: "patient_takes_video", atMs: 30 }, policy);
      expect(s.action).toBe("to_video");
      expect(s.state.mode).toBe("video");
      expect(s.state.fallback.videoOffered).toBe(false);
    });
    it("taking video is refused when none was offered, when already in video, and while the connection is down", () => {
      expect(stepLadder(downgraded(), { kind: "patient_takes_video", atMs: 30 }, policy).action).toBeNull();
      expect(stepLadder(INITIAL_LADDER, { kind: "patient_takes_video", atMs: 30 }, policy).action).toBeNull();
      const down = stepLadder(offered(), { kind: "lost", atMs: 40 }, policy).state;
      expect(stepLadder(down, { kind: "patient_takes_video", atMs: 41 }, policy).action).toBeNull();
    });
  });

  describe("a lost connection", () => {
    it("starts a grace window once, and further loss reports change nothing", () => {
      const r = run([{ kind: "lost", atMs: 100 }, { kind: "lost", atMs: 200 }]);
      expect(r.actions).toEqual(["grace_started", null]);
      expect(r.state.lostAtMs).toBe(100);
    });
    it("ignores quality samples while it is down", () => {
      const r = run([{ kind: "lost", atMs: 100 }, poor(110), poor(120), poor(130)]);
      expect(r.state.mode).toBe("video");
      expect(r.actions.slice(1)).toEqual([null, null, null]);
    });
    it("coming back inside the window keeps the mode, pauses the clock for the gap and restarts the count", () => {
      const r = run([poor(1), poor(2), { kind: "lost", atMs: 1_000 }, { kind: "restored", atMs: 31_000 }]);
      expect(r.state.mode).toBe("video");
      expect(r.state.lostAtMs).toBeNull();
      expect(r.state.pausedMs).toBe(30_000);
      expect(r.state.fallback.poorStreak).toBe(0);
      expect(r.actions.at(-1)).toBe("reconnected");
    });
    it("a restore with nothing lost does nothing", () => {
      expect(stepLadder(INITIAL_LADDER, { kind: "restored", atMs: 5 }, policy).action).toBeNull();
    });
    it("the pause is capped at the grace window, however long the gap", () => {
      const r = run([{ kind: "lost", atMs: 0 }, { kind: "restored", atMs: GRACE_MS * 10 }]);
      expect(r.state.pausedMs).toBe(GRACE_MS);
    });
    it("a restore stamped before the loss cannot make the pause negative", () => {
      const r = run([{ kind: "lost", atMs: 500 }, { kind: "restored", atMs: 100 }]);
      expect(r.state.pausedMs).toBe(0);
    });
    it("a tick inside the window does nothing", () => {
      const r = run([{ kind: "lost", atMs: 0 }, { kind: "tick", atMs: GRACE_MS - 1 }]);
      expect(r.state.mode).toBe("video");
      expect(r.actions.at(-1)).toBeNull();
    });
    it("a tick with nothing lost does nothing", () => {
      expect(stepLadder(INITIAL_LADDER, { kind: "tick", atMs: 10 ** 9 }, policy).action).toBeNull();
    });
    it("a tick at the end of the window moves the call to the phone, paused for exactly the grace", () => {
      const r = run([{ kind: "lost", atMs: 0 }, { kind: "tick", atMs: GRACE_MS }]);
      expect(r.state).toMatchObject({ mode: "phone", lostAtMs: null, pausedMs: GRACE_MS });
      expect(r.actions.at(-1)).toBe("to_phone");
    });
  });

  describe("the phone", () => {
    it("the patient can ask for it at any time, with no loss", () => {
      const s = stepLadder(INITIAL_LADDER, { kind: "patient_requests_phone", atMs: 5 }, policy);
      expect(s.action).toBe("to_phone");
      expect(s.state).toMatchObject({ mode: "phone", pausedMs: 0 });
    });
    it("asking during a drop pauses the clock for the time so far, capped at the grace", () => {
      const down = stepLadder(INITIAL_LADDER, { kind: "lost", atMs: 0 }, policy).state;
      expect(stepLadder(down, { kind: "patient_requests_phone", atMs: 20_000 }, policy).state.pausedMs).toBe(20_000);
      expect(stepLadder(down, { kind: "patient_requests_phone", atMs: GRACE_MS * 5 }, policy).state.pausedMs).toBe(GRACE_MS);
      expect(stepLadder(down, { kind: "patient_requests_phone", atMs: -50 }, policy).state.pausedMs).toBe(0);
    });
    it("is the end of the ladder: nothing moves it again", () => {
      const phone = run([{ kind: "patient_requests_phone", atMs: 1 }]).state;
      const inputs: LadderInput[] = [poor(2), good(3), { kind: "lost", atMs: 4 }, { kind: "restored", atMs: 5 }, { kind: "tick", atMs: 10 ** 9 }, { kind: "patient_requests_phone", atMs: 6 }, { kind: "patient_takes_video", atMs: 7 }];
      for (const i of inputs) expect(stepLadder(phone, i, policy)).toEqual({ state: phone, action: null });
    });
  });

  describe("the consultation clock", () => {
    const start = 1_000_000;
    it("counts down the session length with no drops", () => {
      expect(remainingSessionMs(start, 30, INITIAL_LADDER, start + 10 * 60_000, policy)).toBe(20 * 60_000);
    });
    it("never goes below zero", () => {
      expect(remainingSessionMs(start, 30, INITIAL_LADDER, start + 99 * 60_000, policy)).toBe(0);
    });
    it("is paused while the connection is down, up to the grace window", () => {
      const down = stepLadder(INITIAL_LADDER, { kind: "lost", atMs: start + 5 * 60_000 }, policy).state;
      const at = (ms: number) => remainingSessionMs(start, 30, down, start + 5 * 60_000 + ms, policy);
      expect(at(0)).toBe(25 * 60_000);
      expect(at(60_000)).toBe(25 * 60_000);
      expect(at(GRACE_MS + 60_000)).toBe(25 * 60_000 - 60_000);
    });
    it("adds back time already paused by earlier drops", () => {
      const s: LadderState = { ...INITIAL_LADDER, pausedMs: 45_000 };
      expect(remainingSessionMs(start, 30, s, start + 30 * 60_000, policy)).toBe(45_000);
    });
    it("a now before the loss counts no pause", () => {
      const down = stepLadder(INITIAL_LADDER, { kind: "lost", atMs: start + 5_000 }, policy).state;
      expect(remainingSessionMs(start, 30, down, start, policy)).toBe(30 * 60_000);
    });
  });
});

// S64 (15.2): the whole ladder in order, as one call goes through it. The pieces above are proved one at a time; this proves they
// compose: video, then audio only on a sustained poor link, then a drop that outlasts the grace window, ending on the phone, with the
// session clock never going negative and nothing moving the call off the phone afterwards. NOT run on a real phone (OQ-158).
describe("the whole ladder in order (S64)", () => {
  it("video, audio only, a drop past the grace window, then the phone, and the phone is final", () => {
    const r = run([
      good(0), poor(1), poor(2), poor(3), // sustained poor link: down to audio only, once
      { kind: "lost", atMs: 10_000 }, // the connection drops
      { kind: "tick", atMs: 10_000 + GRACE_MS }, // and does not come back inside the grace window
      good(200_000), good(201_000), good(202_000), good(203_000), good(204_000), good(205_000), // a good link afterwards changes nothing
    ]);
    expect(r.actions.filter((a) => a !== null)).toEqual(["to_audio_only", "grace_started", "to_phone"]);
    expect(r.state.mode).toBe("phone");
    expect(remainingSessionMs(0, 30, r.state, 10_000 + GRACE_MS, policy)).toBeGreaterThanOrEqual(0);
  });

  it("the patient can ask for the phone from every mode, and it is always the end of the ladder", () => {
    for (const start of [INITIAL_LADDER, downgraded()]) {
      const s = stepLadder(start, { kind: "patient_requests_phone", atMs: 1_000 }, policy);
      expect(s.state.mode).toBe("phone");
      expect(run([poor(2_000), good(3_000), { kind: "lost", atMs: 4_000 }, { kind: "tick", atMs: 4_000 + GRACE_MS }], s.state).state.mode).toBe("phone");
    }
  });

  it("a drop that recovers inside the grace window never reaches the phone", () => {
    const r = run([poor(1), poor(2), poor(3), { kind: "lost", atMs: 5_000 }, { kind: "restored", atMs: 5_000 + GRACE_MS - 1_000 }, { kind: "tick", atMs: 5_000 + GRACE_MS + 1 }]);
    expect(r.state.mode).toBe("audio_only");
  });
});
