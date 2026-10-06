import { parseManifest } from "./manifest";
import type { BundleGroup, ClipFile, FileKey, Lang, Manifest, ManifestClip } from "./types";

/** Features that decide whether a conditional group ships. SYM only ships when the symptom checker is switched on (spec 8.8). */
export interface BundleFeatures {
  readonly symptomChecker: boolean;
}

export interface FileRef {
  readonly clipId: string;
  readonly group: string;
  readonly key: FileKey;
  readonly file: ClipFile;
}

const CONDITIONAL_GROUPS: Readonly<Record<string, keyof BundleFeatures>> = { SYM: "symptomChecker" };

function inScope(clip: ManifestClip, features: BundleFeatures): boolean {
  const feature = CONDITIONAL_GROUPS[clip.group];
  return feature === undefined || features[feature];
}

/** Every file of a bundle group (both languages), for the build to copy into the app. */
export function filesInGroup(manifest: Manifest, bundleGroup: BundleGroup, features: BundleFeatures): FileRef[] {
  const out: FileRef[] = [];
  for (const clip of manifest.clips) {
    if (clip.bundle_group !== bundleGroup || !inScope(clip, features)) continue;
    for (const key of Object.keys(clip.files) as FileKey[]) {
      const file = clip.files[key];
      if (file) out.push({ clipId: clip.id, group: clip.group, key, file });
    }
  }
  return out;
}

export interface BundleReport {
  readonly clips: number;
  readonly files: number;
  readonly recorded: number;
  readonly pendingRecording: number;
  /** Bytes of recordings that exist. Pending files count nothing until they are recorded. */
  readonly bytes: number;
  readonly byGroup: Readonly<Record<string, { files: number; recorded: number; bytes: number }>>;
}

/** What the app would ship today, and what is still not recorded. The size half of the app-size budget (S34 owns the rest). */
export function bundleReport(manifest: Manifest, features: BundleFeatures): BundleReport {
  const refs = filesInGroup(manifest, "bundled", features);
  const byGroup: Record<string, { files: number; recorded: number; bytes: number }> = {};
  let recorded = 0;
  let bytes = 0;
  for (const r of refs) {
    const g = (byGroup[r.group] ??= { files: 0, recorded: 0, bytes: 0 });
    g.files += 1;
    if (r.file.bytes !== null) {
      g.recorded += 1;
      g.bytes += r.file.bytes;
      recorded += 1;
      bytes += r.file.bytes;
    }
  }
  return { clips: new Set(refs.map((r) => r.clipId)).size, files: refs.length, recorded, pendingRecording: refs.length - recorded, bytes, byGroup };
}

export interface DownloadContext {
  readonly lang: Lang;
  /** Signed-up users only: post-sign-up audio is for people with an account. */
  readonly signedUp: boolean;
  readonly onWifi: boolean;
  /** Low-data mode (spec D.1): no automatic audio downloads at all. */
  readonly lowData: boolean;
  /** Files already on the phone, by file name and checksum. */
  readonly have: ReadonlySet<string>;
}

export const haveKey = (file: ClipFile): string => `${file.file}:${file.sha256 ?? ""}`;

/**
 * The files to fetch after sign-up: recorded `post_signup` files in the person's language (and the shared ones),
 * on Wi-Fi, never in low-data mode. `on_demand` clips are never fetched ahead; they download when first played.
 */
export function planDownloads(manifest: Manifest, ctx: DownloadContext, features: BundleFeatures): FileRef[] {
  if (!ctx.signedUp || !ctx.onWifi || ctx.lowData) return [];
  return filesInGroup(manifest, "post_signup", features).filter(
    (r) => r.file.sha256 !== null && (r.key === "shared" || r.key === ctx.lang) && !ctx.have.has(haveKey(r.file)),
  );
}

