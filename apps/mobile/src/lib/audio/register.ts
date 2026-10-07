import { loadExpoAudioEngine } from "./expo-engine";
import { createDownloadedFiles } from "./file-store";
import { loadExpoFileSystem } from "./expo-files";
import { setAudioEngine } from "./service";

/**
 * Hook the phone's audio into the audio service. Safe to call at start-up: a missing native module leaves the
 * app text-only, and nothing here throws. Run once; calling it again re-registers.
 */
export function registerAudio(): void {
  try {
    const engine = loadExpoAudioEngine();
    const fs = loadExpoFileSystem();
    setAudioEngine(engine, fs ? createDownloadedFiles(fs) : undefined);
  } catch {
    setAudioEngine(null);
  }
}
