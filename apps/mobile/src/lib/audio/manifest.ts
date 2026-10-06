import { createCatalogue, parseManifest, type Catalogue } from "@tarragon/audio";
import manifestJson from "../../../../../audio/manifest.json";
import { reportAudioIssue } from "./issues";

let cached: Catalogue | null | undefined;

/**
 * The manifest that ships in the app. Parsed once. A manifest that does not parse is reported and treated as
 * "no audio": the app keeps working with text only, because audio must never be the thing that fails.
 */
export function audioCatalogue(): Catalogue | null {
  if (cached !== undefined) return cached;
  try {
    cached = createCatalogue(parseManifest(manifestJson));
  } catch (e) {
    cached = null;
    reportAudioIssue({ code: "manifest_invalid", clipId: null, lang: null, detail: e instanceof Error ? e.message.slice(0, 200) : "unknown" });
  }
  return cached;
}

/** The clip id for a triage message code, or null when the manifest has no clip for it (for example EMG-001L). */
export function clipIdFor(code: string | null): string | null {
  if (code === null) return null;
  return audioCatalogue()?.get(code) ? code : null;
}

/** Test seam: forget the parsed manifest. */
export function resetAudioCatalogue(): void {
  cached = undefined;
}
