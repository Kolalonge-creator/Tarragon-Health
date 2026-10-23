/**
 * S07y: logVital with the "taken at a pharmacy or clinic machine" label. The label rides on an ordinary manual blood pressure reading, so the same
 * insert, the same safety assessment and the same acknowledgement run. If the label's guard turns out to be closed (a stale page), the reading is NOT lost:
 * it is saved as an ordinary reading with the setting kept in its note, exactly as before the label existed, and the person is told.
 */
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/acting/acting-for", () => ({
  resolveSubjectId: jest.fn(async (id: string) => id),
  assertNotActingFor: jest.fn(),
}));
const assessBp = jest.fn();
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: (...a: unknown[]) => assessBp(...a) }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn() }));
jest.mock("@/lib/lifestyle/weekly-plan-progress", () => ({ recordWeeklyPlanProgress: jest.fn() }));

const inserted: Record<string, unknown>[] = [];
let insertErrors: ({ code: string; message: string } | null)[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "patient-1" } } }) },
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      if (table === "platform_modules") return { select: () => ({ in: async () => ({ data: [], error: null }) }) };
      if (table === "vitals_readings") {
        return {
          insert: (row: Record<string, unknown>) => {
            inserted.push(row);
            const error = insertErrors.shift() ?? null;
            const result = { error, data: null };
            return { then: (resolve: (r: typeof result) => unknown) => Promise.resolve(result).then(resolve), select: async () => ({ error, data: error ? null : [{ id: "v1" }] }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { logVital } from "./actions";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

beforeEach(() => {
  inserted.length = 0;
  insertErrors = [];
  assessBp.mockReset().mockResolvedValue(undefined);
});

describe("logVital: taken at a pharmacy or clinic machine", () => {
  const base = { vital_type: "blood_pressure", systolic: "148", diastolic: "92" };

  it("saves the label and the place with an ordinary manual reading, and runs the blood pressure assessment", async () => {
    const out = await logVital(undefined, fd({ ...base, entry_origin: "pharmacy_machine", place_label: "  Corner   Pharmacy " }));
    expect(out).toMatchObject({ success: true });
    expect(out?.notice).toBeUndefined();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ vital_type: "blood_pressure", systolic: 148, entry_origin: "pharmacy_machine", place_label: "Corner Pharmacy", patient_id: "patient-1", organisation_id: "org-1" });
    expect(inserted[0]).not.toHaveProperty("source");
    expect(assessBp).toHaveBeenCalledTimes(1);
  });

  it("an ordinary reading carries no label", async () => {
    await logVital(undefined, fd(base));
    expect(inserted[0]?.entry_origin ?? null).toBeNull();
  });

  it("a closed guard (55000) never loses the reading: it is saved as an ordinary one with the setting in its note, assessed, and the person is told", async () => {
    insertErrors = [{ code: "55000", message: "this kind of reading is not switched on yet (pharmacy_bp_readings)" }, null];
    const out = await logVital(undefined, fd({ ...base, systolic: "188", diastolic: "118", entry_origin: "pharmacy_machine", place_label: "Corner", note: "after a walk" }));
    expect(out).toMatchObject({ success: true });
    expect(out?.notice).toMatch(/not switched on yet/);
    expect(inserted).toHaveLength(2);
    const retry = inserted[1] as Record<string, unknown>;
    expect(retry).toMatchObject({ vital_type: "blood_pressure", systolic: 188, diastolic: 118 });
    expect(retry.entry_origin).toBeUndefined();
    expect(retry.place_label).toBeUndefined();
    expect(retry.note).toBe("Taken at a pharmacy or clinic machine. (Corner) after a walk");
    expect(assessBp).toHaveBeenCalledTimes(1);
  });

  it("a 55000 that is NOT the label guard's refusal (another trigger raised it) is an ordinary failure, never a retry without the label", async () => {
    insertErrors = [{ code: "55000", message: "event bus has no active config" }];
    const out = await logVital(undefined, fd({ ...base, entry_origin: "pharmacy_machine" }));
    expect(out?.error).toBe("event bus has no active config");
    expect(inserted).toHaveLength(1);
  });

  it("a 55000 for any other reading is an ordinary failure, with no retry", async () => {
    insertErrors = [{ code: "55000", message: "event bus has no active config" }];
    const out = await logVital(undefined, fd({ vital_type: "weight", weight_kg: "70" }));
    expect(out?.error).toBe("event bus has no active config");
    expect(inserted).toHaveLength(1);
  });

  it("when the retry without the label also fails, that failure is the answer and nothing is assessed", async () => {
    insertErrors = [{ code: "55000", message: "this kind of reading is not switched on yet (pharmacy_bp_readings)" }, { code: "XX000", message: "db down" }];
    const out = await logVital(undefined, fd({ ...base, entry_origin: "pharmacy_machine" }));
    expect(out?.error).toBe("db down");
    expect(assessBp).not.toHaveBeenCalled();
  });
});
