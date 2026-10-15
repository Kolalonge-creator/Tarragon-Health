import { FERTILE_WINDOW_LABEL } from "@tarragon/i18n";
import { THERMAL_SHIFT_EXPLAINER } from "@tarragon/shared";

/** S66: moved to packages/shared/src/cycle/thermal-shift.ts (one copy for web and mobile). Re-export, plus the disclaimer, which needs the i18n label. */
export { THERMAL_SHIFT_EXPLAINER, describeThermalShift, detectThermalShift } from "@tarragon/shared";
export type { BasalTemperatureReading as TemperatureReading, ThermalShiftResult } from "@tarragon/shared";

/** S85 D2 / OQ-12: wherever a temperature-based confirmation is shown it carries the label; the text comes from the one wording source. */
export const THERMAL_SHIFT_DISCLAIMER = `${THERMAL_SHIFT_EXPLAINER} ${FERTILE_WINDOW_LABEL}`;
