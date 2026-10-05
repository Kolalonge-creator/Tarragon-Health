import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadAdherenceBand, loadMedicineRules } from "./medicines-config";
import { loadReminderBehaviour } from "./s07-config";

/**
 * The server holds the values its own functions need (the missed job, the refill
 * reminder, the adherence signal) in `medicine_config`; the phone reads the same
 * numbers from the versioned registry. This keeps the two equal: changing one
 * without the other fails here instead of showing a patient 80 percent while the
 * care team sees something else.
 */
describe("medicine config: phone registry and server row agree", () => {
  const dir = join(__dirname, "../../../../supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_s08_medicines_schedules_supply_missed_adherence.sql"));
  const sql = file ? readFileSync(join(dir, file), "utf8") : "";
  // values (1, true, missed_after, server_missed_after, low_supply, window, threshold, min_doses, note)
  const m = /values \(1, true, (\d+), (\d+), (\d+),\s*(\d+), (\d+), (\d+),/.exec(sql);

  it("finds the seeded row in the migration", () => {
    expect(m).not.toBeNull();
  });

  it("matches reminders.behaviour, medicines.dose_rules and adherence.threshold", () => {
    const [, missedAfter, serverMissedAfter, lowSupply, windowDays, threshold, minDoses] = m!.map(Number);
    expect(missedAfter).toBe(loadReminderBehaviour().missedAfterMinutes);
    expect(serverMissedAfter).toBe(loadMedicineRules().serverMissedAfterMinutes);
    expect(lowSupply).toBe(loadMedicineRules().lowSupplyDays);
    expect(windowDays).toBe(loadAdherenceBand().windowDays);
    expect(threshold).toBe(loadAdherenceBand().percent);
    expect(minDoses).toBe(loadMedicineRules().adherenceMinDoses);
  });

  it("the server missed window is never shorter than the on-device one", () => {
    const [, missedAfter, serverMissedAfter] = m!.map(Number);
    expect(serverMissedAfter).toBeGreaterThanOrEqual(missedAfter);
  });

  it("loads every medicines value as a number above its floor", () => {
    const rules = loadMedicineRules();
    for (const v of Object.values(rules)) expect(Number.isFinite(v)).toBe(true);
    expect(rules.undoSeconds).toBeGreaterThan(0);
  });
});
