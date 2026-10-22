import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

describe("records_request.letter and records_request.response_days", () => {
  const letter = getProposedConfig("records_request.letter");
  const days = getProposedConfig("records_request.response_days");
  const v = letter.value as unknown as { wording_status: string; scopes: Record<string, string>; intro: string };

  it("are PROPOSED and owned by the founder with counsel; an agent never confirms them", () => {
    for (const e of [letter, days]) {
      expect(e.status).toBe("proposed");
      expect(e.owner).toBe("Founder and counsel");
      expect(e.version).toBe(1);
    }
    expect(v.wording_status).toBe("unsigned_placeholder_pending_counsel");
    expect((days.value as { label: string }).label).toBe("placeholder_pending_counsel");
  });

  it("keeps the reply period inside the bounds the database enforces (1 to 180 days)", () => {
    const n = (days.value as { days: number }).days;
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(180);
    const sql = readFileSync(join(MIGRATIONS, "20261020221547_records_request_letters.sql"), "utf8");
    expect(sql).toContain("p_response_days < 1 or p_response_days > 180");
  });

  it("offers exactly the scope codes the database accepts", () => {
    const sql = readFileSync(join(MIGRATIONS, "20261020221547_records_request_letters.sql"), "utf8");
    const accepted = /scope_codes <@ array\[([^\]]*)\]/.exec(sql)?.[1]?.match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, "")) ?? [];
    expect(Object.keys(v.scopes).sort()).toEqual([...accepted].sort());
    expect(accepted.length).toBe(4);
  });

  it("states no statute section, penalty or legal-advice claim in the wording", () => {
    const whole = JSON.stringify(letter.value);
    expect(whole).not.toMatch(/legal advice|\bsection\b|penalt|—/i);
  });
});
