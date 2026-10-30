import { describe, expect, it } from "@jest/globals";
import {
  CIRCLE_PRESET_IDS, CIRCLE_PRESET_PERMISSIONS, CIRCLE_TASK_KINDS, permissionsForPreset, presetOfPermissions, previewForPermissions, withoutCrossOrganisation,
} from "./care-circle-presets";

// The names the database check accepts today (private.circle_permissions_valid): the five of S29 plus CGJ's attend_consultation.
const DATABASE_PERMISSIONS = ["adherence_summary", "weekly_bp_trend", "appointments", "red_alerts", "pay_for_care", "attend_consultation"];

describe("Care Circle presets (S69b)", () => {
  it("maps onto permissions the database already knows, and adds no new name", () => {
    for (const id of CIRCLE_PRESET_IDS) {
      for (const p of CIRCLE_PRESET_PERMISSIONS[id]) expect(DATABASE_PERMISSIONS).toContain(p);
    }
  });

  it("'Can see and help' is 'Can see' plus the right to pay and help, nothing else", () => {
    expect(CIRCLE_PRESET_PERMISSIONS.see_and_help.filter((p) => !CIRCLE_PRESET_PERMISSIONS.see.includes(p))).toEqual(["pay_for_care"]);
    expect(CIRCLE_PRESET_PERMISSIONS.see).not.toContain("pay_for_care");
  });

  it("neither preset includes the per-call consultation permission", () => {
    for (const id of CIRCLE_PRESET_IDS) expect(CIRCLE_PRESET_PERMISSIONS[id]).not.toContain("attend_consultation");
  });

  it("recognises a preset in any order, and anything else is custom", () => {
    expect(presetOfPermissions(permissionsForPreset("see").reverse())).toBe("see");
    expect(presetOfPermissions(permissionsForPreset("see_and_help"))).toBe("see_and_help");
    expect(presetOfPermissions([])).toBe("custom");
    expect(presetOfPermissions(["red_alerts"])).toBe("custom");
    expect(presetOfPermissions([...permissionsForPreset("see"), "attend_consultation"])).toBe("custom");
    expect(presetOfPermissions([...permissionsForPreset("see"), "red_alerts"])).toBe("custom");
  });

  it("permissionsForPreset returns a copy, so a screen cannot change the preset", () => {
    const a = permissionsForPreset("see");
    a.push("pay_for_care");
    expect(permissionsForPreset("see")).not.toContain("pay_for_care");
  });

  it("the preview says only what the permissions allow", () => {
    expect(previewForPermissions(["red_alerts"])).toEqual({ preset: "custom", sees: [], can: ["alert"] });
    const see = previewForPermissions(permissionsForPreset("see"));
    expect(see.sees).toEqual(["adherence", "bp", "appointments", "digest"]);
    expect(see.can).toEqual(["alert"]);
    const help = previewForPermissions(permissionsForPreset("see_and_help"));
    expect(help.can).toEqual(["alert", "pay", "tasks"]);
    // no view permission means no weekly summary
    expect(previewForPermissions(["pay_for_care"]).sees).toEqual([]);
  });

  it("a supporter in another organisation gets 'Can see' in effect, with no payment and no tasks", () => {
    const perms = withoutCrossOrganisation(permissionsForPreset("see_and_help"));
    expect(perms).toEqual(permissionsForPreset("see"));
    expect(previewForPermissions(perms).can).toEqual(["alert"]);
  });

  it("task kinds are a fixed list with no free text", () => {
    expect(CIRCLE_TASK_KINDS).toEqual(["take_to_appointment", "take_to_lab", "collect_medicines", "visit", "phone_call", "errand"]);
  });
});
