import { THERAPY_WAVE_A_CONTENT, therapyClipId } from "@tarragon/shared";
import { fileNameFor, playable, type Catalogue, type PlayableResult } from "./manifest";
import type { Manifest, ManifestClip, ManifestGroup } from "./types";

/**
 * S63: the audio keys for digital therapy programme sessions (group THP). A session row in the database names one of these ids
 * (`therapy_programme_sessions.audio_clip_id`); the player resolves it through the same catalogue, review gate and checksum rules
 * as every other clip, so a recording that is missing, unsigned or changed falls back to the session text.
 *
 * NO AUDIO IS GENERATED HERE. The entries below are "not recorded" (no checksum, no size, no approvals) and the bundle group is
 * on_demand (low data: a patient downloads a session only when they open it). `withTherapyClips` is what the production-list import
 * adds to audio/manifest.json when the recordings are commissioned; until then the app shows the session text.
 */
export const THERAPY_GROUP = "THP";

export const THERAPY_GROUP_META: ManifestGroup = {
  title: "Digital therapy programme sessions",
  bundle_group: "on_demand",
  reaches_phone: "Download on demand",
  review: "Clinical sign-off required (Chief Medical Officer); wording is a draft until then",
};

/** One unrecorded, clinical clip per programme session in the Wave A drafts. */
export function therapyClips(): ManifestClip[] {
  return THERAPY_WAVE_A_CONTENT.flatMap((programme) =>
    programme.sessions.map((s): ManifestClip => {
      const id = therapyClipId(programme.clip, s.ordinal);
      return {
        id,
        group: THERAPY_GROUP,
        bundle_group: "on_demand",
        release: 3,
        clinical: true,
        legal: false,
        language_neutral: false,
        files: { en: { file: fileNameFor(id, "en"), sha256: null, bytes: null, duration_ms: null, approvals: [], history: [] } },
        script_hash: null,
      };
    }),
  );
}

/** A manifest with the therapy clips added (when not already there). The input is not changed. */
export function withTherapyClips(manifest: Manifest): Manifest {
  const have = new Set(manifest.clips.map((c) => c.id));
  const add = therapyClips().filter((c) => !have.has(c.id));
  return { ...manifest, groups: { ...manifest.groups, [THERAPY_GROUP]: THERAPY_GROUP_META }, clips: [...manifest.clips, ...add] };
}

/** May this session's recording play? Anything but a signed, recorded, matching clip means use the text. */
export function therapyAudioFor(catalogue: Catalogue, clipId: string | null): PlayableResult {
  if (!clipId) return { ok: false, reason: "no_recording" };
  const clip = catalogue.get(clipId);
  if (!clip) return { ok: false, reason: "no_recording" };
  return playable(clip, "en");
}
