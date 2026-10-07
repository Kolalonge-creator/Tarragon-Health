import { parseManifest, type ClipFile, type Manifest } from "@tarragon/audio";
import manifestJson from "../../../../../audio/manifest.json";
import { createExpoAudioEngine, loadExpoAudioEngine, STALL_GRACE_MS, type ExpoAudioModule, type ExpoPlayer } from "./expo-engine";
import { createDownloadedFiles, downloadPostSignupClips, type FileSystemPort } from "./file-store";
import { AudioStopped, type AudioSource } from "./service";
import { registerAudio } from "./register";
import { getAudioService, setAudioEngine } from "./service";

class FakePlayer implements ExpoPlayer {
  listener: ((s: { didJustFinish: boolean }) => void) | null = null;
  removed = false;
  played = false;
  constructor(readonly source: unknown, readonly throwOnPlay = false) {}
  play() {
    if (this.throwOnPlay) throw new Error("no output");
    this.played = true;
  }
  remove() {
    this.removed = true;
  }
  addListener(_e: "playbackStatusUpdate", l: (s: { didJustFinish: boolean }) => void) {
    this.listener = l;
    return { remove: () => (this.listener = null) };
  }
  finish() {
    this.listener?.({ didJustFinish: true });
  }
}

function fakeModule(opts: { throwOnPlay?: boolean } = {}) {
  const players: FakePlayer[] = [];
  const modes: Parameters<ExpoAudioModule["setAudioModeAsync"]>[0][] = [];
  const mod: ExpoAudioModule = {
    createAudioPlayer: (source) => {
      const p = new FakePlayer(source, opts.throwOnPlay);
      players.push(p);
      return p;
    },
    setAudioModeAsync: async (m) => {
      modes.push(m);
    },
  };
  return { mod, players, modes };
}

const flush = () => new Promise((r) => setImmediate(r));
const bundled = (module: number, durationMs?: number): AudioSource => ({ kind: "bundled", module, durationMs });

