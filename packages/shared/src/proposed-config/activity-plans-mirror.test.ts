import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s48b_activity_offline_plans_route_status.sql"));
  if (!file) throw new Error("S48b migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("S48b workout-plan and readiness config", () => {
  it("the session length range mirrors the database CHECK", () => {
    const v = getProposedConfig("activity.workout_plans").value as { session_minutes: { min: number; max: number } };
    const sql = migration();
    expect(sql).toContain(`@.minutes < ${v.session_minutes.min}`);
    expect(sql).toContain(`@.minutes > ${v.session_minutes.max}`);
  });

  it("both entries are PROPOSED and owned by the CMO (an agent never confirms them)", () => {
    for (const key of ["activity.workout_plans", "activity.readiness_bands"]) {
      const e = getProposedConfig(key);
      expect(e.status).toBe("proposed");
      expect(e.owner).toBe("CMO");
    }
  });

  it("the migration adds no table, no guard and no signing function (nothing to sign, nothing switched on)", () => {
    const sql = migration().replace(/--.*$/gm, "");
    expect(sql).not.toMatch(/create table/i);
    expect(sql).not.toMatch(/insert into public\.go_live_guards/i);
    expect(sql).not.toMatch(/is_on\s*=\s*true/i);
    expect(sql).not.toMatch(/sign_/i);
  });
});
