/**
 * S12: the phone's half of triage. Safety case 1 (offline red in under a second) and case 5 (an
 * implausible reading is rejected with TRI-006 and never graded or saved) are proved end to end through
 * the real save path; the repeat-reading flow and the rule set cache are proved around them.
 */
import { t } from "@tarragon/i18n";
import { BP_CARE_V1 } from "@tarragon/clinical";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NETWORK_ERROR_MESSAGE, postVitalReading } from "./api";
import { planBpLog, type BpLogInput } from "./bp-checklist";
import { logBpWithExtras, type TriageEvaluator } from "./bp-log";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";
import {
  AUDIO_PLACEHOLDER_PREFIX,
  CONTEXT_BUDGET_MS,
  clearPendingRecheck,
  gradeOnDevice,
  loadDeviceRuleSet,
  localBpHistory,
  readPendingRecheck,
  refreshApprovedRuleSet,
  resolveExpiredRecheck,
  triageAudioId,
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
jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn() }));
jest.mock("./offline-store", () => ({
  ...(jest.requireActual("./offline-store") as object),
  readLocalRecords: () => mockMirror(),
}));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;

const SUBJECT = "user-1";
const NOW = Date.parse("2026-10-05T10:00:00.000Z");
const plan = (over: Partial<BpLogInput> = {}) => {
  const p = planBpLog({ systolic: "150", diastolic: "95", pulse: "", symptoms: [], ...over }, 6);
  if (!p.ok) throw new Error("bad fixture");
  return p;
};

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

describe("safety case 1: offline red reading shows guidance on the device within 1 second", () => {
  it("185/125 with a severe headache, no network at all", async () => {
    mockPost.mockImplementation(async () => ({ success: false, error: NETWORK_ERROR_MESSAGE }));
    mockInsertError = { message: "Network request failed" };
    mockRpc = jest.fn(async () => {
      throw new Error("Network request failed");
    });

    const started = Date.now();
    let shownAfterMs = -1;
    const res = await logBpWithExtras(plan({ systolic: "185", diastolic: "125", symptoms: ["severe_headache"] }), undefined, undefined, (o) => {
      shownAfterMs = Date.now() - started;
      expect(o.severity).toBe("emergency");
    });

    expect(shownAfterMs).toBeGreaterThanOrEqual(0);
    expect(shownAfterMs).toBeLessThan(1000);
    expect(res.outcome.device?.result).toMatchObject({ status: "graded", grade: "red", ruleId: "BP-R1" });
    expect(res.outcome.device?.emergencyCode).toBe("EMG-001");
    expect(res.outcome.device?.result.actions).toContainEqual({ kind: "page_on_call" });
    // Saved on the phone for the server to grade and page when the network returns, with the symptom first.
    expect(res).toMatchObject({ saved: 2, syncedAll: false, remaining: 2 });
    const rows = await listOutbox();
    expect(rows.find((r) => r.kind === "vital")?.danger).toBe(true);
    expect(rows.find((r) => r.kind === "symptom")?.danger).toBe(true);
  });

  it("still answers inside a second when reading the phone's own history hangs", async () => {
    mockMirror = () => new Promise(() => {});
    const started = Date.now();
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 185, diastolic: 125, symptoms: ["severe_headache"] });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(Date.now() - started).toBeGreaterThanOrEqual(CONTEXT_BUDGET_MS - 50);
    expect(triage.result.grade).toBe("red");
    expect(triage.severity).toBe("emergency");
  });

  it("a crisis reading with no symptoms is red too (BP-R2), with the emergency text and a placeholder clip", async () => {
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 205, diastolic: 100, symptoms: [], nowMs: NOW });
    expect(triage.result).toMatchObject({ grade: "red", ruleId: "BP-R2" });
    expect(triage.message).toEqual({ title: "triage.emg_001.title", body: "triage.emg_001.body" });
    expect(triage.audioId).toBe(`${AUDIO_PLACEHOLDER_PREFIX}EMG-001`);
  });

  it("a low reading with fainting uses the low pressure variant", async () => {
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 85, diastolic: 60, symptoms: ["fainting"], nowMs: NOW });
    expect(triage.result.grade).toBe("red");
    expect(triage.emergencyCode).toBe("EMG-001L");
  });
});

