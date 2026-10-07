import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { isSupersededVersion, refuseSupersededDraft } from "./refuse-superseded-draft";

type Answer = { data: unknown; error: unknown };

/**
 * First `.eq("id", …)` lookup answers `target`; the live lookup (`.eq("is_active", true)`, then any
 * partition filters) answers `active`. Every `.eq` on the live lookup is recorded in `liveFilters`.
 */
function client(target: Answer, active: Answer, liveFilters: Array<[string, unknown]> = []): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => {
        const isTargetLookup = { value: false };
        const chain = {
          eq: (column: string, value: unknown) => {
            if (column === "id") isTargetLookup.value = true;
            else liveFilters.push([column, value]);
            return chain;
          },
          is: (column: string, value: unknown) => {
            liveFilters.push([`${column} is`, value]);
            return chain;
          },
          maybeSingle: async () => (isTargetLookup.value ? target : active),
        };
        return chain;
      },
    }),
  } as unknown as SupabaseClient<Database>;
}

const ok = (data: unknown): Answer => ({ data, error: null });

describe("refuseSupersededDraft", () => {
  it("refuses an unsigned draft older than the live version, naming both", async () => {
    const msg = await refuseSupersededDraft(
      client(ok({ version: 3, is_active: false }), ok({ version: 8 })),
      "escalation_slas",
      "x"
    );
    expect(msg).toContain("Version 3 is older than the live version 8");
  });

  it("allows a draft newer than the live version", async () => {
    expect(
      await refuseSupersededDraft(client(ok({ version: 9, is_active: false }), ok({ version: 8 })), "alert_rules", "x")
    ).toBeNull();
  });

  it("allows signing the live version itself, which is how a live-unsigned config gets signed", async () => {
    expect(
      await refuseSupersededDraft(client(ok({ version: 8, is_active: true }), ok({ version: 8 })), "alert_rules", "x")
    ).toBeNull();
  });

  it("allows a draft when nothing is live yet", async () => {
    expect(await refuseSupersededDraft(client(ok({ version: 1, is_active: false }), ok(null)), "alert_rules", "x")).toBeNull();
  });

  it("fails closed when the version cannot be read", async () => {
    expect(
      await refuseSupersededDraft(client({ data: null, error: { message: "boom" } }, ok({ version: 8 })), "alert_rules", "x")
    ).toContain("could not be checked");
  });

  it("fails closed when the version is not found", async () => {
    expect(await refuseSupersededDraft(client(ok(null), ok({ version: 8 })), "alert_rules", "x")).toContain("could not be checked");
  });

  it("fails closed when the live version cannot be read", async () => {
    expect(
      await refuseSupersededDraft(client(ok({ version: 9, is_active: false }), { data: null, error: { message: "boom" } }), "alert_rules", "x")
    ).toContain("could not be checked");
  });
});

describe("isSupersededVersion (what the managers use to hide Sign)", () => {
  it("is true only for a non-live version older than the live one", () => {
    expect(isSupersededVersion({ version: 3, is_active: false }, 8)).toBe(true);
    expect(isSupersededVersion({ version: 8, is_active: true }, 8)).toBe(false);
    expect(isSupersededVersion({ version: 9, is_active: false }, 8)).toBe(false);
  });

  it("is false when nothing is live, so a first version can still be signed", () => {
    expect(isSupersededVersion({ version: 1, is_active: false }, null)).toBe(false);
    expect(isSupersededVersion({ version: 1, is_active: false }, undefined)).toBe(false);
  });
});

describe("refuseSupersededDraft partitions", () => {
  it("compares a cv_risk_config draft only with the live version of its own organisation", async () => {
    const filters: Array<[string, unknown]> = [];
    await refuseSupersededDraft(
      client(ok({ version: 2, is_active: false, organisation_id: "org-b" }), ok({ version: 1 }), filters),
      "cv_risk_config",
      "x"
    );
    expect(filters).toContainEqual(["organisation_id", "org-b"]);
  });

  it("partitions the risk questionnaire by organisation and code", async () => {
    const filters: Array<[string, unknown]> = [];
    await refuseSupersededDraft(
      client(ok({ version: 2, is_active: false, organisation_id: "org-a", code: "prevention_intake" }), ok({ version: 1 }), filters),
      "risk_questionnaire_configs",
      "x"
    );
    expect(filters).toContainEqual(["organisation_id", "org-a"]);
    expect(filters).toContainEqual(["code", "prevention_intake"]);
  });

  it("does not partition a global table", async () => {
    const filters: Array<[string, unknown]> = [];
    await refuseSupersededDraft(client(ok({ version: 2, is_active: false }), ok({ version: 1 }), filters), "alert_rules", "x");
    expect(filters.map(([c]) => c)).toEqual(["is_active"]);
  });

  it("matches a null partition value with is-null, as the database trigger does", async () => {
    const filters: Array<[string, unknown]> = [];
    await refuseSupersededDraft(
      client(ok({ version: 2, is_active: false, organisation_id: null }), ok({ version: 1 }), filters),
      "cv_risk_config",
      "x"
    );
    expect(filters).toContainEqual(["organisation_id is", null]);
    expect(filters.find(([c]) => c === "organisation_id")).toBeUndefined();
  });
});
