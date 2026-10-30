/**
 * The laboratory statement boxes read amounts with parseFloat, so a total typed as "1,500,000" was
 * saved as one naira, and a line amount typed with a comma shifted every later value in the line
 * (the lab order id became "500"). Amounts are now read exactly or refused.
 */
jest.mock("server-only", () => ({}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const inserts: { table: string; row: unknown }[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const reply = table === "profiles" ? { data: { organisation_id: "org-1" }, error: null } : { data: { id: "s1" }, error: null };
      const proxy: unknown = new Proxy(chain, {
        get(_t, prop) {
          if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(reply);
          if (prop === "insert") return (row: unknown) => { inserts.push({ table, row }); return proxy; };
          return () => proxy;
        },
      });
      return proxy;
    },
  }),
}));

import { createPartnerStatement } from "./actions";

function form(total: string, lines = "") {
  const f = new FormData();
  f.set("providerId", "p1");
  f.set("reference", "INV-1");
  f.set("periodStart", "2026-10-01");
  f.set("periodEnd", "2026-10-31");
  f.set("invoicedTotalNaira", total);
  f.set("lines", lines);
  return f;
}

beforeEach(() => { inserts.length = 0; });

describe("createPartnerStatement amounts", () => {
  it("saves a comma total in full, not as one naira", async () => {
    const r = await createPartnerStatement(undefined, form("1,500,000"));
    expect(r).toMatchObject({ message: expect.any(String) });
    expect(inserts.find((i) => i.table === "partner_statements")?.row).toMatchObject({ invoiced_total_kobo: 150000000 });
  });

  it.each(["abc", "0", "-5", ""])("refuses the total %j and saves nothing", async (total) => {
    const r = await createPartnerStatement(undefined, form(total));
    expect(r).toMatchObject({ error: expect.stringMatching(/^Total invoiced:/) });
    expect(inserts).toEqual([]);
  });

  it("reads each line amount exactly", async () => {
    await createPartnerStatement(undefined, form("5000", "screen_a, 2500.50, order-1, REF-1\nscreen_b, 1000"));
    const lines = inserts.find((i) => i.table === "partner_statement_lines")?.row as { invoiced_kobo: number }[];
    expect(lines.map((l) => l.invoiced_kobo)).toEqual([250050, 100000]);
  });

  it("refuses a line whose amount has a comma in it, instead of shifting its other values", async () => {
    const r = await createPartnerStatement(undefined, form("5000", "screen_a, 1,500, order-1, REF-1"));
    expect(r).toMatchObject({ error: expect.stringMatching(/Line 1 has more than four values/) });
    expect(inserts).toEqual([]);
  });

  it("refuses an unreadable line amount, naming the line", async () => {
    const r = await createPartnerStatement(undefined, form("5000", "screen_a, 100\nscreen_b, lots"));
    expect(r).toMatchObject({ error: expect.stringMatching(/^Line 2, invoiced amount:/) });
    expect(inserts).toEqual([]);
  });
});
