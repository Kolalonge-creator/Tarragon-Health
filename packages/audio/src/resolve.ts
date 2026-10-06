import { playable, type Catalogue } from "./manifest";
import type { Phrase } from "./stitch";
import type { AudioIssue, ClipFile, FileKey, Lang, ReportIssue } from "./types";

/** What the device can say about a recording: is a file with this checksum on the phone, from where? */
export interface ClipLocator {
  /** True when the exact recording (same file name and checksum) is on the phone, bundled or downloaded. */
  has(clipId: string, key: FileKey, file: ClipFile): boolean | Promise<boolean>;
}

export interface PlayStep {
  readonly clipId: string;
  readonly key: FileKey;
  readonly file: ClipFile;
}

export interface Playback {
  /** True only when EVERY clip of the request can play. A phrase is never played in part. */
  readonly complete: boolean;
  /** The language the audio is in (it can differ from the one asked for: see `resolveClips`). */
  readonly lang: Lang;
  readonly steps: readonly PlayStep[];
  /** The words to show, always: with the audio when it plays, instead of it when it cannot. */
  readonly text: string;
}

export interface ResolveDeps {
  readonly catalogue: Catalogue;
  readonly locator: ClipLocator;
  /** The words of a clip in a language (`@tarragon/i18n` AUDIO_SCRIPTS). */
  readonly script: (clipId: string, lang: Lang) => string;
  readonly report: ReportIssue;
}

/** Digits and sentence parts, joined. A step with `tight` attaches to the one before it. */
export function phraseText(phrase: Phrase, lang: Lang, script: ResolveDeps["script"]): string {
  let out = "";
  for (const step of phrase.steps) {
    const part = step.literal ?? script(step.id, lang);
    out += out === "" || step.tight ? part : ` ${part}`;
  }
  return out;
}

async function tryLang(clipIds: readonly string[], lang: Lang, deps: ResolveDeps, report: ReportIssue): Promise<PlayStep[] | null> {
  const steps: PlayStep[] = [];
  for (const id of clipIds) {
    const clip = deps.catalogue.get(id);
    if (!clip) {
      report({ code: "clip_unknown", clipId: id, lang });
      return null;
    }
    const p = playable(clip, lang);
    if (!p.ok) {
      report({ code: p.reason === "no_recording" ? "clip_not_recorded" : "clip_awaiting_review", clipId: id, lang });
      return null;
    }
    if (!(await deps.locator.has(id, p.key, p.file))) {
      report({ code: "clip_file_missing", clipId: id, lang, detail: p.file.file });
      return null;
    }
    steps.push({ clipId: id, key: p.key, file: p.file });
  }
  return steps;
}

/**
 * Decide what to play for a list of clips, in order.
 *
 * - All or nothing. If any clip cannot play, none do and the text is shown, because half of a spoken reading
 *   ("your blood pressure reading is ... over 94") is worse than none.
 * - A Pidgin request falls back to English audio only when every clip's Pidgin text is held as English (OQ-19):
 *   the screen then already shows English words, so the voice says what the screen says. Never the other way.
 * - Problems are reported as non-fatal issues and never thrown (spec 8.8).
 */
export async function resolveClips(clipIds: readonly string[], lang: Lang, deps: ResolveDeps): Promise<Playback> {
  const text = (l: Lang) => clipIds.map((id) => deps.script(id, l)).join(" ");
  return resolveWith(clipIds, lang, deps, text);
}

export async function resolvePhrase(phrase: Phrase, lang: Lang, deps: ResolveDeps): Promise<Playback> {
  return resolveWith(
    phrase.steps.map((s) => s.id),
    lang,
    deps,
    (l) => phraseText(phrase, l, deps.script),
  );
}

async function resolveWith(ids: readonly string[], lang: Lang, deps: ResolveDeps, text: (l: Lang) => string): Promise<Playback> {
  const issues: AudioIssue[] = [];
  const collect: ReportIssue = (i) => issues.push(i);
  const flush = () => issues.forEach((i) => deps.report(i));

  const first = await tryLang(ids, lang, deps, collect);
  if (first) return { complete: true, lang, steps: first, text: text(lang) };

  if (lang === "pcm" && ids.every((id) => deps.catalogue.get(id)?.pcm_text !== "reviewed" && deps.catalogue.get(id)?.pcm_text !== "needs_native_review")) {
    // Every clip's Pidgin is held as English (or neutral), so English audio matches the text on screen.
    const fallback = await tryLang(ids, "en", deps, () => {});
    if (fallback) return { complete: true, lang: "en", steps: fallback, text: text("en") };
  }
  flush();
  return { complete: false, lang, steps: [], text: text(lang) };
}
