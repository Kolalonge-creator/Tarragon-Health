/**
 * S07: saving a blood pressure log with its pulse and ticked symptoms. What
 * matters most: nothing the patient entered is lost, a red-flag symptom is
 * never queued behind the reading, and guidance never depends on the network
 * or on the save succeeding.
 */
import { NETWORK_ERROR_MESSAGE, postVitalReading, type VitalReadingPayload } from "./api";
import { planBpLog, type BpLogInput } from "./bp-checklist";
import { evaluateOnDevice, logBpWithExtras, type TriageEvaluator } from "./bp-log";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";
import { classifyVitalOffline } from "./vitals";

const order: string[] = [];
const symptomRows: Record<string, unknown>[] = [];
let mockInsertError: { code?: string; message?: string } | null = null;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async (row: Record<string, unknown>) => {
        order.push(table);
        symptomRows.push(row);
        return { error: mockInsertError };
      },
    }),
  },
}));

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn(),
}));
jest.mock("./vitals", () => {
  const actual = jest.requireActual("./vitals") as typeof import("./vitals");
  return { ...actual, classifyVitalOffline: jest.fn(actual.classifyVitalOffline) };
});
const mockClassify = classifyVitalOffline as jest.MockedFunction<typeof classifyVitalOffline>;
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;
const posted: VitalReadingPayload[] = [];

const SEVERITY = 6;
const plan = (over: Partial<BpLogInput> = {}) => {
  const p = planBpLog({ systolic: "150", diastolic: "95", pulse: "", symptoms: [], ...over }, SEVERITY);
  if (!p.ok) throw new Error("bad fixture");
  return p;
};

beforeEach(async () => {
  order.length = 0;
  posted.length = 0;
  symptomRows.length = 0;
  mockInsertError = null;
  mockPost.mockReset();
  mockPost.mockImplementation(async (payload) => {
    order.push(payload.vital_type);
    posted.push(payload);
    return { success: true };
  });
  // Start each test with an empty outbox: send what can be sent, discard what the server refuses.
  mockInsertError = { code: "42501" };
  await flushOutbox();
  for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  order.length = 0;
  symptomRows.length = 0;
  mockInsertError = null;
});

describe("logBpWithExtras cuff type", () => {
  it("sends the cuff type with the reading, and nothing when it was skipped", async () => {
    await logBpWithExtras(plan({ cuffType: "wrist" }));
    expect(posted[0]).toMatchObject({ vital_type: "blood_pressure", cuff_type: "wrist" });
    posted.length = 0;
    await logBpWithExtras(plan());
    expect(posted[0]).not.toHaveProperty("cuff_type");
  });
});

