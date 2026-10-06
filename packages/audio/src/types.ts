/**
 * The audio manifest (spec 8.8): `audio/manifest.json`. One entry per clip id, with the file, size, checksum and
 * duration of its recording per language, and the bundle group that says how the clip reaches the phone.
 */
export type Lang = "en" | "pcm";
export const LANGS: readonly Lang[] = ["en", "pcm"];

export type BundleGroup = "bundled" | "post_signup" | "on_demand";
export const BUNDLE_GROUPS: readonly BundleGroup[] = ["bundled", "post_signup", "on_demand"];

/** "shared" is the one recording of a clip that says the same thing in both languages (whole numbers, rounded steps). */
export type FileKey = Lang | "shared";

export type ReviewKind = "brand" | "clinical" | "legal" | "native_pidgin";
export const REVIEW_KINDS: readonly ReviewKind[] = ["brand", "clinical", "legal", "native_pidgin"];

/**
 * A named person's sign-off on one recording (the list's "audio log"). Only a human adds these; nothing in the
 * code or the import script ever creates one.
 */
export interface Approval {
  readonly review: ReviewKind;
  /** The recording this sign-off is for. A sign-off on one take never carries over to a different take. */
  readonly sha256: string;
  readonly by: string;
  /** ISO date, YYYY-MM-DD. */
  readonly on: string;
}

/** A recording that was replaced, kept with its sign-offs so it can be restored (rollback) and traced. */
export interface RecordingVersion {
  readonly sha256: string;
  readonly bytes: number;
  readonly duration_ms: number | null;
  readonly approvals: readonly Approval[];
}

export interface ClipFile {
  readonly file: string;
  /** Null until the recording exists. A clip with no checksum is "not recorded yet". */
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly duration_ms: number | null;
  readonly approvals: readonly Approval[];
  /** Earlier recordings of this file, newest first. */
  readonly history: readonly RecordingVersion[];
}

/**
 * Where a clip's Pidgin words stand. `held_as_english`: a clinical clip whose Pidgin is not signed yet, so the
 * Pidgin text is the English text (OQ-19, OQ-87). `needs_native_review`: non-clinical draft Pidgin (spec 12).
 */
export type PcmTextStatus = "held_as_english" | "needs_native_review" | "reviewed" | "not_applicable";

export interface ManifestClip {
  readonly id: string;
  readonly group: string;
  readonly bundle_group: BundleGroup;
  readonly release: number;
  readonly clinical: boolean;
  readonly legal: boolean;
  readonly language_neutral: boolean;
  readonly pcm_text: PcmTextStatus;
  readonly files: Readonly<Partial<Record<FileKey, ClipFile>>>;
  /** Hash of the words the recording was made from; a changed script drops the recording's facts and approvals. */
  readonly script_hash: string | null;
  /** Same for the Pidgin words, so releasing Pidgin does not invalidate the English recording. */
  readonly pcm_script_hash?: string | null;
}

export interface ManifestGroup {
  readonly title: string;
  readonly bundle_group: BundleGroup;
  readonly reaches_phone: string;
  readonly review: string;
}

/**
 * A clinician's sign-off of one stitched-phrase pattern in one language AS A WHOLE (its lead-ins, units and joining
 * words), over the exact recordings it was heard with. Valid only while every listed clip still has that checksum.
 */
export interface PhraseSignoff {
  readonly pattern: string;
  readonly lang: Lang;
  readonly clips: readonly { readonly id: string; readonly sha256: string }[];
  readonly by: string;
  readonly on: string;
}

export interface Manifest {
  readonly schema_version: 1;
  readonly source: { readonly document: string; readonly version: string; readonly date: string; readonly number_list: string };
  readonly languages: readonly Lang[];
  readonly groups: Readonly<Record<string, ManifestGroup>>;
  readonly phrase_signoffs: readonly PhraseSignoff[];
  readonly clips: readonly ManifestClip[];
}

/** A non-fatal problem the audio layer reports and then carries on from: the text is always shown instead. */
export type AudioIssueCode =
  | "clip_unknown"
  | "clip_not_recorded"
  | "clip_awaiting_review"
  | "clip_file_missing"
  | "clip_checksum_mismatch"
  | "phrase_not_possible"
  | "phrase_not_signed"
  | "phrase_missing_severity"
  | "engine_unavailable"
  | "playback_failed"
  | "manifest_invalid";

export interface AudioIssue {
  readonly code: AudioIssueCode;
  readonly clipId: string | null;
  readonly lang: Lang | null;
  readonly detail?: string;
}

export type ReportIssue = (issue: AudioIssue) => void;
