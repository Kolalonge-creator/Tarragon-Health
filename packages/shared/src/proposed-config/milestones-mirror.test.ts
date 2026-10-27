import { describe, expect, it } from "@jest/globals";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s58b_pending_credit_milestones_refund_restore.sql"));
if (!file) throw new Error("S58b migration not found");
const sql = readFileSync(join(MIGRATIONS, file), "utf8");

function configSeed(key: string): unknown {
  const m = new RegExp(`\\('${key}', 1, \\$json\\$(.*?)\\$json\\$::jsonb`, "s").exec(sql);
  if (!m?.[1]) throw new Error(`reward_config seed ${key} not found`);
  return JSON.parse(m[1]);
}
function milestoneSeed(): Array<Record<string, unknown>> {
  const m = /rewards-milestones-begin[\s\S]*?\$json\$(\[[\s\S]*?\])\$json\$/.exec(sql);
  if (!m?.[1]) throw new Error("milestone seed not found");
  return JSON.parse(m[1]) as Array<Record<string, unknown>>;
}

describe("rewards.pending_credit, milestone_display and milestones mirror the S58b seeds", () => {
  it("pending_credit", () => expect(configSeed("pending_credit")).toEqual(getProposedConfig("rewards.pending_credit").value));
  it("milestone_display", () => expect(configSeed("milestone_display")).toEqual(getProposedConfig("rewards.milestone_display").value));

  it("milestones (without the admin-facing description)", () => {
    const seeded = milestoneSeed().map((r) => {
      const { description: _d, ...rest } = r;
      return rest;
    });
    expect(seeded).toEqual(getProposedConfig("rewards.milestones").value);
  });

  it("every value is proposed and unsigned", () => {
    for (const k of ["pending_credit", "milestone_display", "milestones"]) expect(getProposedConfig(`rewards.${k}`).status).toBe("proposed");
  });

  it("no milestone references weight, BMI or any body metric, in code, trigger event or params", () => {
    const body = /(^|[^a-z])(weight|bmi|waist|hip|hips|obes[a-z]*|calor[a-z]*|kcal|kg|lbs|pounds|slim|lean|body|fat|size|shape|thin|inches)([^a-z]|$)/i;
    for (const r of getProposedConfig("rewards.milestones").value as Array<Record<string, unknown>>) {
      expect(String(r.code)).not.toMatch(body);
      expect(String(r.trigger_event)).not.toMatch(body);
      expect(JSON.stringify(r.params ?? {})).not.toMatch(body);
    }
    // the table carries the same guard as the rules table
    expect(sql).toContain("milestone_definitions_no_body_metric");
    expect(sql).toContain("private.reward_text_mentions_body_metric(params::text)");
  });

  it("the body-metric scan discriminates: a sabotaged milestone is caught", () => {
    const body = /(^|[^a-z])(weight|bmi|waist|hip|hips|obes[a-z]*|calor[a-z]*|kcal|kg|lbs|pounds|slim|lean|body|fat|size|shape|thin|inches)([^a-z]|$)/i;
    expect(body.test("first_weight_check")).toBe(true);
    expect(body.test("first_bp_logged")).toBe(false);
  });

  it("no milestone is about a result: only the step (no outcome words in any code)", () => {
    for (const r of getProposedConfig("rewards.milestones").value as Array<Record<string, unknown>>) {
      expect(String(r.code)).not.toMatch(/(normal|in_range|controlled|improv|target|goal_met|lowered|dropped|abnormal|good|healthy)/);
    }
  });

  it("every milestone trigger is an event a points subscriber already handles (no new handler to deploy)", () => {
    const handled = new Set(["vitals.logged", "adherence.checkin_answered", "lesson.completed", "course.completed", "lab_result.released", "encounter.completed"]);
    for (const r of getProposedConfig("rewards.milestones").value as Array<Record<string, unknown>>) expect(handled.has(String(r.trigger_event))).toBe(true);
  });

  it("the migration adds no points-to-money rate and no second redemption path", () => {
    expect(sql).not.toMatch(/kobo_per_point|points_to_kobo|kobo_rate/);
    expect(sql).not.toMatch(/create (or replace )?function public\.apply_points_discount/i);
    expect(sql).not.toMatch(/create table public\.reward_redemptions/i);
  });
});
