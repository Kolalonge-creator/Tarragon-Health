import { GLUCOSE_THRESHOLDS, GLUCOSE_THRESHOLDS_VERSION } from "./glucose-red-flags";
import { BP_THRESHOLDS, BP_THRESHOLDS_VERSION } from "../rules/bp-classification";

/**
 * Aggregates the two threshold sources the mobile app's bundled offline
 * classifier (apps/mobile/src/lib/{glucose-red-flags,bp-classification}.ts)
 * needs to stay in lock-step with, for /api/mobile/vitals-thresholds.
 *
 * MOBILE_THRESHOLDS_VERSION is a single combined version the phone compares
 * against its own bundled default — bump it any time either source file's
 * exported *_VERSION changes, so a stale build re-fetches promptly.
 */
export const MOBILE_THRESHOLDS_VERSION = `glucose:${GLUCOSE_THRESHOLDS_VERSION}|bp:${BP_THRESHOLDS_VERSION}`;

export function getMobileThresholds() {
  return {
    version: MOBILE_THRESHOLDS_VERSION,
    glucose: GLUCOSE_THRESHOLDS,
    bp: BP_THRESHOLDS,
  };
}
