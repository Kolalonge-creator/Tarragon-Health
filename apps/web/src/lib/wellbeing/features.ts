/**
 * Which of the S56b wellbeing features are open for the signed-in patient. The type and the fail-closed reader live in @tarragon/shared so the
 * phone uses the same one; this file keeps the web import path.
 */
export { NO_WELLBEING_FEATURES, parseWellbeingFeatures, type WellbeingFeatures } from "@tarragon/shared";
