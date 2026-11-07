import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { safeTerm, searchPatientRecord, snippetAround } from "./record-search";

type Reply = { data: unknown; error: unknown };

/** A chainable stand-in for the RLS client: every builder method returns the chain, and awaiting it gives the table's reply. */
function fakeClient(tables: Record<string, Reply>, rpcReply: Reply = { data: [], error: null }) {
  const calls: { table: string; filters: unknown[][] }[] = [];
  const rpc = jest.fn(async () => rpcReply);
  const from = jest.fn((table: string) => {
    const entry = { table, filters: [] as unknown[][] };
    calls.push(entry);
    const reply = tables[table] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "ilike", "order", "limit"]) {
      chain[m] = (...args: unknown[]) => {
        entry.filters.push([m, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => reply;
    chain.then = (resolve: (r: Reply) => unknown) => Promise.resolve(reply).then(resolve);
    return chain;
  });
  return { client: { from, rpc } as unknown as SupabaseClient<Database>, calls, rpc, from };
}

const RELEASED = {
  lab_result_id: "11111111-1111-4111-8111-111111111111",
  received_at: "2026-11-03T09:00:00Z",
  panel_code: "diabetes_panel",
  own_upload: false,
  status: "released",
  explain_allowed: false,
  has_file: false,
  items: [{ analyte_code: "hba1c", value_numeric: 6.5, value_text: null, unit: "%", ref_low: null, ref_high: null, flag: "high" }],
};
const HELD = { ...RELEASED, lab_result_id: "22222222-2222-4222-8222-222222222222", status: "under_review", items: [] };

const ME = { userId: "u1", subjectId: "u1" };
const ACTING = { userId: "u1", subjectId: "p2" };

describe("safeTerm / snippetAround", () => {
  it("drops filter-syntax characters", () => {
    expect(safeTerm("met%for,min()")).toBe("met for min");
  });
  it("cuts a long message around the match", () => {
    const s = snippetAround(`${"a ".repeat(60)}metformin ${"b ".repeat(60)}`, "metformin", 40);
    expect(s).toContain("metformin");
    expect(s.startsWith("…")).toBe(true);
  });
});

describe("searchPatientRecord", () => {
  it("returns nothing and touches nothing for a one-letter query", async () => {
    const f = fakeClient({});
    expect(await searchPatientRecord(f.client, ME, "a")).toEqual({ results: [], failed: false });
    expect(f.from).not.toHaveBeenCalled();
  });

  it("finds released results, medicines and messages for the patient's own record", async () => {
    const f = fakeClient(
      {
        medications: { data: [{ id: "m1", drug_name: "Metformin", dose: "500 mg", frequency: "twice daily", is_active: true }], error: null },
        care_messages: { data: [{ id: "c1", body: "Should I take HbA1c fasting?", created_at: "2026-11-01T10:00:00Z", thread: { subject: "Blood test" } }], error: null },
      },
      { data: [RELEASED, HELD], error: null },
    );
    const r = await searchPatientRecord(f.client, ME, "hba1c");
    expect(r.failed).toBe(false);
    expect(r.results.map((h) => h.group)).toEqual(["Results", "Medicines", "Messages"]);
    expect(r.results[0]).toMatchObject({ label: "hba1c", href: "/patient/labs" });
    expect(r.results[2]).toMatchObject({ label: "Blood test", href: "/patient/messages" });
    // every table read is pinned to the record being searched
    for (const c of f.calls) expect(c.filters).toContainEqual(["eq", "patient_id", "u1"]);
  });

  it("never finds a result that is still held for review", async () => {
    const f = fakeClient({}, { data: [{ ...HELD, panel_code: "hiv_screen" }], error: null });
    const r = await searchPatientRecord(f.client, ME, "hiv");
    expect(r.results).toEqual([]);
  });

  it("while acting, searches only the groups the grant covers and never the own-record results", async () => {
    const f = fakeClient({
      profile_access: { data: { categories: [{ category: "medications" }] }, error: null },
      medications: { data: [{ id: "m1", drug_name: "Amlodipine", dose: "5 mg", frequency: null, is_active: true }], error: null },
      care_messages: { data: [{ id: "c1", body: "amlodipine", created_at: "2026-11-01T10:00:00Z", thread: null }], error: null },
    });
    const r = await searchPatientRecord(f.client, ACTING, "amlo");
    expect(r.results.map((h) => h.group)).toEqual(["Medicines"]);
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.calls.map((c) => c.table)).not.toContain("care_messages");
    expect(f.calls.find((c) => c.table === "medications")?.filters).toContainEqual(["eq", "patient_id", "p2"]);
  });

  it("reports a failure when the grant cannot be read, rather than an empty answer", async () => {
    const f = fakeClient({ profile_access: { data: null, error: { message: "boom" } } });
    expect(await searchPatientRecord(f.client, ACTING, "amlo")).toEqual({ results: [], failed: true });
  });

  it("reports a failure when any group cannot be read, keeping what did come back", async () => {
    const f = fakeClient({
      medications: { data: null, error: { message: "boom" } },
      care_messages: { data: [{ id: "c1", body: "metformin", created_at: "2026-11-01T10:00:00Z", thread: { subject: "Tablets" } }], error: null },
    });
    const r = await searchPatientRecord(f.client, ME, "metformin");
    expect(r.failed).toBe(true);
    expect(r.results.map((h) => h.group)).toEqual(["Messages"]);
  });
});
