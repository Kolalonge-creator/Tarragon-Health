import {
  INITIAL_LADDER,
  isSampleDue,
  qualityFromAudioStats,
  qualityFromNetworkLevel,
  stepLadder,
  worstQuality,
  type AudioStatsPolicy,
  type ConnectionQuality,
  type LadderPolicy,
  type LadderState,
  type QualitySample,
} from "../../../../supabase/functions/_shared/integrations/index.ts";

/**
 * Evidence tool (S11-S15 R7a): when does a call drop to audio only? Drives the REAL consultation ladder (`stepLadder`, which uses the
 * S14 `stepAudioFallback`) with a synthetic network, second by second, and reports the moment each action happens. The aim is to set
 * the PROPOSED `video.audio_fallback` values from data: run it with the values on the table and with candidates, and read how long a
 * patient on each kind of network waits, how often the call flaps, and how fast video is offered back.
 *
 * What it is NOT: a measurement. The default profiles are illustrative shapes of common mobile conditions, not readings taken on a
 * real network (R7 item 1 still needs real handsets on throttled 3G, power-saving and loss; feed those numbers in as profiles). The
 * mapping from a profile to the SDK's 0-5 network level and to a video bitrate is an ASSUMPTION written out below so it can be
 * argued with, and it is the first thing to replace once the real SDK's readings from a handset are in hand.
 */
export interface NetworkPhase {
  readonly seconds: number;
  /** Average audio packet loss, percent. */
  readonly lossPercent: number;
  /** Audio round trip time, ms. */
  readonly rttMs: number;
  /** What the link can carry for the video, kbps (before loss). */
  readonly bandwidthKbps: number;
  /** The connection is down for this phase (power-saving, a tunnel): the ladder sees `lost`, then `restored`. */
  readonly disconnected?: boolean;
}
export interface NetworkProfile {
  readonly name: string;
  readonly note: string;
  /** Played in order; the last phase continues to the end of the run. */
  readonly phases: readonly NetworkPhase[];
}

export interface FallbackPolicy extends LadderPolicy, AudioStatsPolicy {
  /** Statistics arrive about every second; they are thinned to one sample per this many seconds. */
  readonly sampleIntervalSeconds: number;
}

export interface SimulationResult {
  readonly toAudioOnlyAtSeconds: number | null;
  readonly videoOfferedAtSeconds: number | null;
  readonly toPhoneAtSeconds: number | null;
  /** Times the mode changed (video to audio only counts one; a flapping network would count many). */
  readonly modeChanges: number;
  readonly finalMode: LadderState["mode"];
}

/** ASSUMPTION: the SDK's 0 (worst) to 5 level from loss and bandwidth. Replace with the real SDK's reading on a handset. */
export function assumedNetworkLevel(p: NetworkPhase): number {
  if (p.lossPercent >= 15 || p.bandwidthKbps < 100) return 0;
  if (p.lossPercent >= 8 || p.bandwidthKbps < 250) return 1;
  if (p.lossPercent >= 3 || p.bandwidthKbps < 500) return 2;
  if (p.bandwidthKbps < 1000) return 3;
  return p.bandwidthKbps < 2000 ? 4 : 5;
}
/** ASSUMPTION: the video bitrate that gets through is about 75% of the bandwidth less the loss. */
export function assumedVideoBitrateKbps(p: NetworkPhase): number {
  return Math.round(p.bandwidthKbps * 0.75 * (1 - Math.min(Math.max(p.lossPercent, 0), 100) / 100));
}

function phaseAt(profile: NetworkProfile, second: number): NetworkPhase {
  let elapsed = 0;
  for (const ph of profile.phases) {
    elapsed += ph.seconds;
    if (second < elapsed) return ph;
  }
  return profile.phases[profile.phases.length - 1] as NetworkPhase;
}