describe("safety case 5: an implausible reading is rejected with TRI-006, never graded or saved", () => {
  it("300/40 is rejected by the engine with no grade", async () => {
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 300, diastolic: 40, symptoms: [], nowMs: NOW });
    expect(triage.result).toMatchObject({ status: "rejected", grade: null, explanationKey: "TRI-006" });
    expect(triage.message).toEqual({ title: "triage.tri_006.title", body: "triage.tri_006.body" });
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });

  it("the form refuses it before it reaches the engine, and the reading is not saved if the lists ever drift", async () => {
    expect(planBpLog({ systolic: "300", diastolic: "40", pulse: "", symptoms: [] }, 6)).toMatchObject({ ok: false });
    const rejecting: TriageEvaluator = async (input) => {
      const device = await gradeOnDevice({ subjectId: SUBJECT, systolic: 300, diastolic: 40, symptoms: [] });
      return { severity: null, bpFlag: null, symptomFlag: input.redFlagTicked.length > 0, thresholdVersion: "x", device };
    };
    const res = await logBpWithExtras(plan(), undefined, rejecting);
    expect(res.error).toBe(t("triage.tri_006.body", "en"));
    expect(res.saved).toBeUndefined();
    expect(await listOutbox()).toHaveLength(0);
  });

  it("the TRI-006 text exists in English and Pidgin", () => {
    expect(t("triage.tri_006.title", "en")).toMatch(/does not look right/);
    expect(t("triage.tri_006.body", "pcm").length).toBeGreaterThan(0);
  });
});

describe("the repeat reading flow", () => {
  it("a first 182/112 asks to rest and measure again; a repeat 181/111 is amber with a 4 hour task", async () => {
    const first = await gradeOnDevice({ subjectId: SUBJECT, systolic: 182, diastolic: 112, symptoms: [], nowMs: NOW });
    expect(first.result.status).toBe("recheck_required");
    expect(first.message).toEqual({ title: "triage.tri_005.title", body: "triage.tri_005.body" });
    expect(first.severity).toBeNull();
    expect((await readPendingRecheck(SUBJECT))?.reading).toMatchObject({ systolic: 182, diastolic: 112 });

    const second = await gradeOnDevice({ subjectId: SUBJECT, systolic: 181, diastolic: 111, symptoms: [], nowMs: NOW + 5 * 60_000 });
    expect(second.result).toMatchObject({ status: "graded", grade: "amber", ruleId: "BP-A1" });
    expect(second.result.actions).toContainEqual(expect.objectContaining({ kind: "create_task", dueMinutes: 240 }));
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });

  it("a repeat that is too soon asks again and keeps waiting", async () => {
    await gradeOnDevice({ subjectId: SUBJECT, systolic: 182, diastolic: 112, symptoms: [], nowMs: NOW });
    const soon = await gradeOnDevice({ subjectId: SUBJECT, systolic: 181, diastolic: 111, symptoms: [], nowMs: NOW + 60_000 });
    expect(soon.result.status).toBe("recheck_required");
    expect(await readPendingRecheck(SUBJECT)).not.toBeNull();
  });

  it("a repeat that is lower is graded on its own and ends the wait", async () => {
    await gradeOnDevice({ subjectId: SUBJECT, systolic: 182, diastolic: 112, symptoms: [], nowMs: NOW });
    const lower = await gradeOnDevice({ subjectId: SUBJECT, systolic: 130, diastolic: 80, symptoms: [], nowMs: NOW + 6 * 60_000 });
    expect(lower.result.grade).toBe("green");
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });

  it("a red repeat is never held back by the wait", async () => {
    await gradeOnDevice({ subjectId: SUBJECT, systolic: 182, diastolic: 112, symptoms: [], nowMs: NOW });
    const red = await gradeOnDevice({ subjectId: SUBJECT, systolic: 205, diastolic: 110, symptoms: [], nowMs: NOW + 6 * 60_000 });
    expect(red.result.grade).toBe("red");
  });

  it("no repeat in 15 minutes: the first reading is graded as if repeated, once", async () => {
    await gradeOnDevice({ subjectId: SUBJECT, systolic: 182, diastolic: 112, symptoms: [], nowMs: NOW });
    expect(await resolveExpiredRecheck(SUBJECT, NOW + 10 * 60_000)).toBeNull();
    const late = await resolveExpiredRecheck(SUBJECT, NOW + 16 * 60_000);
    expect(late?.result).toMatchObject({ status: "graded", grade: "amber", ruleId: "BP-A1" });
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
    expect(await resolveExpiredRecheck(SUBJECT, NOW + 17 * 60_000)).toBeNull();
  });

  it("a stored repeat that is corrupt is ignored", async () => {
    await AsyncStorage.setItem(`@tarragon/triage/pending-recheck/v1:${SUBJECT}`, "{not json");
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
    await AsyncStorage.setItem(`@tarragon/triage/pending-recheck/v1:${SUBJECT}`, JSON.stringify({ reading: { systolic: "x" } }));
    expect(await readPendingRecheck(SUBJECT)).toBeNull();
  });
});

