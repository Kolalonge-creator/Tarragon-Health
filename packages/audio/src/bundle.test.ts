import { describe, expect, it } from "@jest/globals";
import { getProposedConfig } from "@tarragon/shared";
import { applyRecording, bundleReport, fileUrl, filesInGroup, haveKey, planDownloads, projectedBundleBytes, type ProjectionParams } from "./bundle";
import { audioLang, scriptText } from "./language";
import { realManifest, SHA, withFinished } from "./test-helpers";
import type { Lang, Manifest } from "./types";

const off = { symptomChecker: false };
const on = { symptomChecker: true };

describe("what ships in the app", () => {
  const m = realManifest();

  it("bundles ONB, EMG, TRI and NUM, and SYM only when the symptom checker is on", () => {
    const groups = (f: { symptomChecker: boolean }) => new Set(filesInGroup(m, "bundled", f).map((r) => r.group));
    expect([...groups(off)].sort()).toEqual(["EMG", "NUM", "ONB", "TRI"]);
    expect([...groups(on)].sort()).toEqual(["EMG", "NUM", "ONB", "SYM", "TRI"]);
  });

  it("counts both languages for most clips and one file for each shared number clip", () => {
    const r = bundleReport(m, off);
    // ONB 18, EMG 13, TRI 8 in two languages; NUM-P and D clips (23) in two; 640 shared number clips.
    expect(r.files).toBe((18 + 13 + 8 + 23) * 2 + 640);
    expect(r.clips).toBe(18 + 13 + 8 + 23 + 640);
    expect(bundleReport(m, on).files).toBe(r.files + 11 * 2);
  });

  it("reports everything as not yet recorded today, with zero bytes", () => {
    const r = bundleReport(m, off);
    expect(r).toMatchObject({ recorded: 0, bytes: 0, pendingRecording: r.files });
    expect(r.byGroup.EMG).toEqual({ files: 26, recorded: 0, bytes: 0 });
  });

  it("adds up the bytes of what has been recorded, per group", () => {
    const r = bundleReport(withFinished(["EMG-001", "NUM-148"]), off);
    expect(r.recorded).toBe(3);
    expect(r.bytes).toBe(3 * 12_345);
    expect(r.byGroup.EMG).toMatchObject({ recorded: 2, bytes: 24_690 });
    expect(r.pendingRecording).toBe(r.files - 3);
  });
});

describe("downloads after sign-up", () => {
  const m = withFinished(["NAV-001", "NAV-002", "HLP-001", "RES-001"]);
  const ctx = { lang: "en" as Lang, signedUp: true, onWifi: true, lowData: false, have: new Set<string>() };
  const names = (c: typeof ctx) => planDownloads(m, c, off).map((r) => r.file.file).sort();

  it("fetches recorded post-sign-up files in the person's language, on Wi-Fi", () => {
    expect(names(ctx)).toEqual(["TH-HLP-001-EN.mp3", "TH-NAV-001-EN.mp3", "TH-NAV-002-EN.mp3"]);
    expect(names({ ...ctx, lang: "pcm" })).toEqual(["TH-HLP-001-PCM.mp3", "TH-NAV-001-PCM.mp3", "TH-NAV-002-PCM.mp3"]);
  });

  it("never fetches on mobile data, in low-data mode, or before sign-up (spec D.1)", () => {
    expect(names({ ...ctx, onWifi: false })).toEqual([]);
    expect(names({ ...ctx, lowData: true })).toEqual([]);
    expect(names({ ...ctx, signedUp: false })).toEqual([]);
  });

  it("skips what is already on the phone, and never fetches on-demand results ahead of time", () => {
    const have = new Set([haveKey(m.clips.find((c) => c.id === "NAV-001")!.files.en!)]);
    expect(names({ ...ctx, have })).toEqual(["TH-HLP-001-EN.mp3", "TH-NAV-002-EN.mp3"]);
    expect(names(ctx).some((n) => n.includes("RES"))).toBe(false);
  });

  it("does not ask for a file that has no recording yet", () => {
    expect(planDownloads(realManifest(), ctx, off)).toEqual([]);
  });
});

