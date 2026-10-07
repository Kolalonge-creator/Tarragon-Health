/**
 * Audio for Learning Centre items (S55, 9.1): a real play and stop control for an item's audio file.
 *
 * It is a PORT, like the course audio service in ./audio/service.ts: the native audio module (expo-audio) is a native
 * dependency, so adding it needs a new EAS build and a `runtimeVersion` bump (OQ-201), and no audio module is installed in
 * this app today. Until a build registers an engine here, the screen shows the written version and offers the file in the
 * phone's own browser or player. Nothing is lost and no crash is possible from a missing native module.
 *
 * To finish: add `expo-audio` to apps/mobile, bump `runtimeVersion`, run a new `eas build`, then in app start-up call
 * `registerContentAudioEngine({ play, stop })` backed by `createAudioPlayer`.
 */
export interface ContentAudioEngine {
  /** Resolves when playback ends, rejects if it cannot play. */
  play(url: string): Promise<void>;
  stop(): void;
}

let engine: ContentAudioEngine | null = null;

export function registerContentAudioEngine(e: ContentAudioEngine | null): void {
  engine = e;
}

export function getContentAudioEngine(): ContentAudioEngine | null {
  return engine;
}

/** Only https audio is played or opened: never a file:, javascript: or http: address from content. */
export function isPlayableAudioUrl(url: string | null | undefined): url is string {
  return typeof url === "string" && /^https:\/\/[^\s"'<>]+$/.test(url);
}
