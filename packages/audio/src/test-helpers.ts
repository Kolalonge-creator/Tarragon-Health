import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "./manifest";
import { PATTERN_CLIPS, type PhrasePattern } from "./stitch";
import type { Approval, ClipFile, Lang, Manifest, ManifestClip } from "./types";

const here = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export const realManifestJson = (): unknown => JSON.parse(readFileSync(resolve(REPO_ROOT, "audio/manifest.json"), "utf8"));
export const realManifest = (): Manifest => parseManifest(realManifestJson());

export const SHA = "a".repeat(64);
const APPROVAL = (review: Approval["review"], sha: string): Approval => ({ review, by: "Test Reviewer", on: "2026-10-06", sha256: sha });

/** A copy of a clip with every file recorded and fully signed off: what a finished clip looks like. */
export function finished(clip: ManifestClip, sha = SHA): ManifestClip {
  const files: Record<string, ClipFile> = {};
  for (const [key, f] of Object.entries(clip.files)) {
    const reviews: Approval["review"][] = ["brand"];
    if (clip.clinical) reviews.push("clinical");
    if (clip.legal) reviews.push("legal");
    files[key] = { ...(f as ClipFile), sha256: sha, bytes: 12_345, duration_ms: 4_000, approvals: reviews.map((r) => APPROVAL(r, sha)) };
  }
  return { ...clip, files };
}

/** Clinician sign-offs for every stitched pattern in both languages, over the recordings the manifest has now. */
export function withPhraseSignoffs(m: Manifest): Manifest {
  const byId = new Map(m.clips.map((c) => [c.id, c]));
  const signoffs = (Object.keys(PATTERN_CLIPS) as PhrasePattern[]).flatMap((pattern) =>
    (["en"] as Lang[]).map((lang) => ({
      pattern,
      lang,
      by: "Test Clinician",
      on: "2026-10-06",
      clips: PATTERN_CLIPS[pattern].clips.map((id) => {
        const clip = byId.get(id)!;
        return { id, sha256: clip.files[clip.language_neutral ? "shared" : lang]?.sha256 ?? SHA };
      }),
    })),
  );
  return { ...m, phrase_signoffs: signoffs };
}

/** The real manifest with the named clips finished (and, when every clip is, every pattern signed). */
export function withFinished(ids: readonly string[] | "all"): Manifest {
  const m = realManifest();
  const set = ids === "all" ? null : new Set(ids);
  const done = { ...m, clips: m.clips.map((c) => (set === null || set.has(c.id) ? finished(c) : c)) };
  return ids === "all" ? withPhraseSignoffs(done) : done;
}
