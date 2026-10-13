import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s16_clinical_tasks.sql"));
  if (!file) throw new Error("S16 migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

const list = (s: string): string[] => (s.length === 0 ? [] : s.split(","));

describe("queue.* mirrors the migration seed", () => {
  it("queue.rules is identical to the queue_config seed", () => {
    const match = /queue-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(migrationSql());
    if (!match?.[1]) throw new Error("queue rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("queue.rules").value);
  });

  it("queue.task_types is identical to the task_types seed, row by row", () => {
    const block = /task-types-begin([\s\S]*?)task-types-end/.exec(migrationSql())?.[1];
    if (!block) throw new Error("task types seed not found in the migration");
    const re = /^\s*\('([a-z_]+)', (\d+), (\d+), (\d+), '([a-z_]+)', '\{([^}]*)\}',\s*(\d+), (\d+), (true|false),\s*(true|false),\s*'\{([^}]*)\}'/gm;
    const seeded = [...block.matchAll(re)].map((m) => ({
      code: m[1],
      priority_class: Number(m[3]),
      default_due_minutes: Number(m[4]),
      // F-05 (2026-10-07): the migration seed still names the retired Medical Officer tier; the F-05 migration moved those rows to the senior tier.
      min_doctor_tier: m[5] === "medical_officer" ? "senior_medical_officer" : m[5],
      required_competencies: list(m[6] ?? ""),
      lead_window_minutes: Number(m[7]),
      claim_timeout_minutes: Number(m[8]),
      pushable: m[9] === "true",
      creatable: m[10] === "true",
      source_task_keys: list(m[11] ?? ""),
    }));
    expect(seeded).toHaveLength(10);
    expect(seeded).toEqual(getProposedConfig("queue.task_types").value);
  });

  it("the spec's priority classes and due windows hold (7.3)", () => {
    const rows = getProposedConfig("queue.task_types").value as { code: string; priority_class: number; default_due_minutes: number }[];
    const by = (c: string) => rows.find((r) => r.code === c);
    expect(by("red_event_unacknowledged")?.priority_class).toBe(1);
    expect(by("critical_result_review")?.default_due_minutes).toBe(120);
    expect(by("amber_bp_review")?.default_due_minutes).toBe(1440);
    expect(by("titration_signoff")?.default_due_minutes).toBe(2880);
    expect(by("admin_clinical")?.default_due_minutes).toBe(4320);
    expect((getProposedConfig("queue.rules").value as { class3_promotion_window_minutes: number }).class3_promotion_window_minutes).toBe(240);
  });

  it("queue.claims is identical to the queue_claim_config seed (S17)", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s17_queue_next.sql"));
    if (!file) throw new Error("S17 migration not found");
    const match = /queue-claims-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (!match?.[1]) throw new Error("queue claims seed not found in the migration");
    const seed = JSON.parse(match[1]) as Record<string, unknown>;
    const mirror = getProposedConfig("queue.claims").value as Record<string, unknown>;
    expect(seed).toEqual(mirror);
    // the older registry key for the same threshold must agree with the one the database reads
    const t = getProposedConfig("queue.handback_review_threshold").value as { moreThan: number; windowDays: number };
    expect((seed.handback_review as { more_than: number; window_days: number })).toEqual({ more_than: t.moreThan, window_days: t.windowDays });
  });
});
