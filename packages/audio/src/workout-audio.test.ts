import { describe, expect, it } from "@jest/globals";
import { createCatalogue, parseManifest } from "./manifest";
import { finished, realManifestJson } from "./test-helpers";
import { WORKOUT_GROUP, workoutAudioClipId, workoutAudioFor, workoutClips, withWorkoutClips } from "./workout-audio";

describe("S48b workout audio hooks (draft slots, nothing recorded)", () => {
  const base = parseManifest(realManifestJson());
  const merged = withWorkoutClips(base);

  it("adds one draft clip per starter plan and the merged manifest still passes the strict parser", () => {
    expect(workoutClips()).toHaveLength(3);
    expect(() => parseManifest(JSON.parse(JSON.stringify(merged)))).not.toThrow();
    expect(base.clips.some((c) => c.group === WORKOUT_GROUP)).toBe(false);
    const existing = new Set(base.clips.map((c) => c.id));
    expect(workoutClips().filter((c) => existing.has(c.id))).toEqual([]);
  });

  it("fabricates no audio: nothing is recorded, nothing is signed, every slot is clinical", () => {
    for (const c of workoutClips()) {
      expect(c.files.en).toMatchObject({ sha256: null, bytes: null, duration_ms: null, approvals: [] });
      expect(c.clinical).toBe(true);
      expect(c.script_hash).toBeNull();
    }
  });

  it("falls back to the written steps for every draft slot, and for an unknown plan", () => {
    const cat = createCatalogue(merged);
    expect(workoutAudioFor(cat, "starter_chair_class_15")).toEqual({ ok: false, reason: "no_recording" });
    expect(workoutAudioClipId("not_a_plan")).toBeNull();
    expect(workoutAudioFor(cat, "not_a_plan")).toEqual({ ok: false, reason: "no_recording" });
    expect(workoutAudioFor(createCatalogue(base), "starter_chair_class_15")).toEqual({ ok: false, reason: "no_recording" });
  });

  it("control: a recorded, fully signed clip plays; without the clinical review it is held", () => {
    const clip = workoutClips()[1]!;
    const done = finished(clip);
    expect(workoutAudioFor(createCatalogue({ ...merged, clips: [done] }), "starter_chair_class_15").ok).toBe(true);
    const unsigned = { ...done, files: { en: { ...done.files.en!, approvals: done.files.en!.approvals.filter((a) => a.review === "brand") } } };
    expect(workoutAudioFor(createCatalogue({ ...merged, clips: [unsigned] }), "starter_chair_class_15")).toEqual({ ok: false, reason: "awaiting_review" });
  });
});
