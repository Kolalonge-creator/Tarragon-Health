/**
 * Plan item R2 (CMO Q6 to Q9): the phone's half of glucose triage.
 *
 *  - Device/server parity: the SAME shared fixtures packages/clinical runs on the server (packages/clinical/fixtures/glucose-safety-cases.json)
 *    give exactly the same results through the phone's whole path (rule set from storage, facts from the phone, the 600 ms budget).
 *  - Glucose safety case 1: a severe low reading shows the emergency guidance in under a second with no network at all, through the real
 *    evaluator the quick-log form calls.
 *  - The stricter of the older single-reading check and the engine is shown; the engine only adds while its rule set is a draft.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { expectationWithDefaults, GLUCOSE_CARE_V1, summarise, type GlucoseInput, type GlucoseRuleSet, type ResultSummary } from "@tarragon/clinical";
import { mgDlToMmolL } from "@tarragon/shared";
import { evaluateGlucoseOnDevice } from "./glucose-log";
import {
  CONTEXT_BUDGET_MS,
  gradeGlucoseOnDevice,
  loadGlucoseDeviceRuleSet,
  refreshApprovedGlucoseRuleSet,
  refreshPatientFacts,
  rulesMayBeStale,
} from "./triage-device";

let mockRpc: jest.Mock;
let mockTable: Record<string, { data: unknown; error: { message: string } | null }> = {};
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { organisation_id: "org-1" }, error: null }),
          maybeSingle: async () => mockTable[table] ?? { data: null, error: null },
        }),
      }),
    }),
  },
}));

interface Fixture {
  id: string;
  title: string;
  input: GlucoseInput;
  expect: Partial<ResultSummary>;
}
const fixtures: { cases: Fixture[] } = JSON.parse(readFileSync(join(__dirname, "../../../../packages/clinical/fixtures/glucose-safety-cases.json"), "utf8"));

const SUBJECT = "user-1";
const FACTS_KEY = `@tarragon/triage/facts/v1:${SUBJECT}`;
const RULES_KEY = "@tarragon/triage/rules/glucose/v1";

beforeEach(async () => {
  mockRpc = jest.fn(async () => ({ data: null, error: null }));
  mockTable = {};
  await AsyncStorage.removeItem(RULES_KEY);
  await AsyncStorage.removeItem(FACTS_KEY);
});

/** The facts the phone keeps (date of birth, pregnancy, diabetes type) for a fixture, as refreshPatientFacts stores them. */
async function seedFacts(input: GlucoseInput, nowMs: number): Promise<void> {
  const dob = input.ageYears === null ? null : `${new Date(nowMs).getUTCFullYear() - input.ageYears}-01-01`;
  await AsyncStorage.setItem(FACTS_KEY, JSON.stringify({ dateOfBirth: dob, pregnant: input.pregnant, diabetesType: input.diabetesType }));
}

describe("device/server parity on the shared glucose fixtures", () => {
  it("loads the shared fixtures", () => expect(fixtures.cases.length).toBeGreaterThan(40));

  // Not on the device path: a task already open is a server fact (existingOpenTaskKeys), and the phone creates no task.
  const onDevice = fixtures.cases.filter((c) => c.input.existingOpenTaskKeys === undefined);

  it.each(onDevice.map((c) => [c.id, c] as const))("%s gives the fixture result through the whole phone path", async (_id, c) => {
    const nowMs = Date.parse(c.input.now);
    await seedFacts(c.input, nowMs);
    const triage = await gradeGlucoseOnDevice({
      subjectId: SUBJECT,
      mmol: c.input.trigger.reading.mmol,
      context: c.input.trigger.reading.context,
      ketoneBloodMmol: c.input.trigger.ketones?.bloodMmol ?? null,
      ketoneUrine: c.input.trigger.ketones?.urine ?? null,
      symptoms: c.input.trigger.symptoms,
      nowMs,
    });
    expect(summarise(triage.result)).toEqual(expectationWithDefaults(c.expect));
    expect(triage.ruleSet).toEqual({ code: "glucose_care_triage", version: 1, status: "draft" });
  });
});

