import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AUDIO_SCRIPTS } from "@tarragon/i18n";
import { createCatalogue, fileNameFor, ManifestError, parseManifest, playable, requiredReviews } from "./manifest";
import { numberInWords } from "./numbers";
import { finished, realManifest, realManifestJson, REPO_ROOT, SHA } from "./test-helpers";
import type { ManifestClip } from "./types";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const mutate = (fn: (m: { clips: Record<string, unknown>[] } & Record<string, unknown>) => void) => {
  const m = clone(realManifestJson()) as { clips: Record<string, unknown>[] } & Record<string, unknown>;
  fn(m);
  return m;
};
const clip = (id: string): ManifestClip => realManifest().clips.find((c) => c.id === id) as ManifestClip;

describe("audio/manifest.json (the real one)", () => {
  const m = realManifest();

  it("parses, and ids are unique", () => {
    expect(new Set(m.clips.map((c) => c.id)).size).toBe(m.clips.length);
  });

  it("holds the whole scripted Release 1 set and the 640 number clips", () => {
    const count = (g: string) => m.clips.filter((c) => c.group === g).length;
    expect(count("ONB")).toBe(18);
    expect(count("NAV")).toBe(7);
    expect(count("HLP")).toBe(41);
    expect(count("EMG")).toBe(13);
    expect(count("TRI")).toBe(8);
    expect(count("SYM")).toBe(11);
    expect(count("CON")).toBe(12);
    expect(count("SYS")).toBe(11);
    expect(count("REM")).toBe(22);
    expect(count("RES")).toBe(29);
    const nums = m.clips.filter((c) => /^NUM-(\d{3}|S\d+)$/.test(c.id));
    expect(nums).toHaveLength(640);
    expect(m.clips.filter((c) => /^NUM-(D|P)\d\d$/.test(c.id))).toHaveLength(23); // D01 and P01 to P23 except P22
  });

  it("puts ONB, EMG, TRI, NUM and SYM in the app, the other release 1 groups after sign-up, and results on demand", () => {
    const groupOf = (g: string) => new Set(m.clips.filter((c) => c.group === g && c.release === 1).map((c) => c.bundle_group));
    for (const g of ["ONB", "EMG", "TRI", "NUM", "SYM"]) expect([...groupOf(g)]).toEqual(["bundled"]);
    for (const g of ["NAV", "HLP", "CON", "SYS", "REM"]) expect([...groupOf(g)]).toEqual(["post_signup"]);
    expect([...groupOf("RES")]).toEqual(["on_demand"]);
    // Later-release screens are never bundled.
    expect(clip("HLP-040").bundle_group).toBe("on_demand");
    expect(clip("HLP-041").release).toBe(3);
  });

  it("names every file the way the list says (TH-EMG-004-EN.mp3, TH-NUM-148.mp3)", () => {
    expect(clip("EMG-004").files.en?.file).toBe("TH-EMG-004-EN.mp3");
    expect(clip("EMG-004").files.pcm?.file).toBe("TH-EMG-004-PCM.mp3");
    expect(clip("NUM-148").files.shared?.file).toBe("TH-NUM-148.mp3");
    expect(clip("NUM-148").files.en).toBeUndefined();
    expect(clip("NUM-P01").files.pcm?.file).toBe("TH-NUM-P01-PCM.mp3");
  });

  it("has no recording and no approval anywhere: only a person adds those", () => {
    for (const c of m.clips) {
      for (const f of Object.values(c.files)) {
        expect([c.id, f?.sha256, f?.approvals.length]).toEqual([c.id, null, 0]);
      }
    }
  });

  it("marks clinical groups, and holds their Pidgin as English until a clinician signs it (OQ-19, OQ-87)", () => {
    for (const id of ["EMG-001", "TRI-002", "SYM-004", "RES-001", "CON-001", "NUM-P01", "HLP-003", "HLP-018"]) {
      expect([id, clip(id).clinical]).toEqual([id, true]);
    }
    for (const id of ["EMG-001", "TRI-006", "NUM-P03", "SYM-009"]) expect(clip(id).pcm_text).toBe("held_as_english");
    expect(clip("ONB-002").clinical).toBe(false);
    expect(clip("ONB-002").pcm_text).toBe("needs_native_review");
    expect(clip("HLP-001").clinical).toBe(false);
    expect(clip("ONB-010").legal).toBe(true);
    expect(clip("CON-001").legal).toBe(true);
  });

  it("has a script in both languages for every scripted clip, and for nothing else", () => {
    const scripted = m.clips.filter((c) => !/^NUM-(\d{3}|S\d+)$/.test(c.id)).map((c) => c.id).sort();
    expect(Object.keys(AUDIO_SCRIPTS).sort()).toEqual(scripted);
    for (const [id, s] of Object.entries(AUDIO_SCRIPTS)) {
      expect([id, s.en.trim().length > 0, s.pcm.trim().length > 0]).toEqual([id, true, true]);
    }
  });

  it("makes held Pidgin text identical to the English text, so the screen and the voice say the same thing", () => {
    for (const c of m.clips.filter((x) => x.pcm_text === "held_as_english")) {
      expect([c.id, AUDIO_SCRIPTS[c.id].pcm]).toEqual([c.id, AUDIO_SCRIPTS[c.id].en]);
    }
  });

  it("never carries a recorded explanation of a positive HIV, hepatitis B or hepatitis C result (INV-04)", () => {
    // The list records "all negative" and "immunity confirmed" only; a positive is a clinician's conversation.
    expect(AUDIO_SCRIPTS["RES-023"].en.toLowerCase()).toContain("negative");
    for (const c of m.clips.filter((x) => x.group === "RES")) {
      const words = AUDIO_SCRIPTS[c.id].en.toLowerCase();
      if (/\b(hiv|hepatitis)\b/.test(words)) expect([c.id, /\bpositive\b/.test(words.replace(/never[^.]*positive[^.]*\./g, ""))]).toEqual([c.id, false]);
    }
  });
});

