import { PATTERN_CLIPS, type PhrasePattern } from "./stitch";
import {
  type Approval,
  BUNDLE_GROUPS,
  LANGS,
  REVIEW_KINDS,
  type ClipFile,
  type FileKey,
  type Lang,
  type Manifest,
  type PhraseSignoff,
  type ManifestClip,
  type ReviewKind,
} from "./types";

export class ManifestError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid audio manifest: ${problems.slice(0, 5).join("; ")}${problems.length > 5 ? ` (+${problems.length - 5} more)` : ""}`);
    this.name = "ManifestError";
  }
}

const SHA256 = /^[0-9a-f]{64}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[A-Z]{3}-[A-Z0-9]+$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** `TH-EMG-004-EN.mp3`, or `TH-NUM-148.mp3` for a recording that does not depend on the language (list section 3.3). */
export function fileNameFor(clipId: string, key: FileKey): string {
  return key === "shared" ? `TH-${clipId}.mp3` : `TH-${clipId}-${key.toUpperCase()}.mp3`;
}

/** Who has to sign a recording before it may play. Brand always; the rest by what the clip is (list section 4). */
export function requiredReviews(clip: Pick<ManifestClip, "clinical" | "legal">, _key?: FileKey): readonly ReviewKind[] {
  const r: ReviewKind[] = ["brand"];
  if (clip.clinical) r.push("clinical");
  if (clip.legal) r.push("legal");
  return r;
}

export type PlayableResult =
  | { readonly ok: true; readonly key: FileKey; readonly file: ClipFile }
  | { readonly ok: false; readonly reason: "no_recording" | "awaiting_review" };

/** The recording slot a clip uses for a language: the shared one for a language-neutral clip. */
export const fileKeyFor = (clip: Pick<ManifestClip, "language_neutral">, lang: Lang): FileKey => (clip.language_neutral ? "shared" : lang);

/**
 * May this clip play in this language? Only a real recording (checksum and size known) that carries every review
 * it needs. "Not recorded" and "recorded but not signed" are different, because the second is a clinical hold.
 */
export function playable(clip: ManifestClip, lang: Lang): PlayableResult {
  const key = fileKeyFor(clip, lang);
  const file = clip.files[key];
  if (!file || file.sha256 === null || file.bytes === null) return { ok: false, reason: "no_recording" };
  // Fail closed: a sign-off counts only for the exact recording it was given on.
  const have = new Set(file.approvals.filter((a) => a.sha256 === file.sha256).map((a) => a.review));
  if (!requiredReviews(clip, key).every((r) => have.has(r))) return { ok: false, reason: "awaiting_review" };
  return { ok: true, key, file };
}

function checkFile(clip: ManifestClip, key: FileKey, file: ClipFile, problems: string[]): void {
  const at = `${clip.id}.${key}`;
  if (file.file !== fileNameFor(clip.id, key)) problems.push(`${at}: file name must be ${fileNameFor(clip.id, key)}`);
  if (file.sha256 !== null && !SHA256.test(file.sha256)) problems.push(`${at}: sha256 is not 64 hex characters`);
  if (file.bytes !== null && !(Number.isInteger(file.bytes) && file.bytes > 0)) problems.push(`${at}: bytes must be a positive integer`);
  if (file.duration_ms !== null && !(Number.isInteger(file.duration_ms) && file.duration_ms > 0)) problems.push(`${at}: duration_ms must be a positive integer`);
  if ((file.sha256 === null) !== (file.bytes === null)) problems.push(`${at}: sha256 and bytes are recorded together`);
  const recorded = file.sha256 !== null;
  if (!Array.isArray(file.approvals) || !Array.isArray(file.history)) {
    problems.push(`${at}: approvals and history must be arrays`);
    return;
  }
  const checkApprovals = (list: readonly Approval[], forSha: string | null, where: string) => {
    for (const a of list) {
      if (!isRecord(a)) {
        problems.push(`${where}: an approval is not an object`);
        continue;
      }
      if (!REVIEW_KINDS.includes(a.review)) problems.push(`${where}: unknown review ${String(a.review)}`);
      if (typeof a.by !== "string" || a.by.trim() === "") problems.push(`${where}: an approval names who gave it`);
      if (typeof a.on !== "string" || !ISO_DATE.test(a.on)) problems.push(`${where}: approval date must be YYYY-MM-DD`);
      if (a.sha256 !== forSha) problems.push(`${where}: an approval is for a different recording than the one it sits on`);
    }
  };
  checkApprovals(file.approvals, file.sha256, at);
  for (const h of file.history) {
    if (!isRecord(h) || typeof h.sha256 !== "string" || !SHA256.test(h.sha256) || !Number.isInteger(h.bytes) || !Array.isArray(h.approvals)) {
      problems.push(`${at}: a history entry is malformed`);
      continue;
    }
    if (h.sha256 === file.sha256) problems.push(`${at}: history repeats the current recording`);
    checkApprovals(h.approvals, h.sha256, `${at} history`);
  }
  // A sign-off is for a recording. No approval can exist for a file that does not.
  if (!recorded && file.approvals.length > 0) problems.push(`${at}: approvals on a clip that has no recording`);
}

function checkSignoff(so: PhraseSignoff, problems: string[]): void {
  const at = `phrase sign-off ${isRecord(so) ? String(so.pattern) : "?"}`;
  const fixed = isRecord(so) ? PATTERN_CLIPS[so.pattern as PhrasePattern] : undefined;
  if (!fixed) return void problems.push(`${at}: unknown pattern`);
  if (!LANGS.includes(so.lang)) problems.push(`${at}: unknown language`);
  if (typeof so.by !== "string" || so.by.trim() === "") problems.push(`${at}: names who gave it`);
  if (typeof so.on !== "string" || !ISO_DATE.test(so.on)) problems.push(`${at}: date must be YYYY-MM-DD`);
  const ids = Array.isArray(so.clips) ? so.clips.map((c) => c?.id) : [];
  if ([...ids].sort().join() !== [...fixed.clips].sort().join()) problems.push(`${at}: must list exactly the pattern's clips`);
  if (Array.isArray(so.clips) && so.clips.some((c) => !SHA256.test(String(c?.sha256)))) problems.push(`${at}: every clip needs its checksum`);
}

