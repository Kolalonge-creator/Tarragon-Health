import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function sql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s70a_device_core.sql"));
  if (!file) throw new Error("S70a device core migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

/** The device_config seed rows, keyed by `key`. Each is `('devices.x', 1, $json$ ... $json$::jsonb, ...)`. */
function seeds(): Map<string, unknown> {
  const block = /device-config-begin([\s\S]*?)device-config-end/.exec(sql())?.[1];
  if (!block) throw new Error("device-config seed block not found");
  const out = new Map<string, unknown>();
  for (const m of block.matchAll(/\('(devices\.[a-z_]+)', 1, \$json\$([\s\S]*?)\$json\$::jsonb/g)) {
    out.set(m[1] as string, JSON.parse(m[2] as string));
  }
  return out;
}

describe("devices.* mirrors the device_config seed", () => {
  const rows = seeds();
  it("seeds exactly the four config keys", () => {
    expect([...rows.keys()].sort()).toEqual(["devices.cgm_events", "devices.dedupe", "devices.ecg_alert", "devices.plausibility"]);
  });
  it.each(["devices.plausibility", "devices.dedupe", "devices.cgm_events", "devices.ecg_alert"])("%s is identical in the registry and the migration", (key) => {
    expect(rows.get(key)).toEqual(getProposedConfig(key).value);
  });
  it("every one of them is still proposed, owned by the CMO, and none is signed", () => {
    for (const key of rows.keys()) {
      const r = getProposedConfig(key);
      expect(r.status).toBe("proposed");
      expect(r.owner).toBe("CMO");
    }
  });
  it("devices.task_types is identical to the task_types seed, row by row", () => {
    const block = /device-task-types-begin([\s\S]*?)device-task-types-end/.exec(sql())?.[1];
    if (!block) throw new Error("task types seed not found");
    const re = /\('([a-z_]+)', (\d+), (\d+), (\d+), '([a-z_]+)', '\{([^}]*)\}', (\d+), (\d+), (true|false), (true|false), '\{([^}]*)\}'/g;
    const seeded = [...block.matchAll(re)].map((m) => ({
      code: m[1],
      priority_class: Number(m[3]),
      default_due_minutes: Number(m[4]),
      min_doctor_tier: m[5],
      required_competencies: (m[6] ?? "").length ? (m[6] as string).split(",") : [],
      lead_window_minutes: Number(m[7]),
      claim_timeout_minutes: Number(m[8]),
    }));
    expect(seeded).toHaveLength(2);
    expect(seeded).toEqual(getProposedConfig("devices.task_types").value);
  });
  it("the recorded decisions hold: windows BP 10 and glucose 5, CGM rules, one working day, fixed patient sentence", () => {
    const d = getProposedConfig("devices.dedupe").value as { window_minutes: Record<string, number> };
    expect(d.window_minutes.blood_pressure).toBe(10);
    expect(d.window_minutes.glucose).toBe(5);
    const c = getProposedConfig("devices.cgm_events").value as { rules: { code: string; below_mmol_l?: number; above_mmol_l?: number; minutes: number }[] };
    expect(c.rules.map((r) => [r.code, r.below_mmol_l ?? r.above_mmol_l, r.minutes])).toEqual([["low_severe", 3.0, 15], ["low", 3.9, 60], ["high", 13.9, 120]]);
    const e = getProposedConfig("devices.ecg_alert").value as { due_minutes: number; patient_copy: string };
    expect(e.due_minutes).toBe(1440);
    expect(e.patient_copy).toBe("Your device flagged something for your care team to look at.");
  });
  it("the patient copy and severe-low copy name no condition in the notice templates (INV-07)", () => {
    const body = sql();
    for (const tpl of ["device_flag_notice", "device_safety_notice"]) {
      const m = new RegExp(`\\('${tpl}', 'en', 'in_app', '([^']*)', '([^']*)'\\)`).exec(body);
      expect(m).not.toBeNull();
      expect(`${m?.[1]} ${m?.[2]}`).not.toMatch(/fibrillation|arrhythm|irregular|heart|glucose|sugar|diabet|hypo|hyper|blood pressure|mmol|bpm|ecg|afib/i);
    }
  });
});