describe("history and the rule set on the phone", () => {
  it("reads the last 14 days of blood pressure from the mirror, newest first, and ignores the rest", async () => {
    mockMirror = async () => [
      { id: "a", vital_type: "blood_pressure", systolic: 150, diastolic: 95, taken_at: "2026-10-04T08:00:00.000Z" },
      { id: "b", vital_type: "blood_pressure", systolic: 148, diastolic: 94, taken_at: "2026-10-03T08:00:00.000Z" },
      { id: "old", vital_type: "blood_pressure", systolic: 120, diastolic: 80, taken_at: "2026-09-01T08:00:00.000Z" },
      { id: "p", vital_type: "pulse", systolic: null, diastolic: null, taken_at: "2026-10-04T09:00:00.000Z" },
      { id: "x", vital_type: "blood_pressure", systolic: null, diastolic: null, taken_at: "2026-10-04T09:00:00.000Z" },
    ];
    const h = await localBpHistory(SUBJECT, NOW);
    expect(h.map((r) => r.systolic)).toEqual([150, 148]);
  });

  it("seven readings averaging target plus 25 systolic raise the 24 hour review (safety case 6)", async () => {
    mockMirror = async () =>
      Array.from({ length: 7 }, (_, i) => ({ id: `r${i}`, vital_type: "blood_pressure", systolic: 160, diastolic: 92, taken_at: `2026-10-0${i % 4 + 1}T0${i}:00:00.000Z` }));
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 160, diastolic: 92, symptoms: [], nowMs: NOW });
    expect(triage.result.grade).toBe("amber");
    expect(triage.result.actions).toContainEqual(expect.objectContaining({ kind: "create_task", dueMinutes: 1440 }));
  });

  it("uses the bundled draft rule set until an approved one is cached", async () => {
    expect(await loadDeviceRuleSet()).toEqual({ ruleSet: BP_CARE_V1, status: "draft" });
  });

  it("refresh caches a valid approved rule set and the phone then uses it", async () => {
    const approved = { ...BP_CARE_V1, version: 2, status: "approved" as const };
    mockRpc = jest.fn(async () => ({ data: { id: "rs2", code: "bp_care_triage", version: 2, rules: approved }, error: null }));
    expect(await refreshApprovedRuleSet()).toBe("updated");
    expect(await refreshApprovedRuleSet()).toBe("unchanged");
    const loaded = await loadDeviceRuleSet();
    expect(loaded.status).toBe("approved");
    expect(loaded.ruleSet.version).toBe(2);
    const triage = await gradeOnDevice({ subjectId: SUBJECT, systolic: 118, diastolic: 76, symptoms: [], nowMs: NOW });
    expect(triage.ruleSet).toEqual({ code: "bp_care_triage", version: 2, status: "approved" });
  });

  it("refresh never stores a rule set that fails validation, and drops the cache when nothing is approved", async () => {
    mockRpc = jest.fn(async () => ({ data: { rules: { code: "bp_care_triage" } }, error: null }));
    expect(await refreshApprovedRuleSet()).toBe("failed");
    expect(await loadDeviceRuleSet()).toMatchObject({ status: "draft" });

    const approved = { ...BP_CARE_V1, version: 2, status: "approved" as const };
    mockRpc = jest.fn(async () => ({ data: { rules: approved }, error: null }));
    await refreshApprovedRuleSet();
    mockRpc = jest.fn(async () => ({ data: null, error: null }));
    expect(await refreshApprovedRuleSet()).toBe("none_approved");
    expect(await loadDeviceRuleSet()).toMatchObject({ status: "draft" });
  });

  it("refresh reports a failure quietly when offline or on a server error", async () => {
    mockRpc = jest.fn(async () => ({ data: null, error: { message: "no" } }));
    expect(await refreshApprovedRuleSet()).toBe("failed");
    mockRpc = jest.fn(async () => {
      throw new Error("Network request failed");
    });
    expect(await refreshApprovedRuleSet()).toBe("failed");
  });

  it("a corrupt cached rule set falls back to the bundled one", async () => {
    await AsyncStorage.setItem("@tarragon/triage/rules/v1", "{oops");
    expect(await loadDeviceRuleSet()).toMatchObject({ status: "draft" });
  });

  it("placeholder audio ids carry the clip code, and null stays null", () => {
    expect(triageAudioId("TRI-001")).toBe("audio-pending:TRI-001");
    expect(triageAudioId(null)).toBeNull();
  });
});