/**
 * Has a clinician signed this stitched pattern, in this language, over the recordings that are in the manifest now?
 * If any of its fixed clips was re-recorded since, the sign-off no longer holds (fail closed).
 */
export function phraseSignedOff(manifest: Manifest, pattern: PhrasePattern, lang: Lang): boolean {
  const byId = new Map(manifest.clips.map((c) => [c.id, c]));
  return manifest.phrase_signoffs.some(
    (so) =>
      so.pattern === pattern &&
      so.lang === lang &&
      so.clips.every((c) => {
        const clip = byId.get(c.id);
        return clip !== undefined && clip.files[fileKeyFor(clip, lang)]?.sha256 === c.sha256;
      }),
  );
}

/**
 * Parse and check the manifest. Throws `ManifestError` listing every problem found. The check is strict about
 * the things that would let a wrong clip play, and says nothing about whether recordings exist yet.
 */
export function parseManifest(raw: unknown): Manifest {
  const problems: string[] = [];
  if (!isRecord(raw)) throw new ManifestError(["manifest is not an object"]);
  if (raw.schema_version !== 1) problems.push("schema_version must be 1");
  if (!Array.isArray(raw.clips)) throw new ManifestError([...problems, "clips must be an array"]);
  if (!isRecord(raw.groups)) problems.push("groups must be an object");
  const languages = raw.languages;
  if (!Array.isArray(languages) || languages.join() !== LANGS.join()) problems.push(`languages must be ${LANGS.join(", ")}`);
  if (!Array.isArray(raw.phrase_signoffs)) problems.push("phrase_signoffs must be an array");
  else for (const so of raw.phrase_signoffs as PhraseSignoff[]) checkSignoff(so, problems);

  const seen = new Set<string>();
  for (const c of raw.clips as ManifestClip[]) {
    const id = isRecord(c) && typeof c.id === "string" ? c.id : "?";
    if (!isRecord(c) || !ID.test(id)) {
      problems.push(`clip id ${id} is malformed`);
      continue;
    }
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);
    if (!BUNDLE_GROUPS.includes(c.bundle_group)) problems.push(`${id}: unknown bundle_group ${String(c.bundle_group)}`);
    if (!isRecord(c.files)) {
      problems.push(`${id}: files must be an object`);
      continue;
    }
    const keys = Object.keys(c.files).sort();
    const want = c.language_neutral ? ["shared"] : [...LANGS].sort();
    if (keys.join() !== want.join()) problems.push(`${id}: files must be ${want.join(", ")}`);
    for (const key of keys as FileKey[]) {
      const f = c.files[key];
      if (f) checkFile(c, key, f, problems);
    }
  }
  if (problems.length > 0) throw new ManifestError(problems);
  return raw as unknown as Manifest;
}

export interface Catalogue {
  readonly manifest: Manifest;
  get(id: string): ManifestClip | undefined;
}

export function createCatalogue(manifest: Manifest): Catalogue {
  const byId = new Map(manifest.clips.map((c) => [c.id, c]));
  return { manifest, get: (id) => byId.get(id) };
}
