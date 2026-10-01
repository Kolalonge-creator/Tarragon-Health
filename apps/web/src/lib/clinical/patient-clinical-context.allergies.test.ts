import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";

jest.mock("./audited-chart", () => ({ readAuditedSection: jest.fn() }));
import { readAuditedSection } from "./audited-chart";
import { loadMedicationSafety } from "./patient-clinical-context";

// A chainable stand-in for the PostgREST builder: every method returns the builder, and awaiting it yields empty data.
function emptyClient() {
  const builder: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
      if (prop === "maybeSingle" || prop === "single") return () => Promise.resolve({ data: null, error: null });
      return () => proxy;
    },
  });
  return { from: () => proxy, rpc: () => Promise.resolve({ data: null, error: null }) } as unknown as SupabaseClient<Database>;
}

const mockRead = readAuditedSection as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>;

describe("loadMedicationSafety allergies go through the audited read (INV-10)", () => {
  it("lists the recorded allergies from the chart section", async () => {
    mockRead.mockResolvedValueOnce({
      status: "ok",
      rows: [
        { id: "a2", substance: "sulfa", reaction: "rash", severity: "mild", source: "patient" },
        { id: "a1", substance: "penicillin", reaction: "hives", severity: "severe", source: "clinician" },
      ],
    });
    const view = await loadMedicationSafety(emptyClient(), "p1");
    expect(view.allergiesUnavailable).toBeNull();
    expect(view.allergies.map((a) => a.allergen)).toEqual(["penicillin", "sulfa"]);
    expect(mockRead).toHaveBeenCalledWith(expect.anything(), "p1", "allergies");
  });

  it.each(["denied", "error"] as const)("a %s read is unavailable, not 'no allergies'", async (status) => {
    mockRead.mockResolvedValueOnce(status === "denied" ? { status } : { status, message: "x" });
    const view = await loadMedicationSafety(emptyClient(), "p1");
    expect(view.allergiesUnavailable).toBe(status);
    expect(view.allergies).toEqual([]);
    // the engine was told the allergy list was never loaded, so its own caveat says the check did not run
    expect(view.report.allergyCheckNote).toMatch(/./);
  });
});
