/**
 * Care Circle presets (S69b). Two named groupings of the EXISTING Care Circle permissions, so a patient does not have to read five
 * tick-boxes: "Can see" and "Can see and help". There is no new role and no new permission name; a preset is only a shorthand for a
 * set of permissions the database already knows, and the database stays the one thing that enforces them.
 *
 *   Can see            = adherence_summary, weekly_bp_trend, appointments, red_alerts
 *   Can see and help   = the above plus pay_for_care (the supporter may also pay for care and take on the small shared tasks)
 *
 * `attend_consultation` (CGJ) is deliberately in neither preset: it is a separate, per-call invitation. A set that includes it, or any
 * other mix, is "custom".
 *
 * The plain-language preview is built from the permissions alone, so it can never promise more than the database will show: it takes
 * the real permission list (from an invite, or from what the patient has ticked) and returns codes the screens turn into words.
 */

export const CIRCLE_PRESET_IDS = ["see", "see_and_help"] as const;
export type CirclePresetId = (typeof CIRCLE_PRESET_IDS)[number];
export type CirclePresetChoice = CirclePresetId | "custom";

export const CIRCLE_PRESET_PERMISSIONS: Readonly<Record<CirclePresetId, readonly string[]>> = {
  see: ["adherence_summary", "weekly_bp_trend", "appointments", "red_alerts"],
  see_and_help: ["adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care"],
};

/** The permissions a preset stands for, as a fresh array. */
export function permissionsForPreset(id: CirclePresetId): string[] {
  return [...CIRCLE_PRESET_PERMISSIONS[id]];
}

/** Which preset these permissions are exactly (order does not matter), or "custom". An empty list is "custom". */
export function presetOfPermissions(perms: readonly string[]): CirclePresetChoice {
  const set = new Set(perms);
  if (set.size === 0 || set.size !== perms.length) return "custom";
  for (const id of CIRCLE_PRESET_IDS) {
    const want = CIRCLE_PRESET_PERMISSIONS[id];
    if (want.length === set.size && want.every((p) => set.has(p))) return id;
  }
  return "custom";
}

/** What the person is told they will get, as codes. `sees` and `can` come only from the permissions held. */
export interface CirclePreview {
  preset: CirclePresetChoice;
  sees: Array<"adherence" | "bp" | "appointments" | "digest">;
  can: Array<"alert" | "pay" | "tasks" | "call">;
}

export function previewForPermissions(perms: readonly string[]): CirclePreview {
  const has = (p: string) => perms.includes(p);
  const sees: CirclePreview["sees"] = [];
  if (has("adherence_summary")) sees.push("adherence");
  if (has("weekly_bp_trend")) sees.push("bp");
  if (has("appointments")) sees.push("appointments");
  // the weekly summary is built only from the three above, so it appears only when at least one is held
  if (sees.length > 0) sees.push("digest");
  const can: CirclePreview["can"] = [];
  if (has("red_alerts")) can.push("alert");
  if (has("pay_for_care")) can.push("pay", "tasks");
  if (has("attend_consultation")) can.push("call");
  return { preset: presetOfPermissions(perms), sees, can };
}

/** The permission a supporter in another organisation can never hold (money across organisations is a finance decision, S29e). */
export function withoutCrossOrganisation(perms: readonly string[]): string[] {
  return perms.filter((p) => p !== "pay_for_care");
}

/** The fixed list of shared-task kinds. There is no free text in a task, so nothing medical can be typed into one. */
export const CIRCLE_TASK_KINDS = ["take_to_appointment", "take_to_lab", "collect_medicines", "visit", "phone_call", "errand"] as const;
export type CircleTaskKind = (typeof CIRCLE_TASK_KINDS)[number];
