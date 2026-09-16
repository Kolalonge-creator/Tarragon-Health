import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { GOVERNED_CONFIG_TABLES, readGovernedConfigSignoff } from "./governed-config-signoff";

/**
 * The failure mode worth testing here is not "does it read a row" — it is
 * "does it ever claim green when it does not know". A sign-off checklist that
 * reports everything signed because a read failed is worse than one that
 * fails loudly, because the whole point of the page is to be trusted when it
 * says there is nothing left to do.
 */
function client(
  answer: (table: string) => { data: unknown; error: unknown }
): SupabaseClient<Database> {
  return {
    from: jest.fn((table: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => answer(table) }),
      }),
    })),
  } as unknown as SupabaseClient<Database>;
}

describe("readGovernedConfigSignoff", () => {
  it("reports a signed active version as signed", async () => {
    const rows = await readGovernedConfigSignoff(
      client(() => ({ data: { version: 6, approved_by: "staff-1" }, error: null }))
    );

    expect(rows).toHaveLength(GOVERNED_CONFIG_TABLES.length);
    expect(rows.every((r) => r.signed)).toBe(true);
    expect(rows[0]?.version).toBe(6);
  });

  it("reports a live-but-unsigned version as unsigned, keeping its version number", async () => {
    const rows = await readGovernedConfigSignoff(
      client(() => ({ data: { version: 3, approved_by: null }, error: null }))
    );

    expect(rows.every((r) => !r.signed)).toBe(true);
    expect(rows[0]?.version).toBe(3);
  });

  it("never reports signed when the read fails", async () => {
    // The assertion that matters. A thrown or errored read must not fall
    // through to a green tick.
    const rows = await readGovernedConfigSignoff(
      client(() => ({ data: null, error: { message: "permission denied" } }))
    );

    expect(rows.every((r) => !r.signed)).toBe(true);
    expect(rows.every((r) => r.version === null)).toBe(true);
  });

  it("distinguishes 'no active version' from 'unsigned version'", async () => {
    const rows = await readGovernedConfigSignoff(client(() => ({ data: null, error: null })));

    expect(rows.every((r) => !r.signed)).toBe(true);
    expect(rows.every((r) => r.version === null)).toBe(true);
  });
});