describe("glucose safety case 1: a severe low shows guidance in under a second with no network", () => {
  it("2.6 mmol/L, everything offline, through the evaluator the quick-log form calls", async () => {
    mockRpc = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    const started = Date.now();
    const outcome = await evaluateGlucoseOnDevice({ value: 2.6, unit: "mmol_l", context: "fasting", symptoms: [], subjectId: SUBJECT });
    const ms = Date.now() - started;
    expect(ms).toBeLessThan(1000);
    expect(outcome.severity).toBe("emergency");
    expect(outcome.device?.result).toMatchObject({ status: "graded", grade: "red", ruleId: "GL-R1" });
    expect(outcome.device?.emergencyCode).toBe("GLU-E01");
    expect(outcome.device?.result.actions).toContainEqual({ kind: "page_on_call" });
    expect(outcome.device?.message).toEqual({ title: "triage.glu_e01.title", body: "triage.glu_e01.body" });
  });

  it("50 mg/dL is converted with the shared conversion and is red too", async () => {
    expect(mgDlToMmolL(50)).toBeLessThan(3.0);
    const outcome = await evaluateGlucoseOnDevice({ value: 50, unit: "mg_dl", context: "night", symptoms: [], subjectId: SUBJECT });
    expect(outcome.severity).toBe("emergency");
    expect(outcome.device?.result.ruleId).toBe("GL-R1");
  });

  it("still answers inside a second when the phone's own storage hangs", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockImplementation(() => new Promise(() => {}));
    try {
      const started = Date.now();
      const triage = await gradeGlucoseOnDevice({ subjectId: SUBJECT, mmol: 2.4, context: "random", symptoms: [] });
      const ms = Date.now() - started;
      expect(ms).toBeLessThan(1000);
      expect(ms).toBeGreaterThanOrEqual(CONTEXT_BUDGET_MS - 50);
      expect(triage.result.grade).toBe("red");
      expect(triage.severity).toBe("emergency");
    } finally {
      spy.mockRestore();
    }
  });

  it("a ticked level 3 sign shows the guidance even for a normal reading and with a reading that cannot be graded", async () => {
    const normal = await evaluateGlucoseOnDevice({ value: 6, unit: "mmol_l", context: "random", symptoms: ["seizure"], subjectId: SUBJECT });
    expect(normal.severity).toBe("emergency");
    expect(normal.signFlag).toBe(true);
    // 0.2 mmol/L cannot be right, so the engine rejects it, but a ticked sign still shows guidance.
    const rejected = await evaluateGlucoseOnDevice({ value: 0.2, unit: "mmol_l", context: "random", symptoms: ["confusion"], subjectId: SUBJECT });
    expect(rejected.device?.result.status).toBe("rejected");
    expect(rejected.severity).toBe("emergency");
    expect(rejected.device?.emergencyCode).toBe("GLU-E02");
  });
});

describe("the stricter of the older check and the engine", () => {
  it("20.0 is urgent by the older check and amber by the engine: an urgent banner and the engine's card, no takeover", async () => {
    const o = await evaluateGlucoseOnDevice({ value: 20, unit: "mmol_l", context: "random", symptoms: [], subjectId: SUBJECT });
    expect(o.severity).toBe("urgent");
    expect(o.legacy?.severity).toBe("urgent");
    expect(o.device?.result).toMatchObject({ grade: "amber", ruleId: "GL-A3" });
    expect(o.device?.message?.body).toBe("triage.glu_t03.body");
  });

  it("ketones the older check never sees are added by the engine: raised ketones with vomiting is an emergency", async () => {
    const o = await evaluateGlucoseOnDevice({ value: 9, unit: "mmol_l", context: "random", ketoneBloodMmol: 2.0, symptoms: ["vomiting"], subjectId: SUBJECT });
    expect(o.legacy).toBeNull();
    expect(o.severity).toBe("emergency");
    expect(o.device?.result.ruleId).toBe("GL-R5");
  });

  it("raised ketones without signs add a card and no banner and no takeover", async () => {
    const o = await evaluateGlucoseOnDevice({ value: 9, unit: "mmol_l", context: "random", ketoneBloodMmol: 2.0, symptoms: [], subjectId: SUBJECT });
    expect(o.severity).toBeNull();
    expect(o.device?.result.ruleId).toBe("GL-A2");
  });

  it("level 1 (3.5) is urgent by the older check and carries the fast-sugar message from the engine", async () => {
    const o = await evaluateGlucoseOnDevice({ value: 3.5, unit: "mmol_l", context: "pre_meal", symptoms: [], subjectId: SUBJECT });
    expect(o.severity).toBe("urgent");
    expect(o.device?.result.ruleId).toBe("GL-A1");
    expect(o.device?.message?.body).toBe("triage.glu_t01.body");
  });

  it("a failure in the engine does not hide the older check", async () => {
    const spy = jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("storage broke"));
    try {
      const o = await evaluateGlucoseOnDevice({ value: 2.5, unit: "mmol_l", context: "random", symptoms: [], subjectId: SUBJECT });
      expect(o.severity).toBe("emergency");
    } finally {
      spy.mockRestore();
    }
  });

  it("a normal reading says nothing alarming", async () => {
    const o = await evaluateGlucoseOnDevice({ value: 5.4, unit: "mmol_l", context: "fasting", symptoms: [], subjectId: SUBJECT });
    expect(o.severity).toBeNull();
    expect(o.device?.result.grade).toBe("green");
  });
});

