/**
 * S11d: the emergency-symptom question for a reading of 200/130 or more (CMO decision, rule BP-X1, text TRI-008):
 * what the engine asks, what each answer does, what is saved, and when the phone shows the question at all.
 */
import { en } from "@tarragon/i18n";
import { Constants } from "@tarragon/shared";
import { BP_CARE_V1 } from "@tarragon/clinical";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { postVitalReading } from "./api";
import { evaluateOnDevice } from "./bp-log";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";
import { QUESTION_NOTE, QUESTION_SEVERITY, QUESTION_SYMPTOMS, answerSymptomQuestion } from "./symptom-question";
import {
  clearPendingRecheck,
  gradeOnDevice,
  readPendingRecheck,
  shouldAskSymptomQuestion,
} from "./triage-device";

let mockInsertError: { code?: string; message?: string } | null = null;
let mockRpc: jest.Mock;
let mockMirror: () => Promise<unknown[]>;

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => ({ error: mockInsertError }),
    }),
  },
}));
let mockEnqueueFail = false;
jest.mock("./outbox", () => {
  const actual = jest.requireActual("./outbox") as typeof import("./outbox");
  return { ...actual, enqueueGroup: (...args: Parameters<typeof actual.enqueueGroup>) => (mockEnqueueFail ? Promise.reject(new Error("disk full")) : actual.enqueueGroup(...args)) };
});
jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn() }));
jest.mock("./offline-store", () => ({
  ...(jest.requireActual("./offline-store") as object),
  readLocalRecords: () => mockMirror(),
}));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const SUBJECT = "user-1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
beforeEach(async () => {
  mockInsertError = null;
  mockRpc = jest.fn(async () => ({ data: null, error: null }));
  mockMirror = async () => [];
  mockPost.mockReset();
  mockPost.mockImplementation(async () => ({ success: true }));
  mockInsertError = { code: "42501" };
  await flushOutbox();
  for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  mockInsertError = null;
  await clearPendingRecheck(SUBJECT);
  await AsyncStorage.removeItem("@tarragon/triage/rules/v1");
});

const approve = () => AsyncStorage.setItem("@tarragon/triage/rules/v1", JSON.stringify({ ...BP_CARE_V1, status: "approved" }));
const grade = (over: Partial<Parameters<typeof gradeOnDevice>[0]> = {}) =>
  gradeOnDevice({ subjectId: SUBJECT, systolic: 205, diastolic: 100, symptoms: [], nowMs: NOW, ...over });

describe("the question list", () => {
  it("is exactly the engine's red-flag group, every item can be stored and has a label in both languages", () => {
    expect([...QUESTION_SYMPTOMS].sort()).toEqual([...BP_CARE_V1.params.symptomGroups.redFlag].sort());
    const stored: readonly string[] = Constants.public.Enums.symptom_type;
    for (const s of QUESTION_SYMPTOMS) {
      expect([s, stored.includes(s)]).toEqual([s, true]);
      expect(en).toHaveProperty([`vitals.symptom.${s}`]);
    }
  });
  it("has the question text", () => {
    for (const key of ["triage.tri_008.title", "triage.tri_008.body", "triage.question.yes", "triage.question.none"]) {
      expect(en).toHaveProperty([key]);
    }
  });
});

describe("a reading of 200/130 or more asks first", () => {
  it("205/100 with nothing answered is not graded and nothing is stored as a pending recheck", async () => {
    const d = await grade();
    expect(d.result).toMatchObject({ status: "symptom_check_required", grade: null, ruleId: "BP-X1", explanationKey: "TRI-008" });
    expect(d.message).toEqual({ title: "triage.tri_008.title", body: "triage.tri_008.body" });
    expect(d.gradedAtMs).toBe(NOW);
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });
  it("diastolic 130 alone asks too, and 199/129 does not", async () => {
    expect((await grade({ systolic: 150, diastolic: 130 })).result.status).toBe("symptom_check_required");
    expect((await grade({ systolic: 199, diastolic: 129 })).result.status).not.toBe("symptom_check_required");
  });
  it("a ticked symptom on the form already answers it: red, no question", async () => {
    const d = await grade({ symptoms: ["chest_pain"] });
    expect(d.result).toMatchObject({ grade: "red", ruleId: "BP-R1" });
  });
  it("the sheet is shown only when the rule set is the approved one", async () => {
    expect(shouldAskSymptomQuestion(await grade())).toBe(false);
    await approve();
    expect(shouldAskSymptomQuestion(await grade())).toBe(true);
    expect(shouldAskSymptomQuestion(await grade({ symptomsAnswered: true }))).toBe(false);
    expect(shouldAskSymptomQuestion(null)).toBe(false);
    expect(shouldAskSymptomQuestion(undefined)).toBe(false);
  });
});

