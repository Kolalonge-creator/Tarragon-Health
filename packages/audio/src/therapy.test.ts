import { describe, expect, it } from "@jest/globals";
import { THERAPY_WAVE_A_CONTENT, therapyClipId } from "@tarragon/shared";
import { createCatalogue, parseManifest } from "./manifest";
import { realManifestJson, finished } from "./test-helpers";
import { therapyAudioFor, therapyClips, withTherapyClips, THERAPY_GROUP } from "./therapy";

describe("S63 therapy audio keys", () => {
  const base = parseManifest(realManifestJson());
  const merged = withTherapyClips(base);

  it("adds one unrecorded clip per Wave A session and the merged manifest still passes the strict parser", () => {
    const sessions = THERAPY_WAVE_A_CONTENT.reduce((n, p) => n + p.sessions.length, 0);
    expect(therapyClips()).toHaveLength(sessions);
    expect(() => parseManifest(JSON.parse(JSON.stringify(merged)))).not.toThrow();
    expect(merged.clips.length).toBe(base.clips.length + sessions);
  });

  it("does not collide with any existing clip id and does not change the input", () => {
    const existing = new Set(base.clips.map((c) => c.id));
    expect(therapyClips().filter((c) => existing.has(c.id))).toEqual([]);
    expect(base.clips.some((c) => c.group === THERAPY_GROUP)).toBe(false);
  });

  it("generates no audio: nothing is recorded, nothing is signed", () => {
    for (const c of therapyClips()) {
      const f = c.files.en;
      expect(f?.sha256).toBeNull();
      expect(f?.bytes).toBeNull();
      expect(f?.approvals).toEqual([]);
      expect(c.clinical).toBe(true);
    }
  });

  it("every session in the drafts has its own id, in the THP form", () => {
    const ids = THERAPY_WAVE_A_CONTENT.flatMap((p) => p.sessions.map((s) => therapyClipId(p.clip, s.ordinal)));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^THP-[A-Z]{3}\d{2}$/);
  });

  it("falls back to the text for an unrecorded clip, an unknown id and a missing id", () => {
    const cat = createCatalogue(merged);
    expect(therapyAudioFor(cat, "THP-PAN01")).toEqual({ ok: false, reason: "no_recording" });
    expect(therapyAudioFor(cat, "THP-ZZZ99")).toEqual({ ok: false, reason: "no_recording" });
    expect(therapyAudioFor(cat, null)).toEqual({ ok: false, reason: "no_recording" });
  });

  it("a recording without a clinical sign-off is held, with one it plays (control)", () => {
    const clip = therapyClips()[0] as ReturnType<typeof therapyClips>[number];
    const recordedUnsigned = { ...clip, files: { en: { ...(clip.files.en as NonNullable<typeof clip.files.en>), sha256: "a".repeat(64), bytes: 10, duration_ms: 1000 } } };
    expect(therapyAudioFor(createCatalogue({ ...merged, clips: [recordedUnsigned] }), clip.id)).toEqual({ ok: false, reason: "awaiting_review" });
    expect(therapyAudioFor(createCatalogue({ ...merged, clips: [finished(clip)] }), clip.id).ok).toBe(true);
  });
});