describe("the phone's glucose rule set and facts", () => {
  it("uses the bundled draft until the CMO approves one", async () => {
    const r = await loadGlucoseDeviceRuleSet();
    expect(r.status).toBe("draft");
    expect(r.ruleSet.version).toBe(1);
  });

  it("an approved set cached from the server wins; an invalid cached set is ignored", async () => {
    const approved: GlucoseRuleSet = { ...GLUCOSE_CARE_V1, version: 2, status: "approved" };
    mockRpc = jest.fn(async () => ({ data: { rules: approved }, error: null }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("updated");
    expect(await refreshApprovedGlucoseRuleSet()).toBe("unchanged");
    expect(await loadGlucoseDeviceRuleSet()).toMatchObject({ status: "approved", ruleSet: { version: 2 } });
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify({ code: "glucose_care_triage", version: 3, rules: [] }));
    expect((await loadGlucoseDeviceRuleSet()).status).toBe("draft");
    await AsyncStorage.setItem(RULES_KEY, "not json");
    expect((await loadGlucoseDeviceRuleSet()).status).toBe("draft");
  });

  it("a rule set the engine would refuse is never stored, a server error keeps the old copy, and nothing approved drops the cached copy", async () => {
    mockRpc = jest.fn(async () => ({ data: { rules: { code: "glucose_care_triage", version: 9, rules: [] } }, error: null }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("failed");
    expect(await AsyncStorage.getItem(RULES_KEY)).toBeNull();
    mockRpc = jest.fn(async () => ({ data: null, error: { message: "boom" } }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("failed");
    mockRpc = jest.fn(async () => {
      throw new Error("offline");
    });
    expect(await refreshApprovedGlucoseRuleSet()).toBe("failed");
    await AsyncStorage.setItem(RULES_KEY, JSON.stringify(GLUCOSE_CARE_V1));
    mockRpc = jest.fn(async () => ({ data: null, error: null }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("none_approved");
    expect(await AsyncStorage.getItem(RULES_KEY)).toBeNull();
  });

  it("refreshing the glucose rule set does not touch the blood pressure rules' last-checked time (the stale warning stays honest)", async () => {
    await AsyncStorage.removeItem("@tarragon/triage/rules-checked/v1");
    mockRpc = jest.fn(async () => ({ data: { rules: { ...GLUCOSE_CARE_V1, version: 4, status: "approved" } }, error: null }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("updated");
    expect(await AsyncStorage.getItem("@tarragon/triage/rules-checked/v1")).toBeNull();
    expect(await rulesMayBeStale()).toBe(true);
    mockRpc = jest.fn(async () => ({ data: null, error: null }));
    expect(await refreshApprovedGlucoseRuleSet()).toBe("none_approved");
    expect(await AsyncStorage.getItem("@tarragon/triage/rules-checked/v1")).toBeNull();
  });

  it("the diabetes type is kept with the other facts: the confirmed type first, else the reported one", async () => {
    mockTable = {
      profiles: { data: { date_of_birth: "1980-05-01" }, error: null },
      patient_pregnancy: { data: { is_pregnant: false }, error: null },
      patient_diabetes_profile: { data: { confirmed_type: null, patient_reported_type: "type_1" }, error: null },
    };
    expect(await refreshPatientFacts(SUBJECT)).toBe("updated");
    expect(JSON.parse((await AsyncStorage.getItem(FACTS_KEY)) ?? "{}")).toMatchObject({ diabetesType: "type_1" });
    mockTable["patient_diabetes_profile"] = { data: { confirmed_type: "gestational", patient_reported_type: "type_1" }, error: null };
    await refreshPatientFacts(SUBJECT);
    expect(JSON.parse((await AsyncStorage.getItem(FACTS_KEY)) ?? "{}")).toMatchObject({ diabetesType: "gestational" });
    // Gestational diabetes is routed to a clinician (GL-P3), not graded as type 1 or 2.
    const triage = await gradeGlucoseOnDevice({ subjectId: SUBJECT, mmol: 6, context: "random", symptoms: [] });
    expect(triage.result.ruleId).toBe("GL-P3");
  });

  it("a stale facts copy from before this feature still grades (no diabetes type means an adult grade)", async () => {
    await AsyncStorage.setItem(FACTS_KEY, JSON.stringify({ dateOfBirth: "1980-05-01", pregnant: false }));
    const triage = await gradeGlucoseOnDevice({ subjectId: SUBJECT, mmol: 6, context: "random", symptoms: [] });
    expect(triage.result.grade).toBe("green");
  });
});
