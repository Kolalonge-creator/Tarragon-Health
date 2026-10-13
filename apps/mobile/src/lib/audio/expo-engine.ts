import { AudioStopped, type AudioEngine, type AudioSource, type PlayOptions } from "./service";

/** The slice of `expo-audio` this adapter uses, so tests can stand in for the native module. */
export interface ExpoAudioModule {
  createAudioPlayer(source: number | { uri: string }): ExpoPlayer;
  setAudioModeAsync(mode: {
    playsInSilentMode: boolean;
    interruptionMode: "doNotMix" | "duckOthers" | "mixWithOthers";
    allowsRecording: boolean;
    shouldPlayInBackground: boolean;
    shouldRouteThroughEarpiece: boolean;
  }): Promise<void>;
}

export interface ExpoPlayer {
  play(): void;
  remove(): void;
  addListener(event: "playbackStatusUpdate", listener: (status: { didJustFinish: boolean }) => void): { remove(): void };
}

/** A clip that has not finished this long after its recorded length (or this long, with no length) is treated as stalled. */
export const STALL_GRACE_MS = 5_000;
export const DEFAULT_CLIP_MS = 60_000;

const IDLE_MODE = { playsInSilentMode: false, interruptionMode: "mixWithOthers", allowsRecording: false, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false } as const;

/**
 * Plays clips one after another with `expo-audio`.
 *
 * - Emergency messages play with the ringer off (`playsInSilentMode`) and take audio focus (`doNotMix`); other
 *   clips respect silent mode and duck other apps.
 * - No lock-screen controls are registered and nothing plays in the background, so a clinical clip never shows on
 *   a locked screen.
 * - A phone call (or anything else that takes the audio) pauses the player; the clip never reaches its end, so the
 *   stall timer rejects and the caller shows the text. It does not resume on its own: a half-heard emergency
 *   message resuming minutes later would be worse than the text.
 */
export function createExpoAudioEngine(mod: ExpoAudioModule): AudioEngine {
  let current: { player: ExpoPlayer; abort: () => void } | null = null;
  let generation = 0;

  const playOne = (source: AudioSource): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      const player = mod.createAudioPlayer(source.kind === "bundled" ? source.module : { uri: source.uri });
      const live: { timer?: ReturnType<typeof setTimeout>; sub?: { remove(): void } } = {};
      const done = (fn: () => void) => {
        if (live.timer) clearTimeout(live.timer);
        live.sub?.remove();
        player.remove();
        if (current?.player === player) current = null;
        fn();
      };
      current = { player, abort: () => done(() => reject(new AudioStopped())) };
      live.sub = player.addListener("playbackStatusUpdate", (status) => {
        if (status.didJustFinish) done(resolve);
      });
      live.timer = setTimeout(() => done(() => reject(new Error("playback stalled"))), (source.durationMs ?? DEFAULT_CLIP_MS) + STALL_GRACE_MS);
      try {
        player.play();
      } catch (e) {
        done(() => reject(e instanceof Error ? e : new Error("play failed")));
      }
    });

  return {
    async play(sources, options: PlayOptions) {
      const mine = ++generation;
      await mod.setAudioModeAsync({
        playsInSilentMode: options.emergency,
        interruptionMode: options.emergency ? "doNotMix" : "duckOthers",
        allowsRecording: false,
        shouldPlayInBackground: false,
        shouldRouteThroughEarpiece: false,
      });
      try {
        for (const source of sources) {
          if (mine !== generation) throw new AudioStopped(); // stop() came between two clips
          await playOne(source);
        }
        if (mine !== generation) throw new AudioStopped();
      } finally {
        // Give audio focus back (other apps resume) and stop forcing playback past the ringer switch.
        if (mine === generation) await mod.setAudioModeAsync(IDLE_MODE).catch(() => undefined);
      }
    },
    stop() {
      generation += 1;
      current?.abort();
    },
  };
}

/**
 * The real module, loaded lazily. A phone whose binary lacks the native module (Expo Go, an old development build)
 * gets `null` and the app stays text-only, because a native import that throws must never take the app down.
 */
export function loadExpoAudioEngine(): AudioEngine | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return createExpoAudioEngine(require("expo-audio") as ExpoAudioModule);
  } catch {
    return null;
  }
}
