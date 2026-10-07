import { parseManifest, stitchBloodPressure, withSeverity, PATTERN_CLIPS, type PhrasePattern, type Approval, type ClipFile, type Manifest, type ManifestClip } from "@tarragon/audio";
import manifestJson from "../../../../../audio/manifest.json";
import { createAudioService, type AudioEngine, type AudioServiceDeps, type AudioSource } from "./service";
import { audioCatalogue, clipIdFor, resetAudioCatalogue } from "./manifest";
import { clearAudioIssues, recentAudioIssues, reportAudioIssue } from "./issues";
import { createCatalogue } from "@tarragon/audio";

const SHA = "c".repeat(64);
const sign = (clip: ManifestClip): Approval[] =>
  [["brand"], clip.clinical ? ["clinical"] : [], clip.legal ? ["legal"] : []]
    .flat()
    .map((review) => ({ review: review as Approval["review"], sha256: SHA, by: "Test Reviewer", on: "2026-10-06" }));

/** The real manifest with the named clips recorded and signed as a finished clip looks. */
function manifestWith(ids: readonly string[]): Manifest {
  const m = parseManifest(manifestJson);
  const set = new Set(ids);
  const signoffs = (Object.keys(PATTERN_CLIPS) as PhrasePattern[]).flatMap((pattern) =>
    (["en"] as const).map((lang) => ({ pattern, lang, by: "Test Clinician", on: "2026-10-06", clips: PATTERN_CLIPS[pattern].clips.map((id) => ({ id, sha256: SHA })) })),
  );
  return {
    ...m,
    phrase_signoffs: signoffs,
    clips: m.clips.map((c) => {
      if (!set.has(c.id)) return c;
      const files: Record<string, ClipFile> = {};
      for (const [k, f] of Object.entries(c.files)) files[k] = { ...(f as ClipFile), sha256: SHA, bytes: 1000, duration_ms: 3000, approvals: sign(c) };
      return { ...c, files };
    }),
  };
}

function setup(over: Partial<AudioServiceDeps> & { ids?: readonly string[] } = {}) {
  const played: AudioSource[][] = [];
  let stops = 0;
  const engine: AudioEngine = {
    play: async (s) => {
      played.push([...s]);
    },
    stop: () => {
      stops += 1;
    },
  };
  const issues: string[] = [];
  const bundled = Object.fromEntries(parseManifest(manifestJson).clips.flatMap((c) => Object.values(c.files).map((f, i) => [f!.file, i + 1])));
  const service = createAudioService({
    catalogue: createCatalogue(manifestWith(over.ids ?? ["EMG-001", "TRI-003", "NUM-P01", "NUM-P02", "NUM-148", "NUM-094"])),
    engine,
    downloaded: { uriFor: () => null },
    bundled,
    report: (i) => issues.push(i.code),
    ...over,
  });
  return { service, played, issues, stops: () => stops };
}