describe("answering", () => {
  const base = { subjectId: SUBJECT, systolic: 205, diastolic: 100, gradedAtMs: NOW };

  it("yes: emergency guidance now, and each symptom is saved on the phone as a danger row", async () => {
    const out = await answerSymptomQuestion({ ...base, symptoms: ["chest_pain", "back_pain"] });
    expect(out.triage.result).toMatchObject({ grade: "red", ruleId: "BP-R1" });
    expect(out.triage.severity).toBe("emergency");
    expect(out.triage.emergencyCode).toBe("EMG-001");
    expect(out.saved).toBe(true);
    expect(out.syncedAll).toBe(true);
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });

  it("yes: the rows carry the question note and the paging severity, and are queued when the network is down", async () => {
    mockInsertError = { code: "08006", message: "network" };
    const out = await answerSymptomQuestion({ ...base, symptoms: ["weakness_or_numbness"] });
    expect(out.triage.severity).toBe("emergency");
    expect(out.syncedAll).toBe(false);
    const queued = (await listOutbox()).filter((r) => r.kind === "symptom");
    expect(queued).toHaveLength(1);
    expect(queued[0]?.payload).toMatchObject({ symptom_type: "weakness_or_numbness", severity: QUESTION_SEVERITY, description: QUESTION_NOTE });
    expect(queued[0]?.danger).toBe(true);
    mockInsertError = { code: "42501" };
    await flushOutbox();
    for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  });

  it("none: medicine, rest and a recheck after 2 hours; nothing is saved; the wait is remembered", async () => {
    const out = await answerSymptomQuestion({ ...base, symptoms: [] });
    expect(out.triage.result).toMatchObject({ status: "recheck_required", ruleId: "BP-X2", explanationKey: "TRI-007" });
    expect(out.triage.result.recheck?.waitMinutes).toBe(120);
    expect(out.triage.message).toEqual({ title: "triage.tri_007.title", body: "triage.tri_007.body" });
    expect(out.triage.severity).toBeNull();
    expect((await listOutbox()).filter((r) => r.kind === "symptom")).toHaveLength(0);
    expect(await readPendingRecheck(SUBJECT)).not.toBeNull();
  });

  it("yes still shows the guidance when the phone cannot store the symptoms", async () => {
    mockEnqueueFail = true;
    const out = await answerSymptomQuestion({ ...base, symptoms: ["confusion"] });
    mockEnqueueFail = false;
    expect(out.triage.severity).toBe("emergency");
    expect(out).toMatchObject({ saved: false, syncedAll: false });
  });
});

describe("what the form shows for a very high reading", () => {
  it("draft rule set: the older check's emergency stands and the question is not shown", async () => {
    const out = await evaluateOnDevice({ systolic: 205, diastolic: 100, redFlagTicked: [], symptoms: [], subjectId: SUBJECT });
    expect(out.device?.result.status).toBe("symptom_check_required");
    expect(shouldAskSymptomQuestion(out.device)).toBe(false);
    expect(out.severity).toBe("emergency");
  });
  it("approved rule set: the question replaces the blanket emergency", async () => {
    await approve();
    const out = await evaluateOnDevice({ systolic: 205, diastolic: 100, redFlagTicked: [], symptoms: [], subjectId: SUBJECT });
    expect(shouldAskSymptomQuestion(out.device)).toBe(true);
    expect(out.severity).toBeNull();
  });
  it("approved rule set: a ticked red-flag symptom is never softened", async () => {
    await approve();
    const out = await evaluateOnDevice({ systolic: 205, diastolic: 100, redFlagTicked: ["chest_pain"], symptoms: ["chest_pain"], subjectId: SUBJECT });
    expect(out.severity).toBe("emergency");
  });
});
