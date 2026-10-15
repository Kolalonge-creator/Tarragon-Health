import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seed(): Record<string, unknown> {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s16_s20_task_layer.sql"));
  if (!file) throw new Error("S16-S20 task layer migration not found");
  const match = /task-layer-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error("task layer seed not found in the migration");
  return JSON.parse(match[1]) as Record<string, unknown>;
}

describe("queue.task_layer mirrors the queue_task_layer_config seed (S16-S20)", () => {
  it("is identical to the migration seed", () => {
    expect(seed()).toEqual(getProposedConfig("queue.task_layer").value);
  });

  it("is proposed, owned by the CMO and never confirmed by an agent", () => {
    const entry = getProposedConfig("queue.task_layer");
    expect(entry.owner).toBe("CMO");
    expect(entry.status).toBe("proposed");
  });

  it("never alerts by SMS or WhatsApp (F-02, OQ-05)", () => {
    const a = (getProposedConfig("queue.task_layer").value as { escalation_alert: Record<string, string[]> }).escalation_alert;
    const all = [...a.immediate_channels, ...a.notice_channels, ...a.digest_channels];
    expect(all.filter((c) => !["in_app", "push", "email"].includes(c))).toEqual([]);
  });

  it("every outcome list is non-empty and every system-checked type has its own list", () => {
    const c = (getProposedConfig("queue.task_layer").value as { completion: { default_codes: string[]; codes_by_type: Record<string, string[]> } }).completion;
    expect(c.default_codes.length).toBeGreaterThan(0);
    for (const type of ["critical_result_review", "titration_signoff", "pharmacy_flag_review", "symptom_review", "async_question", "red_event_unacknowledged"]) {
      expect(c.codes_by_type[type]?.length).toBeGreaterThan(0);
    }
  });
});
