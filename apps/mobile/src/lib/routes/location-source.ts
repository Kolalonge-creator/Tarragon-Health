import type { LocationSource } from "./route-recorder";

/**
 * The phone's location source for private route recording.
 *
 * NOT AVAILABLE YET: it needs the `expo-location` native module, which is not in apps/mobile/package.json. Adding it means a new EAS build, the
 * iOS `NSLocationWhenInUseUsageDescription` text and Android foreground-location permission, and a `runtimeVersion` bump (CLAUDE.md, mobile OTA
 * rule). Until then this returns null and the screen says recording needs a newer version of the app; nothing is recorded. When the module lands,
 * only this function changes: implement `LocationSource` with foreground updates (never background, never when the screen is closed).
 */
export function getLocationSource(): LocationSource | null {
  return null;
}