describe("the audio service", () => {
  it("plays a bundled emergency clip from the phone and returns its words", async () => {
    const { service, played, issues, stops } = setup();
    const r = await service.playClips(["EMG-001"], "en");
    expect(r).toMatchObject({ played: true, lang: "en" });
    expect(r.text).toMatch(/need care now/);
    expect(played).toHaveLength(1);
    expect(played[0]).toEqual([{ kind: "bundled", module: expect.any(Number) }]);
    expect(stops()).toBe(1); // stops whatever was playing before starting
    expect(issues).toEqual([]);
  });

  it("says whether a clip would play, without reporting issues or playing anything", async () => {
    const { service, played, issues } = setup();
    expect(await service.canPlayClips(["EMG-001"], "en")).toBe(true);
    expect(await service.canPlayClips(["TRI-001"], "en")).toBe(false); // not recorded or signed in this setup
    expect(played).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("never offers audio when no engine is registered", async () => {
    const { service } = setup({ engine: null });
    expect(await service.canPlayClips(["EMG-001"], "en")).toBe(false);
  });

  it("stitches a blood pressure reading in order: lead-in, 148, over, 94", async () => {
    const { service, played } = setup();
    const r = await service.playPhrase(withSeverity(stitchBloodPressure(148, 94), "TRI-003")!, "en");
    expect(r.played).toBe(true);
    expect(r.text).toMatch(/^Your blood pressure reading is 148 over 94 /);
    expect(played[0]).toHaveLength(5);
  });

  it("shows the text, plays nothing and reports a non-fatal issue when a number clip is missing", async () => {
    const { service, played, issues } = setup({ ids: ["NUM-P01", "NUM-P02", "NUM-148"] });
    const r = await service.playPhrase(withSeverity(stitchBloodPressure(148, 94), "TRI-003")!, "en");
    expect(r.played).toBe(false);
    expect(r.text).toMatch(/^Your blood pressure reading is 148 over 94 /);
    expect(played).toEqual([]);
    expect(issues).toEqual(["clip_not_recorded"]);
  });

  it("with nothing recorded (today) every request is text only, and the app is unharmed", async () => {
    const { service, played } = setup({ ids: [] });
    const r = await service.playClips(["EMG-001"], "en");
    expect(r.played).toBe(false);
    expect(r.text).toMatch(/need care now/);
    expect(played).toEqual([]);
  });

  it("has no engine until the native module ships: text only, and one issue says why", async () => {
    const { service, issues } = setup({ engine: null });
    const r = await service.playClips(["EMG-001"], "en");
    expect(r.played).toBe(false);
    expect(r.text).not.toBe("");
    expect(issues).toEqual(["engine_unavailable"]);
    service.stop(); // safe with no engine
  });

  it("falls back to text, never throws, when the player fails mid-way", async () => {
    const { service, issues } = setup({
      engine: { play: () => Promise.reject(new Error("decoder error")), stop: () => undefined },
    });
    const r = await service.playClips(["EMG-001"], "en");
    expect(r.played).toBe(false);
    expect(issues).toEqual(["clip_file_missing"]);
  });

  it("works with no manifest at all (it failed to parse): text only", async () => {
    const { service, played } = setup({ catalogue: null });
    expect((await service.playClips(["EMG-001"], "en")).played).toBe(false);
    expect((await service.playPhrase(stitchBloodPressure(120, 80)!, "en")).text).toBe("Your blood pressure reading is 120 over 80");
    expect(played).toEqual([]);
  });

  it("plays a downloaded file when there is no bundled copy", async () => {
    const { service, played } = setup({ ids: ["NAV-001"], bundled: {}, downloaded: { uriFor: (f) => `file:///audio/${f.file}` } });
    const r = await service.playClips(["NAV-001"], "en");
    expect(r.played).toBe(true);
    expect(played[0]).toEqual([{ kind: "file", uri: "file:///audio/TH-NAV-001-EN.mp3" }]);
  });

  it("does not play a file that is neither bundled nor downloaded", async () => {
    const { service, issues } = setup({ ids: ["NAV-001"], bundled: {} });
    expect((await service.playClips(["NAV-001"], "en")).played).toBe(false);
    expect(issues).toEqual(["clip_file_missing"]);
  });
});

describe("the bundled manifest in the app", () => {
  beforeEach(() => {
    resetAudioCatalogue();
    clearAudioIssues();
  });

  it("loads, and maps triage codes to clips (EMG-001L comes from the wording file)", () => {
    expect(audioCatalogue()).not.toBeNull();
    expect(clipIdFor("EMG-001")).toBe("EMG-001");
    expect(clipIdFor("TRI-003")).toBe("TRI-003");
    expect(clipIdFor("EMG-001L")).toBe("EMG-001L");
    expect(clipIdFor("notify.triage.task_created")).toBeNull();
    expect(clipIdFor(null)).toBeNull();
  });

  it("keeps the last few issues for support and never throws", () => {
    for (let i = 0; i < 60; i++) reportAudioIssue({ code: "clip_not_recorded", clipId: `EMG-${i}`, lang: "en" });
    expect(recentAudioIssues()).toHaveLength(50);
    expect(recentAudioIssues()[49].clipId).toBe("EMG-59");
    clearAudioIssues();
    expect(recentAudioIssues()).toEqual([]);
  });
});
