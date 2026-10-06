import {
  INITIAL_AUDIO_FALLBACK,
  INITIAL_LADDER,
  isSampleDue,
  ladderInputFromConnection,
  qualityFromAudioStats,
  qualityFromNetworkLevel,
  stepLadder,
  worstQuality,
  type AudioStatsPolicy,
  type ConnectionQuality,
  type LadderAction,
  type LadderInput,
  type LadderPolicy,
  type LadderState,
  type MediaMode,
} from "@tarragon/integrations/client";
import type { CallEventReport } from "./room";
import type { ZoomEmbeddedClient } from "./zoom-sdk";

/**
 * Wires the Zoom SDK's connection signals into the fallback ladder (S21 follow-up, OQ-136). The decisions are all `stepLadder`'s
 * (proved in packages/integrations); this class only translates what the SDK reports and carries out what the ladder answers:
 *
 *   to_audio_only  record the mode change and tell the person to switch their camera off (the web SDK has no way for us to do it)
 *   offer_video    ask the patient. Video never comes back by itself, because that spends the patient's data
 *   grace_started  "your place is held": the connection dropped and the clock is paused
 *   reconnected    the link came back inside the window
 *   to_phone       show the dial-in card at once (the person rings in; the server never marks a consultation "on the phone" by itself)
 *
 * Every report goes to the server as the person's own session. A refused report is surfaced, not swallowed.
 */
export type CallNotice = "audio_only" | "offer_video" | "video_back" | "held_place" | "reconnected" | "phone" | "report_failed";

export interface CallPolicy extends LadderPolicy, AudioStatsPolicy {
  /** Statistics arrive about every second; the ladder counts one sample per this many seconds. */
  readonly sampleIntervalSeconds: number;
}

export interface CallControllerOptions {
  readonly client: ZoomEmbeddedClient;
  readonly policy: CallPolicy;
  readonly role: "patient" | "clinician";
  /** Where the consultation already is (a rejoin after a drop to audio only starts in audio only). */
  readonly initialMode: MediaMode;
  readonly now: () => number;
  readonly report: (report: CallEventReport) => Promise<{ ok: boolean }>;
  readonly onNotice: (notice: CallNotice) => void;
  /** The call ended (someone left or the host ended it). Not a lost connection. */
  readonly onClosed: () => void;
  /** The ladder reached the phone: the caller shows the dial-in card. */
  readonly onPhone: () => void;
}

export class CallController {
  private ladder: LadderState;
  private readonly handlers: { event: string; fn: (payload: unknown) => void }[] = [];
  private readonly readings = new Map<string, { quality: ConnectionQuality; atMs: number }>();
  private lastSampleAtMs: number | null = null;
  private tick: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(private readonly o: CallControllerOptions) {
    this.ladder =
      o.initialMode === "audio_only"
        ? { ...INITIAL_LADDER, mode: "audio_only", fallback: { ...INITIAL_AUDIO_FALLBACK, mode: "audio_only" } }
        : { ...INITIAL_LADDER, mode: o.initialMode };
  }

  get mode(): MediaMode {
    return this.ladder.mode;
  }

  /** True while a dropped connection is inside its grace window. */
  get inGrace(): boolean {
    return this.ladder.lostAtMs !== null;
  }

  /** Starts listening. Call once the person is in the meeting. */
  start(): void {
    this.listen("connection-change", (p) => {
      const input = ladderInputFromConnection(typeof p === "object" && p !== null ? (p as { state?: unknown }).state : undefined, this.o.now());
      if (input === "closed") this.closed();
      else if (input) this.apply(input);
    });
    this.listen("network-quality-change", (p) => {
      const d = asRecord(p);
      const self = this.o.client.getCurrentUser();
      // Each person's own link is theirs to judge; other people's quality events carry their ids.
      if (!d || !self || d["userId"] !== self.userId) return;
      const quality = qualityFromNetworkLevel(d["level"]);
      if (quality) this.reading(d["type"] === "downlink" ? "video_down" : "video_up", quality);
    });
    this.listen("audio-statistic-data-change", (p) => {
      const d = asRecord(p);
      const data = d ? asRecord(d["data"]) : null;
      const quality = qualityFromAudioStats(data, this.o.policy);
      if (quality) this.reading(data?.["encoding"] === true ? "audio_up" : "audio_down", quality);
    });
    // Statistics only flow once subscribed. A refusal just means no samples: the connection-change path still works on its own.
    void this.o.client.subscribeStatisticData({ audio: true, video: false, share: false }).catch(() => undefined);
  }

