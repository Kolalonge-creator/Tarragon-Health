/**
 * The warning signs ticked on the glucose entry are stored on the server through the offline outbox, the way blood pressure ticks are: one symptom row per
 * sign, as the symptom_type the glucose rules read, idempotent by client id, held offline, never blocking the reading, and never paging through the older
 * symptom trigger on their own (the stored severity stays under its paging line).
 */
import { GLUCOSE_SIGN_SYMPTOM_TYPE, GLUCOSE_SYMPTOMS, type GlucoseSymptomCode } from "@tarragon/clinical";
import { loadGlucoseSymptomChecklist } from "./s07-config";
import { LEVEL_3_SIGNS, planGlucoseSigns, resolveGlucoseSignSeverity, saveGlucoseSigns, SAFE_GLUCOSE_SIGN_SEVERITY } from "./glucose-log";
import { countSyncErrorsSince } from "./sync-diagnostics";
import { symptomLabel } from "./symptoms";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";

const rows: Record<string, unknown>[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        rows.push(row);
        return { error: mockInsertError };
      },
    }),
  },
}));

const WHO = { subjectId: "user-1" };
const SEVERITY = loadGlucoseSymptomChecklist().severity;

beforeEach(async () => {
  rows.length = 0;
  mockInsertError = { code: "42501" };
  await flushOutbox();
  for (const r of await listOutbox()) await discardRejectedRow(r.clientId);
  rows.length = 0;
  mockInsertError = null;
});

describe("the configured severity", () => {
  it("is under both of the older symptom trigger's paging lines (4 for a child under 5, 5 for anyone), so a glucose tick never pages through it", () => {
    expect(SEVERITY).toBeGreaterThanOrEqual(1);
    expect(SEVERITY).toBeLessThan(4);
  });
});

describe("planGlucoseSigns", () => {
  it("plans each ticked sign once, in the engine's order, as the stored symptom type, never rated by the patient", () => {
    const plan = planGlucoseSigns(["vomiting", "seizure", "vomiting", "confusion"], SEVERITY);
    expect(plan.map((p) => p.sign)).toEqual(["confusion", "seizure", "vomiting"]);
    expect(plan.map((p) => p.symptom_type)).toEqual(["confusion", "convulsion", "vomiting"]);
    for (const p of plan) {
      expect(p.severity).toBe(SEVERITY);
      expect(p.description).toMatch(/not rated/i);
    }
  });
  it("drops anything that is not one of the nine signs, and plans nothing for nothing", () => {
    expect(planGlucoseSigns(["headache" as GlucoseSymptomCode], SEVERITY)).toEqual([]);
    expect(planGlucoseSigns([], SEVERITY)).toEqual([]);
  });
  it("covers all nine signs, each as a different stored type", () => {
    const plan = planGlucoseSigns(GLUCOSE_SYMPTOMS, SEVERITY);
    expect(plan.map((p) => p.symptom_type).sort()).toEqual(Object.values(GLUCOSE_SIGN_SYMPTOM_TYPE).sort());
    expect(new Set(plan.map((p) => p.symptom_type)).size).toBe(9);
  });
});

