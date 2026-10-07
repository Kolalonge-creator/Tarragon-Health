import { phraseSignedOff, playable, type Catalogue } from "./manifest";
import { PATTERN_CLIPS, type Phrase } from "./stitch";
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
 * - Problems are reported as non-fatal issues and never thrown (spec 8.8).
 */
export async function resolveClips(clipIds: readonly string[], lang: Lang, deps: ResolveDeps): Promise<Playback> {
  const text = (l: Lang) => clipIds.map((id) => deps.script(id, l)).join(" ");
  return resolveWith(clipIds, lang, deps, text);
}

export async function resolvePhrase(phrase: Phrase, lang: Lang, deps: ResolveDeps): Promise<Playback> {
  const text = (l: Lang) => phraseText(phrase, l, deps.script);
  // A clinical reading is never spoken without its triage sentence.
  if (PATTERN_CLIPS[phrase.pattern].needsSeverity && !phrase.severity) {
    deps.report({ code: "phrase_missing_severity", clipId: null, lang, detail: phrase.pattern });
    return { complete: false, lang, steps: [], text: text(lang) };
  }
  // ...and a pattern plays only once a clinician has signed the whole phrase over these exact recordings.
  const gate = (l: Lang): AudioIssue | null =>
    phraseSignedOff(deps.catalogue.manifest, phrase.pattern, l) ? null : { code: "phrase_not_signed", clipId: null, lang: l, detail: phrase.pattern };
  return resolveWith(
    phrase.steps.map((s) => s.id),
    lang,
    deps,
    text,
    gate,
  );
}

async function resolveWith(ids: readonly string[], lang: Lang, deps: ResolveDeps, text: (l: Lang) => string, gate?: (l: Lang) => AudioIssue | null): Promise<Playback> {
  const issues: AudioIssue[] = [];
  const collect: ReportIssue = (i) => issues.push(i);
  const flush = () => issues.forEach((i) => deps.report(i));

  const blocked = gate?.(lang) ?? null;
  if (blocked) collect(blocked);
  const first = blocked ? null : await tryLang(ids, lang, deps, collect);
  if (first) return { complete: true, lang, steps: first, text: text(lang) };

  flush();
  return { complete: false, lang, steps: [], text: text(lang) };
}