  stop(): void {
    this.stopped = true;
    for (const h of this.handlers) this.o.client.off(h.event, h.fn);
    this.handlers.length = 0;
    this.clearTick();
    void this.o.client.unSubscribeStatisticData({ audio: true, video: false, share: false }).catch(() => undefined);
  }

  /** The patient took the offer of video again. Nobody else can: switching back spends the patient's data. */
  patientTakesVideo(): void {
    if (this.o.role === "patient") this.apply({ kind: "patient_takes_video", atMs: this.o.now() });
  }

  /**
   * The SDK reports the call closed. Normally that is the call ending. But if it closes while a drop is still being held, the link was
   * lost for good and no "back online" is coming, so the person goes to the phone at once instead of being left with nothing.
   */
  private closed(): void {
    if (this.inGrace) this.apply({ kind: "patient_requests_phone", atMs: this.o.now() });
    this.o.onClosed();
  }

  private listen(event: string, fn: (payload: unknown) => void): void {
    this.handlers.push({ event, fn });
    this.o.client.on(event, fn);
  }

  private reading(key: string, quality: ConnectionQuality): void {
    const atMs = this.o.now();
    this.readings.set(key, { quality, atMs });
    if (!isSampleDue(this.lastSampleAtMs, atMs, this.o.policy.sampleIntervalSeconds)) return;
    // The network level is reported when it CHANGES, so a level stays true until replaced. It cannot stay true for ever, because it
    // stops arriving when the camera goes off. A reading therefore counts for as long as it would take to downgrade on its own.
    const freshMs = this.o.policy.sampleIntervalSeconds * this.o.policy.poorSamplesToDowngrade * 1000;
    let worst: ConnectionQuality | null = null;
    for (const r of this.readings.values()) {
      if (atMs - r.atMs < freshMs) worst = worst === null ? r.quality : worstQuality(worst, r.quality);
    }
    if (worst === null) return;
    this.lastSampleAtMs = atMs;
    this.apply({ kind: "sample", sample: { quality: worst }, atMs });
  }

  private apply(input: LadderInput): void {
    if (this.stopped) return;
    const step = stepLadder(this.ladder, input, this.o.policy);
    this.ladder = step.state;
    if (step.action) this.act(step.action);
  }

  private act(action: LadderAction): void {
    switch (action) {
      case "to_audio_only":
        this.send({ kind: "mode_changed", mode: "audio_only" });
        this.o.onNotice("audio_only");
        return;
      case "offer_video":
        // Only the patient is asked; the clinician's side has nothing to take up.
        if (this.o.role === "patient") {
          this.send({ kind: "fallback_offered" });
          this.o.onNotice("offer_video");
        }
        return;
      case "to_video":
        this.send({ kind: "mode_changed", mode: "video" });
        this.o.onNotice("video_back");
        return;
      case "grace_started":
        this.send({ kind: "reconnect_grace_started" });
        this.o.onNotice("held_place");
        this.startTick();
        return;
      case "reconnected":
        this.clearTick();
        this.o.onNotice("reconnected");
        return;
      case "to_phone":
        this.clearTick();
        this.o.onNotice("phone");
        this.o.onPhone();
        return;
    }
  }

  private send(report: CallEventReport): void {
    void this.o.report(report).then(
      (r) => {
        if (!r.ok) this.o.onNotice("report_failed");
      },
      () => this.o.onNotice("report_failed"),
    );
  }

  /** While the connection is down the grace window must be able to run out, so the ladder is told the time once a second. */
  private startTick(): void {
    if (this.tick) return;
    this.tick = setInterval(() => this.apply({ kind: "tick", atMs: this.o.now() }), 1000);
  }

  private clearTick(): void {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}
