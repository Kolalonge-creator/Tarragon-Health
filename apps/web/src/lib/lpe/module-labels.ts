import type { Database } from "@tarragon/shared";

/**
 * Patient-facing label per LPE module. Same five words as the marketing
 * site's pillars section (apps/web/src/app/(marketing)/_content/pillars.ts)
 * for one consistent vocabulary from homepage to dashboard — kept as a
 * separate copy rather than a cross-route-group import, since marketing's
 * `_content/` is scoped to the marketing route group.
 */
export const LPE_MODULE_LABEL: Record<Database["public"]["Enums"]["lpe_module"], string> = {
  diet: "Eat",
  activity: "Move",
  sleep: "Sleep",
  stress: "Relax",
  behaviour: "Follow through",
  // Added by 20260829222454_lpe_module_smoking.sql (spec §76.7, patient
  // dashboard "health goals") — a personalised goal a patient can set for
  // themselves via create_personalised_lifestyle_goal, not a clinical
  // Lifestyle Programme Engine phase-template module (see the Module type
  // in @tarragon/lifestyle-engine, deliberately still just the 5 above).
  smoking: "Quit smoking",
};
