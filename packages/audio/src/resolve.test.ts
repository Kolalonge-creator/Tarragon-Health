import { describe, expect, it } from "@jest/globals";
import { createCatalogue } from "./manifest";
import { phraseText, resolveClips, resolvePhrase, type ClipLocator, type ResolveDeps } from "./resolve";
import { scriptText } from "./language";
import { stitchBloodPressure, stitchWeight, withSeverity } from "./stitch";
import { finished, realManifest, withFinished, withPhraseSignoffs } from "./test-helpers";
import type { AudioIssue, Manifest } from "./types";

function deps(manifest: Manifest, present: ((id: string) => boolean) | "all" = "all") {
  const issues: AudioIssue[] = [];
  const locator: ClipLocator = { has: (id) => (present === "all" ? true : present(id)) };
  const d: ResolveDeps = { catalogue: createCatalogue(manifest), locator, script: scriptText, report: (i) => issues.push(i) };
  return { d, issues };
}

describe("emergency and triage clips with no network (INV-06, safety case 1 area)", () => {
  const manifest = withFinished("all");
  it("plays every bundled EMG and TRI clip from the phone alone", async () => {
    const { d, issues } = deps(manifest);
    for (const c of manifest.clips.filter((x) => x.group === "EMG" || x.group === "TRI")) {
      for (const lang of ["en"] as const) {
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
      clips: m.clips.map((c) => (c === clip ? { ...c, files: { en: { ...c.files.en!, approvals: [] } } } : c)),
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

const reading = (sys = 148, dia = 94) => withSeverity(stitchBloodPressure(sys, dia), "TRI-003")!;

describe("a stitched phrase is all or nothing", () => {
  it("never plays half a reading when one number clip is absent", async () => {
    const { d, issues } = deps(withFinished("all"), (id) => id !== "NUM-094");
    const r = await resolvePhrase(reading(), "en", d);
    expect(r.complete).toBe(false);
    expect(r.steps).toEqual([]);
    expect(r.text).toMatch(/^Your blood pressure reading is 148 over 94 /);
    expect(issues).toEqual([{ code: "clip_file_missing", clipId: "NUM-094", lang: "en", detail: "TH-NUM-094.mp3" }]);
  });

  it("plays the whole phrase in order, ending with its triage sentence, when every clip is present", async () => {
    const { d } = deps(withFinished("all"));
    const r = await resolvePhrase(reading(), "en", d);
    expect(r.complete).toBe(true);
    expect(r.steps.map((s) => s.clipId)).toEqual(["NUM-P01", "NUM-148", "NUM-P02", "NUM-094", "TRI-003"]);
    expect(r.steps.map((s) => s.key)).toEqual(["en", "shared", "en", "shared", "en"]);
  });
});

describe("a clinical reading is never spoken alone (design change from the competitor review)", () => {
  it("refuses a blood pressure, glucose, pulse or HbA1c phrase with no triage sentence", async () => {
    const { d, issues } = deps(withFinished("all"));
    const r = await resolvePhrase(stitchBloodPressure(148, 94)!, "en", d);
    expect(r).toMatchObject({ complete: false, steps: [], text: "Your blood pressure reading is 148 over 94" });
    expect(issues).toEqual([{ code: "phrase_missing_severity", clipId: null, lang: "en", detail: "bp" }]);
  });

  it("allows a weight, which is not a graded reading, with none", async () => {
    const { d } = deps(withFinished("all"));
    expect((await resolvePhrase(stitchWeight(72.5)!, "en", d)).complete).toBe(true);
  });

  it("only attaches a TRI or EMG clip as the triage sentence", () => {
    expect(withSeverity(stitchBloodPressure(1, 1), "NUM-148")).toBeNull();
    expect(withSeverity(null, "TRI-001")).toBeNull();
    expect(withSeverity(stitchBloodPressure(1, 1), "EMG-001L")).not.toBeNull();
  });
});

describe("a stitched pattern plays only when a clinician signed the whole phrase", () => {
  it("is held back, with a reason, when no sign-off exists, even if every clip is signed", async () => {
    const m = { ...withFinished("all"), phrase_signoffs: [] };
    const { d, issues } = deps(m);
    const r = await resolvePhrase(reading(), "en", d);
    expect(r.complete).toBe(false);
    expect(issues).toEqual([{ code: "phrase_not_signed", clipId: null, lang: "en", detail: "bp" }]);
  });

  it("stops holding once a lead-in is re-recorded after the sign-off (fail closed)", async () => {
    const m = withFinished("all");
    const re = { ...m, clips: m.clips.map((c) => (c.id === "NUM-P02" ? finished(c, "f".repeat(64)) : c)) };
    const { d, issues } = deps(re);
    expect((await resolvePhrase(reading(), "en", d)).complete).toBe(false);
    expect(issues[0].code).toBe("phrase_not_signed");
    expect((await resolvePhrase(reading(), "en", deps(withPhraseSignoffs(re)).d)).complete).toBe(true);
  });

  it("starts with nothing signed in the real manifest", () => {
    expect(realManifest().phrase_signoffs).toEqual([]);
  });
});

describe("language", () => {
  it("plays in English, and an unknown id does not play", async () => {
    const { d } = deps(withFinished([]));
    expect((await resolveClips(["EMG-001"], "en", d)).lang).toBe("en");
    expect((await resolveClips(["EMG-001L"], "en", d)).complete).toBe(false);
  });

  it("plays number clips from the shared recording", async () => {
    const { d } = deps(withFinished("all"));
    const r = await resolvePhrase(reading(120, 80), "en", d);
    expect(r).toMatchObject({ complete: true, lang: "en" });
    expect(r.steps.map((s) => s.key)).toEqual(["en", "shared", "en", "shared", "en"]);
  });
});

describe("phraseText", () => {
  it("joins digits tight around a decimal point and sentence parts with spaces", () => {
    const text = phraseText(
      { pattern: "weight", steps: [{ id: "NUM-P06" }, { id: "NUM-072", literal: "72" }, { id: "NUM-D01", literal: ".", tight: true }, { id: "NUM-005", literal: "5", tight: true }, { id: "NUM-P07" }] },
      "en",
      scriptText,
    );
    expect(text).toBe("Your weight is 72.5 kilograms");
  });
});