describe("the number list", () => {
  const rows = readFileSync(resolve(REPO_ROOT, "audio/source/TH-NUM-number-list.csv"), "utf8")
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => /^([A-Z0-9-]+),"(.*)"$/.exec(l) as RegExpExecArray);

  it("has a clip for every whole number from 0 to 600 and every 500 steps from 1000 to 20000", () => {
    const ids = new Set(realManifest().clips.map((c) => c.id));
    for (let n = 0; n <= 600; n++) expect(ids.has(`NUM-${String(n).padStart(3, "0")}`)).toBe(true);
    for (let n = 1000; n <= 20000; n += 500) expect(ids.has(`NUM-S${n}`)).toBe(true);
    expect(rows).toHaveLength(640);
  });

  it("refuses numbers it cannot say", () => {
    expect(() => numberInWords(1000)).toThrow(RangeError);
    expect(() => numberInWords(-1)).toThrow(RangeError);
    expect(numberInWords(0)).toBe("zero");
    expect(numberInWords(40)).toBe("forty");
    expect(numberInWords(500)).toBe("five hundred");
  });

  it("says each whole number the British way, so a mistyped row in the list is caught", () => {
    for (const [, id, words] of rows) {
      const m = /^NUM-(\d{3})$/.exec(id);
      if (m) expect([id, words]).toEqual([id, numberInWords(Number(m[1]))]);
    }
  });
});