describe("the expo-audio engine", () => {
  afterEach(() => jest.useRealTimers());

  it("plays clips one after another, and an emergency plays in silent mode", async () => {
    const { mod, players, modes } = fakeModule();
    const engine = createExpoAudioEngine(mod);
    const done = engine.play([bundled(1), { kind: "file", uri: "file:///a.mp3" }], { emergency: true });
    await flush();
    expect(players).toHaveLength(1);
    expect(players[0].source).toBe(1);
    players[0].finish();
    await flush();
    expect(players).toHaveLength(2);
    expect(players[1].source).toEqual({ uri: "file:///a.mp3" });
    players[1].finish();
    await done;
    expect(players.every((p) => p.played && p.removed)).toBe(true);
    expect(modes[0]).toMatchObject({ playsInSilentMode: true, interruptionMode: "doNotMix", shouldPlayInBackground: false, allowsRecording: false });
  });

  it("respects silent mode for everything that is not an emergency", async () => {
    const { mod, players, modes } = fakeModule();
    const done = createExpoAudioEngine(mod).play([bundled(1)], { emergency: false });
    await flush();
    players[0].finish();
    await done;
    expect(modes[0]).toMatchObject({ playsInSilentMode: false, interruptionMode: "duckOthers" });
  });

  it("gives audio focus back and stops forcing the ringer switch once the clips are done", async () => {
    const { mod, players, modes } = fakeModule();
    const done = createExpoAudioEngine(mod).play([bundled(1)], { emergency: true });
    await flush();
    players[0].finish();
    await done;
    expect(modes[modes.length - 1]).toMatchObject({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
  });

  it("stop() ends the current clip with AudioStopped and plays nothing further", async () => {
    const { mod, players } = fakeModule();
    const engine = createExpoAudioEngine(mod);
    const done = engine.play([bundled(1), bundled(2)], { emergency: false });
    await flush();
    engine.stop();
    await expect(done).rejects.toBeInstanceOf(AudioStopped);
    expect(players).toHaveLength(1);
    expect(players[0].removed).toBe(true);
  });

  it("stop() between two clips also ends the sequence", async () => {
    const { mod, players } = fakeModule();
    const engine = createExpoAudioEngine(mod);
    const done = engine.play([bundled(1), bundled(2)], { emergency: false });
    await flush();
    const first = players[0];
    // finish the first clip and stop in the same tick, before the next one starts
    first.finish();
    engine.stop();
    await expect(done).rejects.toBeInstanceOf(AudioStopped);
    expect(players).toHaveLength(1);
  });

  it("stop() with nothing playing is harmless", () => {
    expect(() => createExpoAudioEngine(fakeModule().mod).stop()).not.toThrow();
  });

  it("treats a clip that never finishes (a call took the audio) as stalled, so the text is shown", async () => {
    jest.useFakeTimers();
    const { mod, players } = fakeModule();
    const done = createExpoAudioEngine(mod).play([bundled(1, 3000)], { emergency: true });
    const assertion = expect(done).rejects.toThrow("playback stalled");
    await jest.advanceTimersByTimeAsync(3000 + STALL_GRACE_MS + 1);
    await assertion;
    expect(players[0].removed).toBe(true);
  });

  it("rejects when the player cannot start", async () => {
    const { mod } = fakeModule({ throwOnPlay: true });
    await expect(createExpoAudioEngine(mod).play([bundled(1)], { emergency: false })).rejects.toThrow("no output");
  });

  it("loads the native module lazily and stays null when it is missing", () => {
    jest.doMock("expo-audio", () => {
      throw new Error("native module not found");
    });
    jest.isolateModules(() => {
      expect(loadExpoAudioEngine()).toBeNull();
    });
    jest.dontMock("expo-audio");
  });
});

describe("downloaded clips", () => {
  const manifest = parseManifest(manifestJson);
  const SHA = "a".repeat(64);
  const recorded = (m: Manifest, ids: string[]): Manifest => ({
    ...m,
    clips: m.clips.map((c) =>
      ids.includes(c.id)
        ? { ...c, files: Object.fromEntries(Object.entries(c.files).map(([k, f]) => [k, { ...(f as ClipFile), sha256: SHA, bytes: 10 }])) }
        : c,
    ),
  });
  const features = { symptomChecker: false };
  const ctx = { lang: "en" as const, signedUp: true, onWifi: true, lowData: false };

  function fakeFs(over: Partial<{ hash: string; failDownload: boolean }> = {}) {
    const onPhone = new Set<string>();
    const parts = new Set<string>();
    const fs: FileSystemPort = {
      locate: (f) => ({ uri: `file:///audio/${f.file}`, exists: onPhone.has(f.file) }),
      download: async (_u, f) => {
        if (over.failDownload) throw new Error("offline");
        parts.add(f.file); // a download only ever lands in the temporary file
      },
      sha256: async () => over.hash ?? SHA,
      commit: (f) => {
        parts.delete(f.file);
        onPhone.add(f.file);
      },
      remove: (f) => {
        parts.delete(f.file);
        onPhone.delete(f.file);
      },
    };
    return { fs, onPhone, parts };
  }

  it("serves a clip from the phone only when it is there", () => {
    const { fs, onPhone } = fakeFs();
    const store = createDownloadedFiles(fs);
    const file = recorded(manifest, ["NAV-001"]).clips.find((c) => c.id === "NAV-001")!.files.en!;
    expect(store.uriFor(file)).toBeNull();
    onPhone.add(file.file);
    expect(store.uriFor(file)).toBe("file:///audio/TH-NAV-001-EN.mp3");
    expect(store.uriFor(manifest.clips.find((c) => c.id === "NAV-001")!.files.en!)).toBeNull(); // no recording
  });

  it("downloads what is missing, once, in the person's language", async () => {
    const m = recorded(manifest, ["NAV-001", "HLP-001"]);
    const { fs, onPhone } = fakeFs();
    const issues: string[] = [];
    const first = await downloadPostSignupClips(m, ctx, features, "https://cdn.test/audio", fs, (i) => issues.push(i.code));
    expect(first).toEqual({ downloaded: 2, failed: 0 });
    expect([...onPhone].sort()).toEqual(["TH-HLP-001-EN.mp3", "TH-NAV-001-EN.mp3"]);
    expect(await downloadPostSignupClips(m, ctx, features, "https://cdn.test/audio", fs, () => undefined)).toEqual({ downloaded: 0, failed: 0 });
    expect(issues).toEqual([]);
  });

  it("does nothing without a host, off Wi-Fi, or in low-data mode", async () => {
    const m = recorded(manifest, ["NAV-001"]);
    const { fs } = fakeFs();
    expect(await downloadPostSignupClips(m, ctx, features, undefined, fs, () => undefined)).toEqual({ downloaded: 0, failed: 0 });
    expect(await downloadPostSignupClips(m, { ...ctx, onWifi: false }, features, "https://x", fs, () => undefined)).toEqual({ downloaded: 0, failed: 0 });
    expect(await downloadPostSignupClips(m, { ...ctx, lowData: true }, features, "https://x", fs, () => undefined)).toEqual({ downloaded: 0, failed: 0 });
  });

  it("a download that never finishes leaves nothing the app would play (it is only a temporary file)", async () => {
    const m = recorded(manifest, ["NAV-001"]);
    const { fs, onPhone, parts } = fakeFs();
    fs.sha256 = () => Promise.reject(new Error("app killed"));
    const r = await downloadPostSignupClips(m, ctx, features, "https://x", fs, () => undefined);
    expect(r.failed).toBe(1);
    expect(onPhone.size).toBe(0);
    expect(parts.size).toBe(0);
    expect(createDownloadedFiles(fs).uriFor(m.clips.find((c) => c.id === "NAV-001")!.files.en!)).toBeNull();
  });

  it("deletes a download whose checksum is not the signed recording, and reports it", async () => {
    const m = recorded(manifest, ["NAV-001"]);
    const { fs, onPhone, parts } = fakeFs({ hash: "b".repeat(64) });
    const issues: string[] = [];
    const r = await downloadPostSignupClips(m, ctx, features, "https://x", fs, (i) => issues.push(i.code));
    expect(r).toEqual({ downloaded: 0, failed: 1 });
    expect(onPhone.size).toBe(0);
    expect(parts.size).toBe(0);
    expect(issues).toEqual(["clip_checksum_mismatch"]);
  });

  it("carries on after a failed download, never throws, and reports it", async () => {
    const m = recorded(manifest, ["NAV-001", "NAV-002"]);
    const { fs } = fakeFs({ failDownload: true });
    const issues: string[] = [];
    const r = await downloadPostSignupClips(m, ctx, features, "https://x", fs, (i) => issues.push(i.code));
    expect(r).toEqual({ downloaded: 0, failed: 2 });
    expect(issues).toEqual(["clip_file_missing", "clip_file_missing"]);
  });
});

describe("registering the phone's audio", () => {
  afterEach(() => setAudioEngine(null));

  it("never throws, and leaves a working (text-only when nothing native loads) service", async () => {
    expect(() => registerAudio()).not.toThrow();
    const r = await getAudioService().playClips(["EMG-001"], "en");
    expect(r.played).toBe(false);
    expect(r.text).toMatch(/need care now/);
  });
});
