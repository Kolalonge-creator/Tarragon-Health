import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function s64Sql(): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s64b_consultation_gaps.sql"));
  if (!file) throw new Error("S64b migration not found");
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

type Access = {
  perItemRoles: string[];
  perItemPriceKobo: number | null;
  reminderHoursBefore: number[];
  longLeadMilestone: string;
  intake: { maxReasonChars: number; maxAnswerChars: number; maxAnswers: number };
};

describe("consultations.access mirrors the S64 migration", () => {
  const v = getProposedConfig<Access>("consultations.access").value;

  it("reminder milestones in queue_appointment_reminders equal the configured hours (7 days, 1 day, 2 hours)", () => {
    const sql = s64Sql();
    const marker = /reminder-config-begin\s*\n--\s*(\{[^\n]*\})/.exec(sql);
    if (!marker?.[1]) throw new Error("reminder config marker not found in the migration");
    const fromMigration = JSON.parse(marker[1]) as { milestonesHoursBefore: number[]; longLeadMilestone: string };
    expect(fromMigration.milestonesHoursBefore).toEqual(v.reminderHoursBefore);
    expect(fromMigration.longLeadMilestone).toBe(v.longLeadMilestone);
    // the function body really uses those numbers, not only the marker comment
    const fn = /create or replace function private\.queue_appointment_reminders[\s\S]*?\$function\$;/.exec(sql)?.[0] ?? "";
    for (const h of v.reminderHoursBefore) expect(fn).toContain(`${h}.0`);
    expect(fn).toContain(`'${v.longLeadMilestone}'`);
  });

  it("intake limits equal the table checks", () => {
    const sql = s64Sql();
    expect(sql).toContain(`between 1 and ${v.intake.maxReasonChars}`);
    expect(sql).toContain(`not between 1 and ${v.intake.maxAnswerChars}`);
    expect(sql).toContain(`<= ${v.intake.maxAnswers}`);
  });

  it("assumes no price for the per-item roles: none is set, and the products start inactive at 0 (OQ-S64-1)", () => {
    expect(v.perItemPriceKobo).toBeNull();
    const sql = s64Sql();
    expect(sql).toMatch(/v\.description, 0, false/);
  });

  it("every per-item role has a product code in the database map", () => {
    const sql = s64Sql();
    for (const role of v.perItemRoles) expect(sql).toContain(`when '${role}' then '${role}_consult_credit'`);
  });
});