describe("parseManifest rejects what would let a wrong clip play", () => {
  const file = (over: Record<string, unknown>) => ({ file: "TH-EMG-001-EN.mp3", sha256: null, bytes: null, duration_ms: null, approvals: [], ...over });
  const edit = (id: string, key: string, over: Record<string, unknown>) =>
    mutate((m) => {
      const c = m.clips.find((x) => x.id === id) as { files: Record<string, Record<string, unknown>> };
      c.files[key] = { ...c.files[key], ...over };
    });

  it("rejects non-objects, a wrong version and missing clips", () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest({ schema_version: 2, clips: [] })).toThrow(/schema_version/);
    expect(() => parseManifest({ schema_version: 1 })).toThrow(/clips must be an array/);
    expect(() => parseManifest(mutate((m) => { m.languages = ["en"]; }))).toThrow(/languages/);
    expect(() => parseManifest(mutate((m) => { m.groups = null; }))).toThrow(/groups/);
  });

  it("rejects duplicate ids, malformed ids, unknown bundle groups and wrong file slots", () => {
    expect(() => parseManifest(mutate((m) => m.clips.push(clone(m.clips[0]))))).toThrow(/duplicate id/);
    expect(() => parseManifest(mutate((m) => { m.clips[0].id = "emg1"; }))).toThrow(/malformed/);
    expect(() => parseManifest(mutate((m) => { m.clips[0] = 5 as never; }))).toThrow(/malformed/);
    expect(() => parseManifest(mutate((m) => { m.clips[0].bundle_group = "sometimes"; }))).toThrow(/bundle_group/);
    expect(() => parseManifest(mutate((m) => { m.clips[0].files = null; }))).toThrow(/files must be an object/);
    expect(() => parseManifest(mutate((m) => { m.clips[0].files = { shared: file({}) }; }))).toThrow(/files must be/);
  });

  it("rejects a wrong file name, a bad checksum, bad sizes, and a half-recorded file", () => {
    expect(() => parseManifest(edit("EMG-001", "en", { file: "emg1.mp3" }))).toThrow(/file name/);
    expect(() => parseManifest(edit("EMG-001", "en", { sha256: "xyz", bytes: 10 }))).toThrow(/sha256/);
    expect(() => parseManifest(edit("EMG-001", "en", { sha256: SHA, bytes: 0 }))).toThrow(/bytes/);
    expect(() => parseManifest(edit("EMG-001", "en", { sha256: SHA, bytes: 10, duration_ms: -1 }))).toThrow(/duration_ms/);
    expect(() => parseManifest(edit("EMG-001", "en", { sha256: SHA }))).toThrow(/recorded together/);
  });

  it("rejects an approval on a clip with no recording, a nameless approval, an unknown review and a bad date", () => {
    const ok = { review: "brand", sha256: SHA, by: "A. Reviewer", on: "2026-10-06" };
    expect(() => parseManifest(edit("EMG-001", "en", { approvals: [ok] }))).toThrow(/no recording/);
    const rec = { sha256: SHA, bytes: 10 };
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: [{ ...ok, by: " " }] }))).toThrow(/names who/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: [{ ...ok, review: "vibes" }] }))).toThrow(/unknown review/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: [{ ...ok, on: "yesterday" }] }))).toThrow(/YYYY-MM-DD/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: [ok] }))).not.toThrow();
  });

  it("rejects a sign-off that belongs to a different recording, and a malformed history", () => {
    const rec = { sha256: SHA, bytes: 10 };
    const other = { review: "brand", sha256: "d".repeat(64), by: "A", on: "2026-10-06" };
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: [other] }))).toThrow(/different recording/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: null }))).toThrow(/must be arrays/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, approvals: ["x"] }))).toThrow(/not an object/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, history: [{ sha256: "bad" }] }))).toThrow(/history entry is malformed/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, history: [{ ...rec, sha256: SHA, approvals: [] }] }))).toThrow(/repeats the current/);
    expect(() => parseManifest(edit("EMG-001", "en", { ...rec, history: [{ ...rec, sha256: "d".repeat(64), approvals: [other] }] }))).not.toThrow();
  });

  it("rejects bad whole-phrase sign-offs", () => {
    const good = { pattern: "bp", lang: "en", by: "Dr A", on: "2026-10-06", clips: [{ id: "NUM-P01", sha256: SHA }, { id: "NUM-P02", sha256: SHA }] };
    const withSo = (so: unknown) => mutate((m) => { m.phrase_signoffs = [so]; });
    expect(() => parseManifest(withSo(good))).not.toThrow();
    expect(() => parseManifest(withSo({ ...good, pattern: "nope" }))).toThrow(/unknown pattern/);
    expect(() => parseManifest(withSo(null))).toThrow(/unknown pattern/);
    expect(() => parseManifest(withSo({ ...good, lang: "fr", by: " ", on: "x" }))).toThrow(/unknown language/);
    expect(() => parseManifest(withSo({ ...good, clips: [good.clips[0]] }))).toThrow(/exactly the pattern's clips/);
    expect(() => parseManifest(withSo({ ...good, clips: [{ id: "NUM-P01", sha256: "x" }, good.clips[1]] }))).toThrow(/checksum/);
    expect(() => parseManifest(mutate((m) => { m.phrase_signoffs = null; }))).toThrow(/phrase_signoffs/);
  });

  it("does not count a sign-off given to an earlier recording (fail closed)", () => {
    const base = finished(clip("EMG-001"));
    const stale = { ...base, files: { en: { ...base.files.en!, sha256: "e".repeat(64) }, pcm: base.files.pcm } };
    expect(playable(stale, "en")).toEqual({ ok: false, reason: "awaiting_review" });
  });

  it("rejects approving a Pidgin recording whose words are still held as English", () => {
    const rec = { sha256: SHA, bytes: 10, approvals: [{ review: "native_pidgin", sha256: SHA, by: "A", on: "2026-10-06" }] };
    expect(() => parseManifest(edit("EMG-001", "pcm", rec))).toThrow(/held as English/);
    // A non-clinical clip's Pidgin can be approved: it is only a draft needing review.
    expect(() => parseManifest(edit("ONB-002", "pcm", rec))).not.toThrow();
  });

  it("summarises long problem lists", () => {
    const m = mutate((x) => x.clips.slice(0, 8).forEach((c) => { c.bundle_group = "x"; }));
    expect(() => parseManifest(m)).toThrow(/more\)/);
  });
});

