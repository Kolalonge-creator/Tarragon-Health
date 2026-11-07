import { looksLikeReference, matchesNeedle, searchRecords } from "./admin-search-records";

/** A fake query builder: every chained call is recorded, and awaiting it resolves to the table's canned answer. */
function fakeClient(tables: Record<string, { data: unknown; error: unknown }>, rpcs: Record<string, { data: unknown; error: unknown }>) {
  const calls: { table: string; chain: string[] }[] = [];
  const from = (table: string) => {
    const entry = { table, chain: [] as string[] };
    calls.push(entry);
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "eq", "ilike", "or", "order", "limit", "in"]) {
      builder[m] = (...args: unknown[]) => {
        entry.chain.push(`${m}(${args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(",")})`);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve(tables[table] ?? { data: [], error: null });
    return builder;
  };
  const rpc = async (fn: string) => rpcs[fn] ?? { data: null, error: { message: "unknown" } };
  return { client: { from, rpc } as never, calls };
}

const cohort = { id: "11111111-1111-4111-8111-111111111111", name: "Acme Staff Health", code: "ACME26", sponsor: "Acme Ltd", valid_from: "2026-01-01", valid_to: "2026-12-31", max_uses: 100, uses: 3, status: "active" };
const okRpcs = {
  admin_list_sponsor_cohorts: { data: [cohort], error: null },
  admin_dx_overview: { data: null, error: { message: "denied", code: "42501" } },
};

describe("looksLikeReference", () => {
  it("accepts a Paystack-style token and rejects words with spaces or short terms", () => {
    expect(looksLikeReference("T2_ab12cd34")).toBe(true);
    expect(looksLikeReference("acme ltd")).toBe(false);
    expect(looksLikeReference("abc")).toBe(false);
  });
});

describe("matchesNeedle", () => {
  it("matches any field, case-blind, and ignores missing fields", () => {
    expect(matchesNeedle("acme", null, "ACME Ltd")).toBe(true);
    expect(matchesNeedle("zzz", "Acme", undefined)).toBe(false);
  });
});

describe("searchRecords", () => {
  it("returns employers, sponsor programmes and incidents with links to their own pages", async () => {
    const { client } = fakeClient(
      {
        organisations: { data: [{ id: "org-1", name: "Acme Ltd", is_active: true }], error: null },
        ops_incidents: { data: [{ id: "inc-1", reference: "INC-12", title: "Acme webhook outage", severity: "sev2", status: "open" }], error: null },
      },
      okRpcs,
    );
    const { results } = await searchRecords(client, "acme", "acme");
    expect(results.map((r) => [r.group, r.label, r.href])).toEqual([
      ["Employers", "Acme Ltd", "/admin/employers/org-1"],
      ["Sponsor programmes", "Acme Staff Health", `/admin/sponsors/${cohort.id}`],
      ["Incidents", "Acme webhook outage", "/admin/ops/incidents/inc-1"],
    ]);
  });

  it("reports a source that failed instead of passing a shorter list off as complete", async () => {
    const { client } = fakeClient({ ops_incidents: { data: null, error: { message: "timeout", code: "57014" } } }, okRpcs);
    expect((await searchRecords(client, "acme", "acme")).failed).toBe(true);
  });

  it("treats a list the admin is not entitled to (42501) as not theirs, not as a failure", async () => {
    // admin_dx_overview is refused with 42501 in okRpcs; everything else answers.
    const { client } = fakeClient({}, okRpcs);
    expect((await searchRecords(client, "acme", "acme")).failed).toBe(false);
  });

  it("only looks up orders for a reference-like term, and links an order to the patient it was for", async () => {
    const plain = fakeClient({}, okRpcs);
    await searchRecords(plain.client, "acme ltd", "acme ltd");
    expect(plain.calls.some((c) => c.table === "orders")).toBe(false);

    const ref = fakeClient(
      {
        orders: { data: [{ id: "o-1", paystack_reference: "T2_ab12cd34", state: "paid", amount_kobo: 10_000_000, created_at: "2026-11-05T10:00:00Z", beneficiary_patient_id: "p-1" }], error: null },
        profiles: { data: [{ id: "p-1", patient_number: "TH-000123" }], error: null },
      },
      okRpcs,
    );
    const { results } = await searchRecords(ref.client, "T2_ab12cd34", "t2_ab12cd34");
    const order = results.find((r) => r.group === "Payments");
    expect(order).toEqual({
      label: "Order T2_ab12cd34",
      href: "/admin/patients?q=TH-000123",
      group: "Payments",
      hint: "paid · ₦100,000 · 5 Nov 2026 · TH-000123",
    });
    // Orders are matched only on the reference column, so a name can never pull up someone's payments.
    expect(ref.calls.find((c) => c.table === "orders")?.chain).toContain("ilike(paystack_reference,%T2_ab12cd34%)");
    // Test checkouts are never offered to staff.
    expect(ref.calls.find((c) => c.table === "orders")?.chain).toContain("eq(is_test,false)");
  });
});