export function simulate(profile: NetworkProfile, policy: FallbackPolicy, horizonSeconds = 600): SimulationResult {
  let state: LadderState = INITIAL_LADDER;
  let lastSampleAt: number | null = null;
  let wasDown = false;
  let toAudio: number | null = null;
  let offered: number | null = null;
  let toPhone: number | null = null;
  let changes = 0;

  const apply = (input: Parameters<typeof stepLadder>[1], second: number): void => {
    const before = state.mode;
    const step = stepLadder(state, input, policy);
    state = step.state;
    if (state.mode !== before) changes += 1;
    if (step.action === "to_audio_only" && toAudio === null) toAudio = second;
    if (step.action === "offer_video" && offered === null) offered = second;
    if (step.action === "to_phone" && toPhone === null) toPhone = second;
  };

  for (let second = 0; second <= horizonSeconds; second++) {
    const atMs = second * 1000;
    const ph = phaseAt(profile, second);
    if (ph.disconnected === true) {
      if (!wasDown) apply({ kind: "lost", atMs }, second);
      wasDown = true;
      apply({ kind: "tick", atMs }, second);
      continue;
    }
    if (wasDown) {
      apply({ kind: "restored", atMs }, second);
      wasDown = false;
      lastSampleAt = null;
    }
    if (!isSampleDue(lastSampleAt, atMs, policy.sampleIntervalSeconds)) continue;
    lastSampleAt = atMs;
    const audio = qualityFromAudioStats({ avg_loss: ph.lossPercent, rtt: ph.rttMs }, policy);
    let quality: ConnectionQuality = audio ?? "good";
    let sample: QualitySample;
    if (state.mode === "video") {
      // The camera is on, so the SDK also reports its network level and the video bitrate; the worse reading wins.
      const level = qualityFromNetworkLevel(assumedNetworkLevel(ph));
      quality = level ? worstQuality(quality, level) : quality;
      sample = { quality, bitrateKbps: assumedVideoBitrateKbps(ph) };
    } else {
      // Camera off: only the audio statistics keep arriving, which is how a recovery is seen at all.
      sample = { quality };
    }
    apply({ kind: "sample", sample, atMs }, second);
  }
  return { toAudioOnlyAtSeconds: toAudio, videoOfferedAtSeconds: offered, toPhoneAtSeconds: toPhone, modeChanges: changes, finalMode: state.mode };
}

const steady = (name: string, note: string, lossPercent: number, rttMs: number, bandwidthKbps: number): NetworkProfile => ({ name, note, phases: [{ seconds: 600, lossPercent, rttMs, bandwidthKbps }] });

/** Illustrative shapes, NOT measurements. Replace or extend with numbers read off real handsets (R7 item 1). */
export const ILLUSTRATIVE_PROFILES: readonly NetworkProfile[] = [
  steady("4G good", "clear signal", 0.5, 60, 3000),
  steady("4G typical urban", "busy cell, moving", 2, 120, 1200),
  steady("4G congested", "evening peak", 6, 300, 400),
  steady("3G good", "full bars on 3G", 2, 250, 700),
  steady("3G poor", "weak 3G, indoors", 8, 500, 200),
  steady("Throttled 150 kbps", "data saver or capped plan", 3, 400, 150),
  steady("High latency, clean", "long path, no loss", 0.5, 900, 2000),
  {
    name: "Burst loss",
    note: "20 s fine, 8 s of 25% loss, repeating",
    phases: Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? { seconds: 20, lossPercent: 1, rttMs: 100, bandwidthKbps: 1500 } : { seconds: 8, lossPercent: 25, rttMs: 400, bandwidthKbps: 300 })),
  },
  {
    name: "Poor then recovers",
    note: "60 s poor, then clean",
    phases: [{ seconds: 60, lossPercent: 12, rttMs: 600, bandwidthKbps: 150 }, { seconds: 600, lossPercent: 0.5, rttMs: 80, bandwidthKbps: 2500 }],
  },
  {
    name: "Drops for 20 s",
    note: "power-saving or a tunnel: the connection is gone, then back",
    phases: [{ seconds: 30, lossPercent: 1, rttMs: 100, bandwidthKbps: 1500 }, { seconds: 20, lossPercent: 100, rttMs: 0, bandwidthKbps: 0, disconnected: true }, { seconds: 600, lossPercent: 1, rttMs: 100, bandwidthKbps: 1500 }],
  },
  {
    name: "Gone for good",
    note: "the connection never returns",
    phases: [{ seconds: 30, lossPercent: 1, rttMs: 100, bandwidthKbps: 1500 }, { seconds: 600, lossPercent: 100, rttMs: 0, bandwidthKbps: 0, disconnected: true }],
  },
];

export interface PolicyCandidate {
  readonly label: string;
  readonly policy: FallbackPolicy;
}

/** Rows are profiles, columns are policies: "-" when the action never happened in the run. */
export function renderTable(profiles: readonly NetworkProfile[], candidates: readonly PolicyCandidate[], horizonSeconds = 600): string {
  const cell = (s: SimulationResult): string => {
    const parts: string[] = [];
    parts.push(s.toAudioOnlyAtSeconds === null ? "stays video" : `audio only at ${s.toAudioOnlyAtSeconds}s`);
    if (s.videoOfferedAtSeconds !== null) parts.push(`video offered at ${s.videoOfferedAtSeconds}s`);
    if (s.toPhoneAtSeconds !== null) parts.push(`phone at ${s.toPhoneAtSeconds}s`);
    if (s.modeChanges > 1) parts.push(`${s.modeChanges} mode changes`);
    return parts.join(", ");
  };
  const lines = [`| Network (illustrative, not measured) | ${candidates.map((c) => c.label).join(" | ")} |`, `|---|${candidates.map(() => "---").join("|")}|`];
  for (const p of profiles) lines.push(`| ${p.name}: ${p.note} | ${candidates.map((c) => cell(simulate(p, c.policy, horizonSeconds))).join(" | ")} |`);
  return lines.join("\n");
}