describe("file locations and recordings", () => {
  it("puts the checksum in the path so a re-recorded clip never serves a stale file", () => {
    const f = withFinished(["NAV-001"]).clips.find((c) => c.id === "NAV-001")!.files.en!;
    expect(fileUrl("https://x.test/audio/", f)).toBe(`https://x.test/audio/${SHA.slice(0, 16)}/TH-NAV-001-EN.mp3`);
    expect(fileUrl("https://x.test/audio///", f)).toBe(`https://x.test/audio/${SHA.slice(0, 16)}/TH-NAV-001-EN.mp3`);
    expect(fileUrl("/".repeat(50000), f)).toBe(`/${SHA.slice(0, 16)}/TH-NAV-001-EN.mp3`);
    expect(fileUrl("https://x.test", realManifest().clips[0].files.en!)).toBeNull();
  });

  it("records a master's checksum and size against its file name", () => {
    const next = applyRecording(realManifest(), "TH-EMG-001-EN.mp3", { sha256: SHA, bytes: 9000, durationMs: 21_000 }) as Manifest;
    expect(next.clips.find((c) => c.id === "EMG-001")!.files.en).toMatchObject({ sha256: SHA, bytes: 9000, duration_ms: 21_000, approvals: [] });
    expect(next.clips.find((c) => c.id === "EMG-001")!.files.pcm!.sha256).toBeNull();
    expect(applyRecording(realManifest(), "TH-NOPE-001-EN.mp3", { sha256: SHA, bytes: 1, durationMs: null })).toBeNull();
  });

  it("drops sign-offs when a clip is re-recorded, but keeps them for the identical file", () => {
    const signed = withFinished(["EMG-001"]);
    const same = applyRecording(signed, "TH-EMG-001-EN.mp3", { sha256: SHA, bytes: 99, durationMs: null }) as Manifest;
    expect(same.clips.find((c) => c.id === "EMG-001")!.files.en!.approvals.length).toBeGreaterThan(0);
    expect(same.clips.find((c) => c.id === "EMG-001")!.files.en!.duration_ms).toBe(4_000);
    const other = applyRecording(signed, "TH-EMG-001-EN.mp3", { sha256: "b".repeat(64), bytes: 99, durationMs: 5 }) as Manifest;
    expect(other.clips.find((c) => c.id === "EMG-001")!.files.en!.approvals).toEqual([]);
  });
});

describe("language", () => {
  it("follows the app language, and is English while the Pidgin switch is off", () => {
    expect(audioLang("pcm", true)).toBe("pcm");
    expect(audioLang("pcm", false)).toBe("en");
    expect(audioLang(undefined, true)).toBe("en");
  });

  it("returns a clip's words, and nothing for an id with no script", () => {
    expect(scriptText("TRI-005", "en")).toMatch(/five minutes/);
    expect(scriptText("NUM-148", "en")).toBe("");
  });
});

describe("app size budget for the bundled audio", () => {
  const cfg = (key: string): number => getProposedConfig<number>(key).value;
  const params: ProjectionParams = {
    bitrateKbps: cfg("audio.mono_bitrate_kbps"),
    charsPerMinute: cfg("audio.speech_chars_per_minute"),
    numberClipSeconds: cfg("audio.number_clip_seconds"),
  };
  const budget = cfg("audio.bundled_max_bytes");

  it("projects the bundled groups inside the budget, with and without the symptom checker", () => {
    const without = projectedBundleBytes(realManifest(), off, scriptText, params);
    const withSym = projectedBundleBytes(realManifest(), on, scriptText, params);
    expect(without).toBeGreaterThan(5_000_000); // a sanity floor: this is a lot of speech, not a rounding error
    expect(withSym).toBeGreaterThan(without);
    expect(withSym).toBeLessThanOrEqual(budget);
  });

  it("uses real bytes for what is recorded and the estimate for the rest", () => {
    const base = projectedBundleBytes(realManifest(), off, scriptText, params);
    const one = projectedBundleBytes(withFinished(["NUM-148"]), off, scriptText, params);
    const estimate = Math.ceil((params.numberClipSeconds * params.bitrateKbps * 1000) / 8);
    expect(one).toBe(base - estimate + 12_345);
  });

  it("fails when the bundled audio outgrows the budget", () => {
    expect(projectedBundleBytes(realManifest(), on, scriptText, { ...params, bitrateKbps: params.bitrateKbps * 3 })).toBeGreaterThan(budget);
  });
});
