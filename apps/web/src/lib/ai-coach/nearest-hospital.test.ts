/**
 * Review round (S52): hospitals are ranked BEFORE any cap. The patient's own city is asked for by name, so a long alphabetical list for the
 * state can never cut it off.
 */
import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { loadEmergencyContext } from "./nearest-hospital";

type Row = { name: string; city: string | null; address: string | null; contact_phone: string | null; verified: boolean; state: string };

function supabaseWith(stateRows: Row[], profile: { state: string; city: string }) {
  const reads: string[] = [];
  const from = jest.fn((table: string) => {
    if (table === "profiles") {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { ...profile, emergency_contact_name: null, emergency_contact_phone: null }, error: null }) };
      return q;
    }
    const filters: Record<string, string> = {};
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      ilike: (col: string, v: string) => {
        filters[col] = v;
        return q;
      },
      order: () => q,
      limit: async (n: number) => {
        reads.push(filters.city ? `city:${filters.city}` : `state:limit${n}`);
        const rows = filters.city ? stateRows.filter((r) => (r.city ?? "").toLowerCase() === filters.city.toLowerCase()) : stateRows.slice(0, 2);
        return { data: rows, error: null };
      },
    };
    return q;
  });
  return { supabase: { from } as unknown as SupabaseClient<Database>, reads };
}

const row = (name: string, city: string, verified = false): Row => ({ name, city, address: null, contact_phone: null, verified, state: "Lagos" });

describe("the nearest hospital reader", () => {
  it("finds the patient's own city even when the state list is long and the city sorts last", async () => {
    const many = Array.from({ length: 40 }, (_, i) => row(`A Hospital ${i}`, "Epe"));
    const { supabase, reads } = supabaseWith([...many, row("Zed General", "Ikeja")], { state: "Lagos State", city: "Ikeja" });
    const ctx = await loadEmergencyContext(supabase, "p1");
    expect(ctx.hospitals[0]?.name).toBe("Zed General");
    expect(reads).toContain("city:Ikeja");
  });

  it("with no city on file it still returns the state's hospitals", async () => {
    const { supabase } = supabaseWith([row("B", "Epe"), row("A", "Epe")], { state: "Lagos", city: "" });
    const ctx = await loadEmergencyContext(supabase, "p1");
    expect(ctx.hospitals.length).toBeGreaterThan(0);
  });
});
