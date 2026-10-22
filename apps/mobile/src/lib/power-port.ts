import { UNKNOWN_POWER, type PowerState } from "./power-rules";

/**
 * The port between the power rules and the phone (S06y). No module that is already installed in this
 * build exposes the battery level or the battery saver, so the default reader answers "unknown", and
 * unknown never defers anything (the app behaves exactly as it did before). When a native battery
 * module is added in a later build, one call to registerPowerReader at start-up turns the rules on;
 * nothing else changes. See docs/OPEN-QUESTIONS.md, OQ-S06Y-1.
 */
export type PowerReader = () => Promise<PowerState>;

let reader: PowerReader = async () => UNKNOWN_POWER;

export function registerPowerReader(next: PowerReader): void {
  reader = next;
}

/** Test seam. */
export function resetPowerPortForTests(): void {
  reader = async () => UNKNOWN_POWER;
}

/** Never throws: a reader that fails is "unknown", which defers nothing. */
export async function readPowerState(): Promise<PowerState> {
  try {
    return await reader();
  } catch {
    return UNKNOWN_POWER;
  }
}
