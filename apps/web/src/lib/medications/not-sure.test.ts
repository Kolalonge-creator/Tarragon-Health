import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { NOT_SURE_NOTE_PREFIX, notSureInputSchema, notSureNote } from "./not-sure";

describe("not-sure note (P16)", () => {
  it("always starts with the prefix the once-a-day index keys on", () => {
    expect(notSureNote("reconciliation").startsWith(NOT_SURE_NOTE_PREFIX)).toBe(true);
    expect(notSureNote("checkin", { drugName: "Metformin", checkinType: "missed_doses" })).toBe(
      'Patient answered "Not sure" to a medication check-in about Metformin (missed doses). Routine: please follow up.'
    );
  });

  it("matches the prefix in the migration's index predicate exactly", () => {
    const dir = join(__dirname, "../../../../../supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_p16_not_sure_task_one_per_day.sql"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file as string), "utf8");
    expect(sql).toContain(`note like '${NOT_SURE_NOTE_PREFIX}%'`);
  });

  it("accepts only a check-in id or the medication list", () => {
    expect(notSureInputSchema.safeParse({ source: "reconciliation" }).success).toBe(true);
    expect(notSureInputSchema.safeParse({ source: "checkin", checkinId: "not-a-uuid" }).success).toBe(false);
    expect(notSureInputSchema.safeParse({ source: "other" }).success).toBe(false);
  });
});
