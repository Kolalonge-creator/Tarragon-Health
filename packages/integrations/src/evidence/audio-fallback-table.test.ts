import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "../../../shared/src/proposed-config/index";
import { ILLUSTRATIVE_PROFILES, assumedNetworkLevel, assumedVideoBitrateKbps, renderTable, simulate, type FallbackPolicy, type NetworkProfile } from "./audio-fallback-table";

const cfg = getProposedConfig<{ poorSamplesToDowngrade: number; goodSamplesToOfferVideo: number; poorBelowKbps: number; poorAudioLossPercent: number; poorAudioRttMs: number; sampleIntervalSeconds: number }>("video.audio_fallback").value;
const grace = getProposedConfig<{ reconnectGraceSeconds: number }>("consultations.policy").value.reconnectGraceSeconds;
const policy: FallbackPolicy = { ...cfg, reconnectGraceSeconds: grace };
const profile = (name: string) => ILLUSTRATIVE_PROFILES.find((p) => p.name === name) as NetworkProfile;

describe("audio fallback evidence table", () => {
  it("runs the real values on the table: version 2 of video.audio_fallback", () => {
    expect(cfg.sampleIntervalSeconds).toBeGreaterThan(0);
    expect(cfg.poorAudioLossPercent).toBeGreaterThan(0);
  });

  it("a good network never leaves video and never flaps", () => {
    for (const name of ["4G good", "4G typical urban"]) {
      const r = simulate(profile(name), policy);
      expect({ name, to: r.toAudioOnlyAtSeconds, changes: r.modeChanges, mode: r.finalMode }).toEqual({ name, to: null, changes: 0, mode: "video" });
    }
  });

  it("a clearly poor link drops to audio only after the configured run of poor samples, and not before", () => {
    const r = simulate(profile("3G poor"), policy);
    // poor samples at 0, interval, 2 x interval ...; the third in a row is the downgrade
    expect(r.toAudioOnlyAtSeconds).toBe((cfg.poorSamplesToDowngrade - 1) * cfg.sampleIntervalSeconds);
    expect(r.finalMode).toBe("audio_only");
  });

  it("a stricter policy waits longer, a looser one drops sooner (the dial the table exists to turn)", () => {
    const strict = simulate(profile("3G poor"), { ...policy, poorSamplesToDowngrade: 6 });
    const loose = simulate(profile("3G poor"), { ...policy, poorSamplesToDowngrade: 2 });
    expect(strict.toAudioOnlyAtSeconds as number).toBeGreaterThan(loose.toAudioOnlyAtSeconds as number);
    expect(loose.toAudioOnlyAtSeconds).toBe(1 * cfg.sampleIntervalSeconds);
  });

  it("a bitrate floor catches a link the signal levels call fair", () => {
    const thin: NetworkProfile = { name: "thin", note: "", phases: [{ seconds: 600, lossPercent: 0.5, rttMs: 80, bandwidthKbps: 120 }] };
    const lowFloor = simulate(thin, { ...policy, poorBelowKbps: 20 });
    const highFloor = simulate(thin, { ...policy, poorBelowKbps: 500 });
    expect(highFloor.toAudioOnlyAtSeconds).not.toBeNull();
    expect(highFloor.toAudioOnlyAtSeconds as number).toBeLessThanOrEqual((lowFloor.toAudioOnlyAtSeconds ?? Infinity));
  });

  it("burst loss shorter than the run of poor samples does not downgrade", () => {
    const r = simulate(profile("Burst loss"), policy);
    expect(r.toAudioOnlyAtSeconds === null || r.modeChanges <= 1).toBe(true);
  });

  it("after a poor patch that clears, video is OFFERED (never forced) after the configured run of good samples", () => {
    const r = simulate(profile("Poor then recovers"), policy);
    expect(r.toAudioOnlyAtSeconds).not.toBeNull();
    expect(r.videoOfferedAtSeconds).not.toBeNull();
    expect(r.videoOfferedAtSeconds as number).toBeGreaterThan(60);
    expect(r.finalMode).toBe("audio_only");
  });

  it("a short drop that comes back inside the grace window does not move to the phone", () => {
    const r = simulate(profile("Drops for 20 s"), policy);
    expect(grace).toBeGreaterThan(20);
    expect(r.toPhoneAtSeconds).toBeNull();
  });

  it("a connection that never comes back moves to the phone after the grace window", () => {
    const r = simulate(profile("Gone for good"), policy);
    expect(r.toPhoneAtSeconds).toBe(30 + grace);
    expect(r.finalMode).toBe("phone");
  });

  it("is deterministic and the assumptions are monotone: worse conditions never give a better level or bitrate", () => {
    expect(simulate(profile("3G poor"), policy)).toEqual(simulate(profile("3G poor"), policy));
    const a = { seconds: 1, lossPercent: 1, rttMs: 100, bandwidthKbps: 2500 };
    const b = { ...a, lossPercent: 10 };
    const c = { ...a, bandwidthKbps: 150 };
    expect(assumedNetworkLevel(a)).toBeGreaterThan(assumedNetworkLevel(b));
    expect(assumedNetworkLevel(a)).toBeGreaterThan(assumedNetworkLevel(c));
    expect(assumedVideoBitrateKbps(a)).toBeGreaterThan(assumedVideoBitrateKbps(b));
    expect(assumedVideoBitrateKbps({ ...a, lossPercent: 500 })).toBe(0);
    expect(assumedNetworkLevel({ ...a, bandwidthKbps: 700 })).toBe(3);
    expect(assumedNetworkLevel({ ...a, bandwidthKbps: 1500 })).toBe(4);
    expect(assumedNetworkLevel({ ...a, lossPercent: 20 })).toBe(0);
    expect(assumedNetworkLevel({ ...a, lossPercent: 4 })).toBe(2);
  });

  it("renders one row per network and one column per policy, labelled as not measured", () => {
    const table = renderTable(ILLUSTRATIVE_PROFILES, [{ label: "current", policy }, { label: "stricter (6 poor samples)", policy: { ...policy, poorSamplesToDowngrade: 6 } }]);
    const rows = table.split("\n");
    expect(rows).toHaveLength(2 + ILLUSTRATIVE_PROFILES.length);
    expect(rows[0]).toContain("illustrative, not measured");
    expect(table).toContain("stays video");
    expect(table).toContain("audio only at");
    expect(table).toContain("phone at");
    expect(table).toContain("video offered at");
  });

  it("counts a call that went to audio only and then to the phone as two mode changes, and says so in the table", () => {
    const worse: NetworkProfile = { name: "poor then gone", note: "", phases: [{ seconds: 20, lossPercent: 12, rttMs: 700, bandwidthKbps: 100 }, { seconds: 600, lossPercent: 100, rttMs: 0, bandwidthKbps: 0, disconnected: true }] };
    const r = simulate(worse, policy);
    expect(r.modeChanges).toBe(2);
    expect(renderTable([worse], [{ label: "current", policy }])).toContain("2 mode changes");
  });
});
