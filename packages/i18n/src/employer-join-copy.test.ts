import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { en, t } from "./index";

/**
 * "What your employer sees" and "Who pays" on the screens where a person joins an employer or sponsor programme.
 *
 * The employer text says the staff list shows a name, phone and email, because that is what public.employer_join_with_code stores
 * when someone joins with an organisation code. The first test reads that function so the sentence cannot drift from the behaviour:
 * if the function stops storing one of these, this fails and the wording has to be revisited with it (and the other way round).
 */
const MIGRATION = "../../../supabase/migrations/20260829093043_employer_platform_roster_eligibility_invitations_departure.sql";

function joinFunctionBody(): string {
  const sql = readFileSync(new URL(MIGRATION, import.meta.url), "utf8");
  const start = sql.indexOf("create function public.employer_join_with_code");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end);
}

const KEYS = ["employer.join.sees_title", "employer.join.sees_body", "programme.who_pays_title", "programme.who_pays_body"] as const;

describe("employer join copy", () => {
  it("says the staff list shows name, phone and email, which is what joining with a code stores", () => {
    const body = joinFunctionBody();
    // The insert for a person the employer had not listed writes these three fields and marks the row claimed.
    expect(body).toMatch(/insert into public\.employer_roster_members\s*\(organisation_id, phone, email, full_name, status, claimed_profile_id/);
    const text = t("employer.join.sees_body", "en");
    expect(text).toMatch(/name/);
    expect(text).toMatch(/phone number/);
    expect(text).toMatch(/email/);
    expect(text).toMatch(/that you joined/);
  });

  it("promises only aggregate health figures, never an individual's data", () => {
    const text = t("employer.join.sees_body", "en");
    expect(text).toMatch(/group totals only/);
    expect(text).toMatch(/does not see your readings, your results, your medicines or your messages/);
    // Not asserted, because it was not verified for every employer screen: that small groups are hidden everywhere (see OQ-727).
    expect(text).not.toMatch(/small group/);
    // It must not claim "never your name": the staff list shows the name (see the first test).
    expect(text).not.toMatch(/never see your name/i);
  });

  it("states a number only if the number is read from configuration (so none appears in these strings)", () => {
    for (const k of KEYS) expect(en[k]).not.toMatch(/\d/);
  });

  it("says who pays without promising a price, a refund or a free service", () => {
    const text = t("programme.who_pays_body", "en");
    expect(text).toMatch(/covered by them/);
    expect(text).toMatch(/Joining does not charge you anything/);
    expect(text).not.toMatch(/\bfree\b|\bcheap|\bdiscount|\brefund|\bguarantee/i);
  });

  it("follows the copy rules: no em dash or en dash, never 'your doctor', no fear words", () => {
    for (const k of KEYS) {
      const v = en[k];
      expect(v).not.toMatch(/[–—]/);
      expect(v).not.toMatch(/your doctor/i);
      expect(v).not.toMatch(/warning|danger|urgent|emergency|cure/i);
    }
  });
});