/** Where a downloaded recording lives. The checksum is in the path, so a re-recorded clip never serves a stale file. */
export function fileUrl(baseUrl: string, file: ClipFile): string | null {
  if (file.sha256 === null) return null;
  let end = baseUrl.length;
  while (end > 0 && baseUrl.charCodeAt(end - 1) === 47) end -= 1; // trailing slashes, without a backtracking regex
  return `${baseUrl.slice(0, end)}/${file.sha256.slice(0, 16)}/${file.file}`;
}

export interface RecordedFacts {
  readonly sha256: string;
  readonly bytes: number;
  readonly durationMs: number | null;
}

/**
 * Record that a master now exists for a file name. A different recording replaces the current one: the old one,
 * with its sign-offs, moves to `history` (so it can be restored), and the new one starts with no sign-offs because
 * a different recording is a different thing to sign. Unknown file names return `null`.
 */
export function applyRecording(manifest: Manifest, fileName: string, facts: RecordedFacts): Manifest | null {
  let found = false;
  const clips = manifest.clips.map((clip) => {
    for (const key of Object.keys(clip.files) as FileKey[]) {
      const f = clip.files[key];
      if (f?.file !== fileName) continue;
      found = true;
      const changed = f.sha256 !== facts.sha256;
      const history = changed && f.sha256 !== null && f.bytes !== null ? [{ sha256: f.sha256, bytes: f.bytes, duration_ms: f.duration_ms, approvals: f.approvals }, ...f.history] : f.history;
      const next: ClipFile = {
        ...f,
        sha256: facts.sha256,
        bytes: facts.bytes,
        duration_ms: facts.durationMs ?? (changed ? null : f.duration_ms),
        approvals: changed ? [] : f.approvals,
        history,
      };
      return { ...clip, files: { ...clip.files, [key]: next } };
    }
    return clip;
  });
  return found ? parseManifest({ ...manifest, clips }) : null;
}

/** Make an earlier recording current again, with the sign-offs it had. The one it replaces goes to history. */
export function rollbackRecording(manifest: Manifest, fileName: string, sha256: string): Manifest | null {
  let found = false;
  const clips = manifest.clips.map((clip) => {
    for (const key of Object.keys(clip.files) as FileKey[]) {
      const f = clip.files[key];
      if (f?.file !== fileName) continue;
      const target = f.history.find((h) => h.sha256 === sha256);
      if (!target || f.sha256 === null || f.bytes === null) return clip;
      found = true;
      const current = { sha256: f.sha256, bytes: f.bytes, duration_ms: f.duration_ms, approvals: f.approvals };
      const next: ClipFile = { ...f, sha256: target.sha256, bytes: target.bytes, duration_ms: target.duration_ms, approvals: target.approvals, history: [current, ...f.history.filter((h) => h !== target)] };
      return { ...clip, files: { ...clip.files, [key]: next } };
    }
    return clip;
  });
  return found ? parseManifest({ ...manifest, clips }) : null;
}

export interface ProjectionParams {
  readonly bitrateKbps: number;
  readonly charsPerMinute: number;
  /** Seconds for a clip with no script (a whole number said alone). */
  readonly numberClipSeconds: number;
}

/**
 * What the bundled audio will weigh once everything is recorded: real bytes for what exists, an estimate from the
 * script length for what does not. The estimate errs high on purpose (48 kbps, the top of the list's range).
 */
export function projectedBundleBytes(manifest: Manifest, features: BundleFeatures, script: (clipId: string, lang: Lang) => string, p: ProjectionParams): number {
  let total = 0;
  for (const r of filesInGroup(manifest, "bundled", features)) {
    if (r.file.bytes !== null) {
      total += r.file.bytes;
      continue;
    }
    const chars = r.key === "shared" ? 0 : script(r.clipId, r.key).length;
    const seconds = chars === 0 ? p.numberClipSeconds : (chars / p.charsPerMinute) * 60;
    total += Math.ceil((seconds * p.bitrateKbps * 1000) / 8);
  }
  return total;
}
