/**
 * The doses-taken history now lives in @tarragon/medicines (dose-history.ts), so the phone app uses the same formula and the
 * same completed-Lagos-days rule. This path stays so existing imports keep working.
 */
export { buildDoseHistory, type DoseDay, type DoseHistory, type DoseWindow } from "@tarragon/medicines";
