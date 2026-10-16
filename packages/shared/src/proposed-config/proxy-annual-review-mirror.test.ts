import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function seedRow(): { intervalMonths: number; repeatDays: number; maxReminders: number; status: string } {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_proxy_yearly_access_review.sql"));
  if (!file) throw new Error("proxy yearly access review migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const m = /insert into public\.proxy_review_config[^;]*?values \((\d+), (\d+), (\d+), (\d+), '(\w+)', true,/.exec(sql);
  if (!m) throw new Error("proxy_review_config seed not found");
  return { intervalMonths: Number(m[2]), repeatDays: Number(m[3]), maxReminders: Number(m[4]), status: m[5] as string };
}

describe("proxy.annual_review mirrors proxy_review_config v1", () => {
  it("is identical, so the registry and the database cannot drift", () => {
    const { status, ...values } = seedRow();
    const e = getProposedConfig("proxy.annual_review");
    expect(values).toEqual(e.value);
    expect(e.status).toBe(status);
  });

  it("is proposed and owned by the founder; silence never removes access, so the cap is finite and the interval is a year", () => {
    const e = getProposedConfig<{ intervalMonths: number; repeatDays: number; maxReminders: number }>("proxy.annual_review");
    expect(e.status).toBe("proposed");
    expect(e.owner).toBe("Founder");
    expect(e.value.intervalMonths).toBe(12);
    expect(e.value.maxReminders).toBeGreaterThanOrEqual(1);
    expect(e.value.maxReminders).toBeLessThanOrEqual(12);
  });
});
