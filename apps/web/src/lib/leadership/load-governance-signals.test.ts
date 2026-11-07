import { loadGovernanceSignals } from "./load-governance-signals";

type Result = { data: unknown[] | null; error: unknown; count: number | null };

/** A query builder stub: every filter returns the same chain, and awaiting it yields the table's configured result. */
function client(results: Record<string, Result>) {
  const calls: Record<string, string[]> = {};
  const from = (table: string) => {
    calls[table] = [];
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "neq", "not", "or", "order", "limit", "returns"]) {
      chain[m] = (...args: unknown[]) => {
        calls[table]!.push(`${m}:${JSON.stringify(args)}`);
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown) => resolve(results[table]!);
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from } as any, calls };
}

const ok = (data: unknown[], count: number): Result => ({ data, error: null, count });

describe("loadGovernanceSignals", () => {
  it("maps open rows, uses the exact count, and never selects a free-text description", async () => {
    const { supabase, calls } = client({
      clinical_incident_reports: ok(
        [{ id: "i1", category: "other", severity: "high", status: "open", reported_at: "2026-11-01T00:00:00Z", reviewer: null }],
        250
      ),
      safeguarding_concerns: ok(
        [{ id: "s1", concern_category: "neglect", status: "open", reported_at: "2026-11-01T00:00:00Z", reviewer: { full_name: "Dr B" } }],
        1
      ),
      complaints: ok([], 0),
    });
    const s = await loadGovernanceSignals(supabase, ["test-patient"]);
    expect(s.totals).toEqual({ incidents: 250, safeguarding: 1, complaints: 0 });
    expect(s.safeguarding?.[0]?.reviewer_name).toBe("Dr B");
    for (const table of Object.keys(calls)) {
      const select = calls[table]!.find((c) => c.startsWith("select:")) ?? "";
      expect(select).not.toContain("description");
      expect(select).toContain('"count":"exact"');
      // INV-13: test patients are excluded from every list.
      expect(calls[table]!.some((c) => c.includes("test-patient"))).toBe(true);
    }
  });

  it("reports a failed read as unknown, never as an empty list or a zero count", async () => {
    const { supabase } = client({
      clinical_incident_reports: { data: null, error: { message: "denied" }, count: null },
      safeguarding_concerns: ok([], 0),
      complaints: { data: null, error: { message: "timeout" }, count: null },
    });
    const s = await loadGovernanceSignals(supabase, []);
    expect(s.incidents).toBeNull();
    expect(s.complaints).toBeNull();
    expect(s.totals).toEqual({ incidents: null, safeguarding: 0, complaints: null });
  });
});
