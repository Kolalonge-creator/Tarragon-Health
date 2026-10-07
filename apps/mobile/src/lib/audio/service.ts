import {
  phraseText,
  resolveClips,
  resolvePhrase,
  scriptText,
  type Catalogue,
  type ClipFile,
  type ClipLocator,
  type FileKey,
  type Lang,
  type Phrase,
  type PlayStep,
  type Playback,
  type ReportIssue,
} from "@tarragon/audio";
import { audioCatalogue } from "./manifest";
import { BUNDLED_AUDIO } from "./bundled-assets.generated";
import { reportAudioIssue } from "./issues";

/** Where a recording comes from on this phone. */
export type AudioSource = { readonly kind: "bundled"; readonly module: number } | { readonly kind: "file"; readonly uri: string };

/**
 * The part of the app that makes sound. It is a port because the native audio module is a native dependency that
 * needs a new build and a `runtimeVersion` bump (OQ-201); until one is registered, every request shows its text.
 * `play` resolves when the last source has finished, or rejects; `stop` ends whatever is playing at once.
 */
export interface AudioEngine {
  play(sources: readonly AudioSource[]): Promise<void>;
  stop(): void;
}

/** Recordings downloaded after sign-up, kept on the phone: file name and checksum to a local uri. */
export interface DownloadedFiles {
  uriFor(file: ClipFile): string | null;
}

export interface AudioServiceDeps {
  readonly catalogue: Catalogue | null;
  readonly engine: AudioEngine | null;
  readonly downloaded: DownloadedFiles;
  readonly bundled: Readonly<Record<string, number>>;
  readonly report: ReportIssue;
}

export interface Spoken {
  /** True when audio played to the end. */
  readonly played: boolean;
  /** Always set: show it, with the audio or instead of it. */
  readonly text: string;
  readonly lang: Lang;
}

export interface AudioService {
  /** Say these clips in order (one clip, or a fixed sequence). */
  playClips(clipIds: readonly string[], lang: Lang): Promise<Spoken>;
  /** Say a stitched reading. A null phrase (a value the kit cannot say) is text only by the caller; see `speakReading`. */
  playPhrase(phrase: Phrase, lang: Lang): Promise<Spoken>;
  /** Whether these clips would play right now: recorded, signed off, and an engine registered. Never reports an issue, so a screen can ask on every render. */
  canPlayClips(clipIds: readonly string[], lang: Lang): Promise<boolean>;
  /** Stop at once: on a language change, on leaving the screen, on a new request. */
  stop(): void;
}

const noDownloads: DownloadedFiles = { uriFor: () => null };

export function createAudioService(deps: AudioServiceDeps): AudioService {
  const { catalogue, engine } = deps;
  const sourceFor = (file: ClipFile): AudioSource | null => {
    const module = deps.bundled[file.file];
    if (module !== undefined) return { kind: "bundled", module };
    const uri = deps.downloaded.uriFor(file);
    return uri === null ? null : { kind: "file", uri };
  };
  const locator: ClipLocator = { has: (_id, _key: FileKey, file) => sourceFor(file) !== null };

  async function run(resolve: (c: Catalogue) => Promise<Playback>, textOnly: () => string, lang: Lang): Promise<Spoken> {
    if (!catalogue) return { played: false, text: textOnly(), lang };
    const plan = await resolve(catalogue);
    if (!plan.complete) return { played: false, text: plan.text, lang };
    if (!engine) {
      deps.report({ code: "engine_unavailable", clipId: plan.steps[0]?.clipId ?? null, lang: plan.lang });
      return { played: false, text: plan.text, lang: plan.lang };
    }
    engine.stop();
    const sources = plan.steps.map((s: PlayStep) => sourceFor(s.file)).filter((s): s is AudioSource => s !== null);
    try {
      await engine.play(sources);
      return { played: true, text: plan.text, lang: plan.lang };
    } catch (e) {
      deps.report({ code: "clip_file_missing", clipId: plan.steps[0]?.clipId ?? null, lang: plan.lang, detail: e instanceof Error ? e.message.slice(0, 120) : "playback failed" });
      return { played: false, text: plan.text, lang: plan.lang };
    }
  }

  const rd = (c: Catalogue) => ({ catalogue: c, locator, script: scriptText, report: deps.report });
  return {
    playClips: (ids, lang) =>
      run((c) => resolveClips(ids, lang, rd(c)), () => ids.map((id) => scriptText(id, lang)).join(" "), lang),
    playPhrase: (phrase, lang) =>
      run((c) => resolvePhrase(phrase, lang, rd(c)), () => phraseText(phrase, lang, scriptText), lang),
    canPlayClips: async (ids, lang) => {
      if (!catalogue || !engine) return false;
      const quiet = { catalogue, locator, script: scriptText, report: () => {} };
      return (await resolveClips(ids, lang, quiet)).complete;
    },
    stop: () => engine?.stop(),
  };
}

let engine: AudioEngine | null = null;
let downloaded: DownloadedFiles = noDownloads;
let service: AudioService | null = null;

/** The native adapter registers itself here once the audio module ships. Resets the service so it sees the engine. */
export function setAudioEngine(next: AudioEngine | null, files: DownloadedFiles = noDownloads): void {
  engine = next;
  downloaded = files;
  service = null;
}

export function getAudioService(): AudioService {
  service ??= createAudioService({ catalogue: audioCatalogue(), engine, downloaded, bundled: BUNDLED_AUDIO, report: reportAudioIssue });
  return service;
}
