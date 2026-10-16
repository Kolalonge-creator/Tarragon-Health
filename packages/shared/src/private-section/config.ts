import { getProposedConfig } from "../proposed-config";
import type { PrivateLockConfig } from "./controller";

/**
 * The lock settings, read from versioned PROPOSED config `private_section.lock` (never typed into a screen). `onByDefault` is the founder
 * decision "optional but on by default"; the rest are product values awaiting the founder's confirmation.
 */
export function getPrivateLockConfig(asOf?: string): PrivateLockConfig {
  const v = getProposedConfig<{
    pin_min_digits: number;
    pin_max_digits: number;
    free_attempts: number;
    lockout_seconds: number[];
    relock_after_background_seconds: number;
    pbkdf2_iterations: number;
    on_by_default: boolean;
  }>("private_section.lock", asOf).value;
  return {
    pinMinDigits: v.pin_min_digits,
    pinMaxDigits: v.pin_max_digits,
    freeAttempts: v.free_attempts,
    lockoutSeconds: v.lockout_seconds,
    relockAfterBackgroundSeconds: v.relock_after_background_seconds,
    pbkdf2Iterations: v.pbkdf2_iterations,
    onByDefault: v.on_by_default,
  };
}
