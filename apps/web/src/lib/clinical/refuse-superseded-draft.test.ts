import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { refuseSupersededDraft } from "./refuse-superseded-draft";

type Answer = { data: unknown; error: unknown };

/** First `.eq("id", …)` lookup answers `target`; the `.eq("is_active", true)` lookup answers `active`. */
function client(target: Answer, active: Answer): SupabaseClient<Database> {
  return {
    from: () => ({
      select: () => ({
        eq: (column: string) => ({ maybeSingle: async () => (column === "id" ? target : active) }),
      }),
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
