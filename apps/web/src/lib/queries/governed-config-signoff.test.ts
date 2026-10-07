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
      select: () => {
        // The multi-kind ledger (S88) is read as a plain list; derive its rows from the same canned answer.
        const list = answer(table);
        const row = list.data as { version: number; approved_by: string | null } | null;
        const asList = {
          data: list.error ? null : row ? [{ config_kind: "k", version: row.version, status: "active", approved_by: row.approved_by }] : [],
          error: list.error,
        };
        return Object.assign(Promise.resolve(asList), {
          eq: () => ({ maybeSingle: async () => answer(table) }),
        });
      },
    })),
  } as unknown as SupabaseClient<Database>;
}

function multiKindClient(rows: unknown[] | null, error: unknown = null): SupabaseClient<Database> {
  return {
    from: (table: string) =>
      table === "clinical_config_versions"
        ? { select: async () => ({ data: rows, error }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { version: 1, approved_by: "s" }, error: null }) }) }) },
  } as unknown as SupabaseClient<Database>;
}

const s88 = async (c: SupabaseClient<Database>) =>
  (await readGovernedConfigSignoff(c)).find((r) => r.table === "clinical_config_versions");

describe("readGovernedConfigSignoff, S88 multi-kind ledger", () => {
  const draft = (kind: string) => ({ config_kind: kind, version: 1, status: "draft", approved_by: null });
  const live = (kind: string, v = 1) => ({ config_kind: kind, version: v, status: "active", approved_by: "staff" });

  it("six unsigned drafts are unsigned, with no version", async () => {
    const row = await s88(multiKindClient(["a", "b", "c", "d", "e", "f"].map(draft)));
    expect(row).toMatchObject({ signed: false, version: null, href: "/admin/settings/clinical-signoff" });
  });

  it("is signed only when every kind has a signed live version", async () => {
    expect((await s88(multiKindClient([live("a"), draft("b")])))?.signed).toBe(false);
    expect((await s88(multiKindClient([live("a"), live("b", 2)])))).toMatchObject({ signed: true, version: 2 });
  });

  it("a failed read is never green", async () => {
    expect((await s88(multiKindClient(null, { message: "denied" })))).toMatchObject({ signed: false, version: null });
  });
});

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