describe("logBpWithExtras", () => {
  it("saves and sends just the reading when nothing optional is given", async () => {
    const res = await logBpWithExtras(plan());
    expect(res).toMatchObject({ saved: 1, syncedAll: true, remaining: 0 });
    expect(order).toEqual(["blood_pressure"]);
  });

  it("saves the reading, a companion pulse and each ticked symptom, symptoms first", async () => {
    const res = await logBpWithExtras(plan({ pulse: "88", symptoms: ["dizziness", "chest_pain"] }));
    expect(res).toMatchObject({ saved: 4, syncedAll: true });
    expect(order).toEqual(["symptoms", "symptoms", "blood_pressure", "pulse"]);
    expect(posted[1]).toEqual({ vital_type: "pulse", pulse_bpm: 88 });
    expect(symptomRows.map((r) => r.symptom_type)).toEqual(["chest_pain", "dizziness"]);
    expect(symptomRows[0]).toMatchObject({ severity: 6, patient_id: "user-1" });
    expect(String(symptomRows[0]?.description)).toMatch(/not rated/i);
  });

  it("keeps everything on the phone when offline, and reports it plainly", async () => {
    mockPost.mockImplementation(async () => ({ success: false, error: NETWORK_ERROR_MESSAGE }));
    mockInsertError = { message: "Network request failed" };
    const res = await logBpWithExtras(plan({ pulse: "88", symptoms: ["chest_pain"] }));
    expect(res.error).toBeUndefined();
    expect(res).toMatchObject({ saved: 3, syncedAll: false, remaining: 3 });
    const rows = await listOutbox();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.groupId)).size).toBe(1);
  });

  it("shows emergency guidance for a red-flag tick even when the reading is normal and the network is down", async () => {
    mockPost.mockImplementation(async () => ({ success: false, error: NETWORK_ERROR_MESSAGE }));
    mockInsertError = { message: "Network request failed" };
    const res = await logBpWithExtras(plan({ systolic: "118", diastolic: "76", symptoms: ["severe_headache"] }));
    expect(res.outcome).toMatchObject({ severity: "emergency", symptomFlag: true, bpFlag: null });
  });

  it("does not show guidance for dizziness or palpitations alone", async () => {
    const res = await logBpWithExtras(plan({ systolic: "118", diastolic: "76", symptoms: ["dizziness", "palpitations"] }));
    expect(res.outcome).toMatchObject({ severity: null, symptomFlag: false });
  });

  it("flags a crisis-range reading from the blood pressure check and records the threshold version", async () => {
    const res = await logBpWithExtras(plan({ systolic: "210", diastolic: "125" }));
    expect(res.outcome.severity).toBe("emergency");
    expect(res.outcome.bpFlag?.severity).toBe("emergency");
    expect(res.outcome.thresholdVersion).not.toBe("unavailable");
  });

  it("marks danger rows so the one-hour notice applies to them, and not to the rest", async () => {
    mockPost.mockImplementation(async () => ({ success: false, error: NETWORK_ERROR_MESSAGE }));
    mockInsertError = { message: "Network request failed" };
    await logBpWithExtras(plan({ systolic: "210", diastolic: "125", pulse: "90", symptoms: ["chest_pain", "dizziness"] }));
    const rows = await listOutbox();
    const byKey = Object.fromEntries(
      rows.map((r) => [
        r.kind === "symptom" ? (r.payload as { symptom_type: string }).symptom_type : (r.payload as VitalReadingPayload).vital_type,
        r.danger,
      ]),
    );
    expect(byKey).toEqual({ chest_pain: true, dizziness: false, blood_pressure: true, pulse: false });
  });

  it("keeps a ticked red flag even when the evaluator itself fails", async () => {
    const broken: TriageEvaluator = async () => {
      throw new Error("threshold cache unreadable");
    };
    const res = await logBpWithExtras(plan({ symptoms: ["chest_pain"] }), undefined, broken);
    expect(res.outcome).toMatchObject({ severity: "emergency", symptomFlag: true });
    expect(res).toMatchObject({ saved: 2, syncedAll: true });
  });

  it("still shows the red-flag guidance when only the blood pressure check fails", async () => {
    mockClassify.mockRejectedValueOnce(new Error("boom"));
    const out = await evaluateOnDevice({ systolic: 120, diastolic: 80, redFlagTicked: ["confusion"] });
    expect(out).toMatchObject({ severity: "emergency", symptomFlag: true, bpFlag: null });
  });

  it("never lets a failing triage stand between the patient and a saved reading", async () => {
    const broken: TriageEvaluator = async () => {
      throw new Error("threshold cache unreadable");
    };
    const res = await logBpWithExtras(plan(), undefined, broken);
    expect(res).toMatchObject({ saved: 1, syncedAll: true });
    expect(res.outcome.severity).toBeNull();
  });

  it("reports the triage outcome before anything is sent, so guidance never waits on the network", async () => {
    const seen: { severity: string | null; postsSoFar: number }[] = [];
    await logBpWithExtras(plan({ symptoms: ["chest_pain"] }), undefined, undefined, (o) => {
      seen.push({ severity: o.severity, postsSoFar: posted.length + order.length });
    });
    expect(seen).toEqual([{ severity: "emergency", postsSoFar: 0 }]);
  });

  it("keeps a refused member on the phone with a support code while the rest go through", async () => {
    mockInsertError = { code: "42501", message: "row-level security" };
    const res = await logBpWithExtras(plan({ symptoms: ["chest_pain"] }));
    expect(res).toMatchObject({ saved: 2, syncedAll: false, remaining: 1 });
    expect(res.rejectedSupportCodes).toHaveLength(1);
    expect(order).toContain("blood_pressure"); // the reading still reached the server
  });

  it("logs for a supported person when acting for them, on every row", async () => {
    await logBpWithExtras(plan({ pulse: "80", symptoms: ["confusion"] }), "dependant-9");
    expect(symptomRows[0]).toMatchObject({ patient_id: "dependant-9" });
    const bodies = mockPost.mock.calls.map((c) => c[1]);
    expect(bodies).toEqual(["dependant-9", "dependant-9"]);
  });
});

describe("evaluateOnDevice (version 1 of the triage hook)", () => {
  it("adds no rule beyond the existing blood pressure check and the red-flag ticks", async () => {
    const calm = await evaluateOnDevice({ systolic: 120, diastolic: 80, redFlagTicked: [] });
    expect(calm).toMatchObject({ severity: null, bpFlag: null, symptomFlag: false });
    const urgent = await evaluateOnDevice({ systolic: 165, diastolic: 102, redFlagTicked: [] });
    expect(urgent.severity).toBe("urgent");
  });
});