describe("who must sign a recording, and when it may play", () => {
  it("needs brand always, clinical for clinical clips, legal for legal clips and a native speaker for Pidgin", () => {
    expect(requiredReviews({ clinical: false, legal: false }, "en")).toEqual(["brand"]);
    expect(requiredReviews({ clinical: true, legal: false }, "pcm")).toEqual(["brand", "clinical", "native_pidgin"]);
    expect(requiredReviews({ clinical: true, legal: true }, "en")).toEqual(["brand", "clinical", "legal"]);
    expect(fileNameFor("NUM-148", "shared")).toBe("TH-NUM-148.mp3");
  });

  it("does not play a clip with no recording", () => {
    expect(playable(clip("EMG-001"), "en")).toEqual({ ok: false, reason: "no_recording" });
  });

  it("does not play a recorded clinical clip until the clinician has signed it", () => {
    const base = finished(clip("EMG-001"));
    const noClinical: ManifestClip = { ...base, files: { en: { ...base.files.en!, approvals: base.files.en!.approvals.filter((a) => a.review !== "clinical") } } };
    expect(playable(noClinical, "en")).toEqual({ ok: false, reason: "awaiting_review" });
    expect(playable(base, "en").ok).toBe(true);
  });

  it("plays a number clip from the one shared recording in either language", () => {
    const n = finished(clip("NUM-148"));
    expect(playable(n, "pcm")).toMatchObject({ ok: true, key: "shared" });
    expect(playable(n, "en")).toMatchObject({ ok: true, key: "shared" });
  });

  it("looks clips up by id", () => {
    const cat = createCatalogue(realManifest());
    expect(cat.get("EMG-001")?.group).toBe("EMG");
    expect(cat.get("NOPE-1")).toBeUndefined();
  });
});
