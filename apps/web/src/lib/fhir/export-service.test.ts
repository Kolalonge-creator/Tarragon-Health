import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { exportFhirBundle } from "./export-service";
import { fixtureSnapshot } from "./test-fixtures";

function client(reply: { data: unknown; error: { message: string } | null }) {
  const rpc = jest.fn<(name: string, args: Record<string, unknown>) => Promise<typeof reply>>().mockResolvedValue(reply);
  return { supabase: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const PATIENT = "11111111-1111-4111-8111-111111111111";

describe("exportFhirBundle", () => {
  it("builds a Bundle from the database's snapshot and reports what was included and refused", async () => {
    const { supabase, rpc } = client({ data: fixtureSnapshot({ sections_refused: ["medications"] }), error: null });
    const out = await exportFhirBundle(supabase, { patientId: PATIENT, sections: ["vitals", "medications"] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.resourceCount).toBeGreaterThan(5);
    expect(out.sectionsRefused).toEqual(["medications"]);
    expect(out.mappingVersion).toBe(1);
    expect(rpc).toHaveBeenCalledWith("fhir_export_snapshot", { p_patient: PATIENT, p_sections: ["vitals", "medications"], p_reason: undefined });
  });

  it("answers 403 without saying whether the person exists when the database denies", async () => {
    const { supabase } = client({ data: { status: "denied" }, error: null });
    expect(await exportFhirBundle(supabase, { patientId: PATIENT })).toEqual({ ok: false, status: 403, error: "Not permitted" });
  });

  it("rejects a section that is not in the closed list before asking the database (reproductive and mental health cannot be named)", async () => {
    const { supabase, rpc } = client({ data: null, error: null });
    for (const s of ["reproductive_health", "mental_health", "everything"]) {
      expect(await exportFhirBundle(supabase, { patientId: PATIENT, sections: [s] })).toEqual({ ok: false, status: 400, error: "unknown section" });
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns the database's reason rule into a 400 and any other failure into a plain 500", async () => {
    expect(await exportFhirBundle(client({ data: null, error: { message: "a reason of at least 10 characters is required" } }).supabase, { patientId: PATIENT })).toMatchObject({ status: 400 });
    expect(await exportFhirBundle(client({ data: null, error: { message: "relation x does not exist" } }).supabase, { patientId: PATIENT })).toEqual({
      ok: false,
      status: 500,
      error: "The export could not be made.",
    });
  });

  it("refuses to map a reply that is not the snapshot shape", async () => {
    const { supabase } = client({ data: { status: "ok", surprise: true }, error: null });
    expect(await exportFhirBundle(supabase, { patientId: PATIENT })).toMatchObject({ ok: false, status: 500 });
  });
});
