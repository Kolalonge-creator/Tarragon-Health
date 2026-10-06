import { describe, expect, it } from "@jest/globals";
import { createCatalogue } from "./manifest";
import { phraseText, resolveClips, resolvePhrase, type ClipLocator, type ResolveDeps } from "./resolve";
import { scriptText } from "./language";
import { stitchBloodPressure } from "./stitch";
import { withFinished } from "./test-helpers";
import type { AudioIssue, Manifest } from "./types";

function deps(manifest: Manifest, present: ((id: string) => boolean) | "all" = "all") {
  const issues: AudioIssue[] = [];
  const locator: ClipLocator = { has: (id) => (present === "all" ? true : present(id)) };
  const d: ResolveDeps = { catalogue: createCatalogue(manifest), locator, script: scriptText, report: (i) => issues.push(i) };
  return { d, issues };
}

describe("emergency and triage clips with no network (INV-06, safety case 1 area)", () => {
  const manifest = withFinished("all");
  it("plays every bundled EMG and TRI clip in both languages from the phone alone", async () => {
    const { d, issues } = deps(manifest);
    for (const c of manifest.clips.filter((x) => x.group === "EMG" || x.group === "TRI")) {
      for (const lang of ["en", "pcm"] as const) {
        const r = await resolveClips([c.id], lang, d);
        expect([c.id, lang, r.complete]).toEqual([c.id, lang, true]);
        expect(r.lang).toBe(lang);
        expect(r.steps).toHaveLength(1);
      }
    }
    expect(issues).toEqual([]);
  });

  it("returns the words with the audio, so the screen can always show what the voice says", async () => {
    const { d } = deps(manifest);
    const r = await resolveClips(["EMG-001"], "en", d);
    expect(r.text).toBe(scriptText("EMG-001", "en"));
    expect(r.text).toMatch(/needs attention now/);
  });
});

describe("a missing clip shows the text and logs a non-fatal issue (spec 8.8)", () => {
  it("not recorded yet", async () => {
    const { d, issues } = deps(withFinished([]));
    const r = await resolveClips(["EMG-001"], "en", d);
    expect(r).toMatchObject({ complete: false, steps: [], text: scriptText("EMG-001", "en") });
    expect(issues).toEqual([{ code: "clip_not_recorded", clipId: "EMG-001", lang: "en" }]);
  });

  it("recorded but not signed: held back, and reported as a review hold", async () => {
    const m = withFinished(["EMG-001"]);
    const clip = m.clips.find((c) => c.id === "EMG-001")!;
    const stripped: Manifest = {
      ...m,
      clips: m.clips.map((c) => (c === clip ? { ...c, files: { en: { ...c.files.en!, approvals: [] }, pcm: c.files.pcm } } : c)),
    };
    const { d, issues } = deps(stripped);
    expect((await resolveClips(["EMG-001"], "en", d)).complete).toBe(false);
    expect(issues[0].code).toBe("clip_awaiting_review");
  });

  it("signed, but the file is not on the phone", async () => {
    const { d, issues } = deps(withFinished("all"), () => false);
    const r = await resolveClips(["EMG-001"], "en", d);
    expect(r.complete).toBe(false);
    expect(issues).toEqual([{ code: "clip_file_missing", clipId: "EMG-001", lang: "en", detail: "TH-EMG-001-EN.mp3" }]);
  });

  it("an id the manifest does not know (for example EMG-001L, which the list does not have)", async () => {
    const { d, issues } = deps(withFinished("all"));
    const r = await resolveClips(["EMG-001L"], "en", d);
    expect(r).toMatchObject({ complete: false, text: "" });
    expect(issues).toEqual([{ code: "clip_unknown", clipId: "EMG-001L", lang: "en" }]);
  });
});

describe("a stitched phrase is all or nothing", () => {
  it("never plays half a reading when one number clip is absent", async () => {
    const m = withFinished("all");
    const { d, issues } = deps(m, (id) => id !== "NUM-094");
    const phrase = stitchBloodPressure(148, 94)!;
    const r = await resolvePhrase(phrase, "en", d);
    expect(r.complete).toBe(false);
    expect(r.steps).toEqual([]);
    expect(r.text).toBe("Your blood pressure reading is 148 over 94");
    expect(issues).toEqual([{ code: "clip_file_missing", clipId: "NUM-094", lang: "en", detail: "TH-NUM-094.mp3" }]);
  });

  it("plays the whole phrase in order when every clip is present", async () => {
    const { d } = deps(withFinished("all"));
    const r = await resolvePhrase(stitchBloodPressure(148, 94)!, "en", d);
    expect(r.complete).toBe(true);
    expect(r.steps.map((s) => s.clipId)).toEqual(["NUM-P01", "NUM-148", "NUM-P02", "NUM-094"]);
    expect(r.steps.map((s) => s.key)).toEqual(["en", "shared", "en", "shared"]);
  });
});

describe("language", () => {
  it("falls back to English audio for held clinical Pidgin, because the Pidgin text is English too", async () => {
    const m = withFinished("all");
    // Pidgin recording of EMG-001 is withheld (not signed); the English one is fine.
    const noPcm: Manifest = {
      ...m,
      clips: m.clips.map((c) => (c.id === "EMG-001" ? { ...c, pcm_text: "held_as_english" as const, files: { en: c.files.en, pcm: { ...c.files.pcm!, approvals: [] } } } : c)),
    };
    const { d } = deps(noPcm);
    const r = await resolveClips(["EMG-001"], "pcm", d);
    expect(r).toMatchObject({ complete: true, lang: "en", text: scriptText("EMG-001", "en") });
  });

  it("does NOT swap in English audio under draft Pidgin text that is not held (it would say something else)", async () => {
    const m = withFinished("all");
    const noPcm: Manifest = { ...m, clips: m.clips.map((c) => (c.id === "ONB-002" ? { ...c, files: { en: c.files.en, pcm: { ...c.files.pcm!, approvals: [] } } } : c)) };
    const { d, issues } = deps(noPcm);
    const r = await resolveClips(["ONB-002"], "pcm", d);
    expect(r).toMatchObject({ complete: false, lang: "pcm", text: scriptText("ONB-002", "pcm") });
    expect(issues[0]).toMatchObject({ code: "clip_awaiting_review", lang: "pcm" });
  });

  it("has no fallback for English, and an unknown id is not a Pidgin fallback candidate either", async () => {
    const { d } = deps(withFinished([]));
    expect((await resolveClips(["EMG-001"], "en", d)).lang).toBe("en");
    expect((await resolveClips(["EMG-001L"], "pcm", d)).complete).toBe(false);
  });

  it("plays number clips for a Pidgin reader from the shared recording", async () => {
    const { d } = deps(withFinished("all"));
    const r = await resolvePhrase(stitchBloodPressure(120, 80)!, "pcm", d);
    expect(r).toMatchObject({ complete: true, lang: "pcm" });
    expect(r.steps.map((s) => s.key)).toEqual(["pcm", "shared", "pcm", "shared"]);
  });
});

describe("phraseText", () => {
  it("joins digits tight around a decimal point and sentence parts with spaces", () => {
    const text = phraseText(
      { steps: [{ id: "NUM-P06" }, { id: "NUM-072", literal: "72" }, { id: "NUM-D01", literal: ".", tight: true }, { id: "NUM-005", literal: "5", tight: true }, { id: "NUM-P07" }] },
      "en",
      scriptText,
    );
    expect(text).toBe("Your weight is 72.5 kilograms");
  });
});