describe("saveGlucoseSigns", () => {
  it("sends one symptom row per sign with the stored type, organisation and patient", async () => {
    const res = await saveGlucoseSigns(["abdominal_pain", "cannot_swallow"], SEVERITY, WHO);
    expect(res).toEqual({ saved: 2, failed: false });
    expect(rows).toHaveLength(0); // durable on the phone first; sending is the screen's flush, not this call
    await flushOutbox();
    expect(rows.map((r) => r.symptom_type)).toEqual(["cannot_swallow", "abdominal_pain"]);
    expect(rows[0]).toMatchObject({ organisation_id: "org-1", patient_id: "user-1", severity: SEVERITY });
    expect(rows.every((r) => typeof r.client_id === "string" && r.client_id !== "")).toBe(true);
    expect(new Set(rows.map((r) => r.client_id)).size).toBe(2);
  });

  it("does nothing, and says nothing failed, when no sign was ticked", async () => {
    expect(await saveGlucoseSigns([], SEVERITY, WHO)).toEqual({ saved: 0, failed: false });
    expect(rows).toHaveLength(0);
    expect(await listOutbox()).toHaveLength(0);
  });

  it("holds the signs on the phone when offline, all in one group, nothing lost", async () => {
    mockInsertError = { message: "Network request failed" };
    const res = await saveGlucoseSigns(["vomiting", "drowsiness"], SEVERITY, WHO);
    expect(res).toEqual({ saved: 2, failed: false });
    const held = await listOutbox();
    expect(held).toHaveLength(2);
    expect(new Set(held.map((h) => h.groupId)).size).toBe(1);
    expect(held.map((h) => h.kind)).toEqual(["symptom", "symptom"]);
  });

  it("marks only the level 3 signs as danger rows, so the one-hour notice applies to them and not to the rest", async () => {
    mockInsertError = { message: "Network request failed" };
    await saveGlucoseSigns(["confusion", "vomiting", "unconscious", "abdominal_pain"], SEVERITY, WHO);
    const byType = Object.fromEntries((await listOutbox()).map((r) => [(r.payload as { symptom_type: string }).symptom_type, r.danger]));
    expect(byType).toEqual({ confusion: true, loss_of_consciousness: true, vomiting: false, abdominal_pain: false });
    expect(LEVEL_3_SIGNS.map((s) => GLUCOSE_SIGN_SYMPTOM_TYPE[s]).sort()).toEqual(["cannot_swallow", "confusion", "convulsion", "loss_of_consciousness"]);
  });

  it("keeps a sign the server refuses on the phone with a support code, not dropped", async () => {
    mockInsertError = { code: "42501", message: "row-level security" };
    const res = await saveGlucoseSigns(["vomiting"], SEVERITY, WHO);
    expect(res).toEqual({ saved: 1, failed: false });
    await flushOutbox();
    const left = await listOutbox();
    expect(left).toHaveLength(1);
    expect(left[0]?.state).toBe("rejected");
  });

  it("stores for a supported person when acting for them", async () => {
    await saveGlucoseSigns(["confusion"], SEVERITY, { subjectId: "dependant-9", beneficiaryProfileId: "dependant-9" });
    await flushOutbox();
    expect(rows[0]).toMatchObject({ patient_id: "dependant-9" });
  });

  it("reports a failure to save on the phone (never throws), so the screen can say so while the reading still saves", async () => {
    const outbox = jest.requireActual("./outbox") as typeof import("./outbox");
    const spy = jest.spyOn(outbox, "enqueueGroup").mockRejectedValueOnce(new Error("disk full"));
    const res = await saveGlucoseSigns(["vomiting"], SEVERITY, WHO);
    expect(res).toEqual({ saved: 0, failed: true });
    spy.mockRestore();
  });
});

describe("history labels", () => {
  it("names the three stored sign types plainly", () => {
    expect(["vomiting", "abdominal_pain", "cannot_swallow"].map((t) => symptomLabel(t as never))).toEqual(["Vomiting", "Stomach pain", "Cannot swallow safely"]);
  });
});

describe("a bad configured severity never fails or loses a reading", () => {
  const cfg = (severity: number) => () => ({ version: 1, severity });
  it("uses a safe configured value as it is", () => {
    expect(resolveGlucoseSignSeverity(cfg(2))).toBe(2);
    expect(resolveGlucoseSignSeverity()).toBe(SEVERITY);
  });
  it.each([4, 5, 8])("falls back to 3 and logs it when the config says %i (the loader refuses it), without throwing", async (bad) => {
    // the real loader throws above 3; model the registry handing it a bad value by letting the loader itself throw
    const throwing = () => {
      throw new Error(`Config glucose.symptom_checklist.severity must be 1 to 3 (got ${bad})`);
    };
    const since = new Date(Date.now() - 1000).toISOString();
    const severity = resolveGlucoseSignSeverity(throwing);
    expect(severity).toBe(SAFE_GLUCOSE_SIGN_SEVERITY);
    expect(countSyncErrorsSince("offline_outbox", since)).toBeGreaterThan(0);
    // the signs are still stored, at 3, so the reading that goes with them is never held back
    expect(await saveGlucoseSigns(["vomiting"], severity, WHO)).toEqual({ saved: 1, failed: false });
    await flushOutbox();
    expect(rows[0]).toMatchObject({ symptom_type: "vomiting", severity: 3 });
  });
  it.each([4, 5, 0, 2.5, Number.NaN])("also refuses a loader that returns %p instead of throwing", (bad) => {
    expect(resolveGlucoseSignSeverity(cfg(bad))).toBe(SAFE_GLUCOSE_SIGN_SEVERITY);
  });
});
