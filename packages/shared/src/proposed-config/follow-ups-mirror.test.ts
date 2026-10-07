import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("follow_ups.rules mirrors the migration seed", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s77_clinical_follow_ups_closure.sql"));
  if (!file) throw new Error("S77 follow-ups migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");

  it("is identical to the clinical_follow_up_config seed", () => {
    const match = /follow-up-rules-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("follow-up rules seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(getProposedConfig("follow_ups.rules").value);
  });

  it("is seeded unsigned and inactive (nothing is signed by an agent)", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-07'/);
  });

  it("carries the CMO's S-20 times: 24 hours routine, 4 hours abnormal result", () => {
    expect(getProposedConfig("follow_ups.rules").value).toEqual({ routine_escalate_after_hours: 24, abnormal_escalate_after_hours: 4 });
  });
});
