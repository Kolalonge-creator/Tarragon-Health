import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseManifest } from "./manifest";
import type { Approval, ClipFile, Manifest, ManifestClip } from "./types";

const here = fileURLToPath(new URL(".", import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

export const realManifestJson = (): unknown => JSON.parse(readFileSync(resolve(REPO_ROOT, "audio/manifest.json"), "utf8"));
export const realManifest = (): Manifest => parseManifest(realManifestJson());

export const SHA = "a".repeat(64);
const APPROVAL = (review: Approval["review"]): Approval => ({ review, by: "Test Reviewer", on: "2026-10-06" });

/** A copy of a clip with every file recorded and fully signed off: what a finished clip looks like. */
export function finished(clip: ManifestClip, sha = SHA): ManifestClip {
  const files: Record<string, ClipFile> = {};
  for (const [key, f] of Object.entries(clip.files)) {
    const reviews: Approval["review"][] = ["brand"];
    if (clip.clinical) reviews.push("clinical");
    if (clip.legal) reviews.push("legal");
    if (key === "pcm") reviews.push("native_pidgin");
    files[key] = { ...(f as ClipFile), sha256: sha, bytes: 12_345, duration_ms: 4_000, approvals: reviews.map(APPROVAL) };
  }
  // A held Pidgin clip counts as finished only once its Pidgin has been released (signed and natively reviewed).
  return { ...clip, files, pcm_text: clip.pcm_text === "held_as_english" ? "reviewed" : clip.pcm_text };
}

/** The real manifest with the named clips finished. Everything else stays "not recorded". */
export function withFinished(ids: readonly string[] | "all"): Manifest {
  const m = realManifest();
  const set = ids === "all" ? null : new Set(ids);
  return { ...m, clips: m.clips.map((c) => (set === null || set.has(c.id) ? finished(c) : c)) };
}
