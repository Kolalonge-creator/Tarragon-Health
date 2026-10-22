import { fileNameFor, playable, type Catalogue, type PlayableResult } from "./manifest";
import type { Manifest, ManifestClip, ManifestGroup } from "./types";

/**
 * S48b: audio hooks for instructor-led home workouts and chair-based classes (spec 5.4, group WKO).
 *
 * NO AUDIO (AND NO VIDEO) IS RECORDED OR GENERATED HERE. Every entry is a DRAFT slot: "not recorded" (no checksum, size or approvals), clinical (a
 * recording needs the CMO's review as well as brand review), on demand (low data). `withWorkoutClips` is what the production-list import adds to
 * audio/manifest.json once the scripts are clinician-reviewed and recordings are commissioned, the same route the therapy (THP) and report (RPT)
 * clips take. Until a recording exists and carries every review, `workoutAudioFor` answers "use the text", and the workout screens show the written
 * steps, which are always there. A low-data video clip would be a second slot kind added the same way; none exists.
 */
export const WORKOUT_GROUP = "WKO";

export const WORKOUT_GROUP_META: ManifestGroup = {
  title: "Home workouts and chair-based classes (draft slots)",
  bundle_group: "on_demand",
  reaches_phone: "Download on demand",
  review: "Clinical sign-off required (Chief Medical Officer); no script is approved and nothing is recorded yet",
};

/** The starter plans' codes (workout_plans.code) and the draft slot each would use. A new plan adds a slot here, in the same change. */
const SLOT_BY_PLAN: Readonly<Record<string, string>> = {
  starter_gentle_home_10: "WKO-001",
  starter_chair_class_15: "WKO-002",
  starter_moderate_home_20: "WKO-003",
};

export function workoutAudioClipId(planCode: string): string | null {
  return SLOT_BY_PLAN[planCode] ?? null;
}

/** One draft, unrecorded, clinical clip per slot. */
export function workoutClips(): ManifestClip[] {
  return Object.values(SLOT_BY_PLAN).map((id): ManifestClip => ({
    id,
    group: WORKOUT_GROUP,
    bundle_group: "on_demand",
    release: 3,
    clinical: true,
    legal: false,
    language_neutral: false,
    files: { en: { file: fileNameFor(id, "en"), sha256: null, bytes: null, duration_ms: null, approvals: [], history: [] } },
    script_hash: null,
  }));
}

/** A manifest with the workout slots added (when not already there). The input is not changed. */
export function withWorkoutClips(manifest: Manifest): Manifest {
  const have = new Set(manifest.clips.map((c) => c.id));
  const add = workoutClips().filter((c) => !have.has(c.id));
  return { ...manifest, groups: { ...manifest.groups, [WORKOUT_GROUP]: WORKOUT_GROUP_META }, clips: [...manifest.clips, ...add] };
}

/** May this plan play as audio? Anything but a signed, recorded, matching clip means use the written steps. */
export function workoutAudioFor(catalogue: Catalogue, planCode: string): PlayableResult {
  const id = workoutAudioClipId(planCode);
  if (!id) return { ok: false, reason: "no_recording" };
  const clip = catalogue.get(id);
  if (!clip) return { ok: false, reason: "no_recording" };
  return playable(clip, "en");
}
