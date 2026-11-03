import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

function migrationSql(suffix: string): string {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ending ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
}

type Policy = { required_clinicians: number; window_days: number; sole_cmo_exception_sunset: string };

describe("rota.cover_policy mirrors the rota_cover_policy row", () => {
  it("v1 is the W-03 seed: five clinicians, 28 days, sunset 2027-01-31", () => {
    const seed = /insert into public\.rota_cover_policy \(required_clinicians, window_days, sole_cmo_exception_sunset, note\)\s*values \((\d+), (\d+), date '(\d{4}-\d{2}-\d{2})'/.exec(
      migrationSql("_w03_red_page_ladder_drilled.sql"),
    );
    expect(seed).not.toBeNull();
    const v1 = getProposedConfig<Policy>("rota.cover_policy", "2026-10-27").value;
    expect(v1).toEqual({ required_clinicians: Number(seed?.[1]), window_days: Number(seed?.[2]), sole_cmo_exception_sunset: seed?.[3] });
    expect(v1.required_clinicians).toBe(5);
  });

  it("v2 (founder decision 2026-11-03) is the value in force: two clinicians, same window, same sunset; the column default agrees", () => {
    const sql = migrationSql("_rota_cover_policy_two_clinicians.sql");
    const block = /rota-cover-policy-v2-begin([\s\S]*?)rota-cover-policy-v2-end/.exec(sql)?.[1] ?? "";
    const updated = /set required_clinicians = (\d+),/.exec(block);
    const dflt = /alter column required_clinicians set default (\d+)/.exec(block);
    const live = getProposedConfig<Policy>("rota.cover_policy");
    expect(live.version).toBe(2);
    expect(Number(updated?.[1])).toBe(live.value.required_clinicians);
    expect(Number(dflt?.[1])).toBe(live.value.required_clinicians);
    expect(live.value.required_clinicians).toBe(2);
    expect(block).not.toMatch(/window_days|sole_cmo_exception_sunset =/);
    const v1 = getProposedConfig<Policy>("rota.cover_policy", "2026-10-27").value;
    expect({ ...live.value, required_clinicians: 5 }).toEqual(v1);
  });

  it("is owned by the CMO and the sunset date is still proposed, never confirmed by the agent", () => {
    const live = getProposedConfig("rota.cover_policy");
    expect(live.owner).toBe("CMO");
    expect(live.status).toBe("proposed");
  });
});
