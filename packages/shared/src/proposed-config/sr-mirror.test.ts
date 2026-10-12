import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, listUnconfirmed } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migration(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

describe("ops.service_targets (SR1, proposed, unsigned)", () => {
  it("carries the plan's five targets", () => {
    const t = getProposedConfig<Record<string, number>>("ops.service_targets").value;
    expect(t.redEventPagedWithinSeconds).toBe(60);
    expect(t.readingSavedAndGradedWithinSeconds).toBe(5);
    expect(t.nextTaskWithinSeconds).toBe(2);
    expect(t.chartSummaryOpensWithinSeconds).toBe(3);
    expect([t.lostPaymentConfirmationsAllowed, t.lostLabResultsAllowed, t.lostNotificationsAllowed, t.duplicatedTasksAllowed]).toEqual([0, 0, 0, 0]);
  });

  it("is still PROPOSED and awaiting the CMO: an agent must never mark it confirmed", () => {
    const r = getProposedConfig("ops.service_targets");
    expect(r.status).toBe("proposed");
    expect(r.owner).toBe("CMO");
    expect(listUnconfirmed().map((x) => x.key)).toContain("ops.service_targets");
  });
});

describe("ops.health_thresholds", () => {
  it("every degraded line is below its down line", () => {
    const t = getProposedConfig<Record<string, number>>("ops.health_thresholds").value;
    for (const k of Object.keys(t)) {
      const m = /^(.*)Degraded(Minutes|Percent)$/.exec(k);
      if (!m) continue;
      const down = t[`${m[1]}Down${m[2]}`];
      expect(down).toBeDefined();
      expect(t[k]).toBeLessThan(down as number);
    }
  });

  it("an unacknowledged page is down no later than the second step of the paging ladder", () => {
    const t = getProposedConfig<Record<string, number>>("ops.health_thresholds").value;
    const ladder = getProposedConfig<number[]>("paging.escalation_minutes").value;
    expect(t.unacknowledgedPageDownMinutes).toBeLessThanOrEqual(ladder[1] as number);
  });
});
