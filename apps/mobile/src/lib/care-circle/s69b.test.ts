import { parseDeclined, parseDigest, parseMyCircle, parseNudges, parseTasks, parseToolsStatus, TOOLS_OFF } from "./parse";

const mockRpc = jest.fn();
jest.mock("../supabase", () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { declineInvite, loadDigest, loadNudges, loadTasks, loadToolsStatus, postTask, setMissedDoseAlert, taskAction } from "./api";

beforeEach(() => mockRpc.mockReset());

describe("S69b parsers", () => {
  it("a tools reply that is not understood means every tool is off", () => {
    expect(parseToolsStatus(null)).toEqual(TOOLS_OFF);
    expect(parseToolsStatus({ digest: "yes" })).toEqual(TOOLS_OFF);
    expect(parseToolsStatus({ digest: true, tasks: false, missed_dose: true, grace_minutes: 30 })).toEqual({ digest: true, tasks: false, missedDose: true, graceMinutes: 30 });
  });

  it("a member carries the nudge switch, off unless the database said true", () => {
    const base = { member_id: "m", name: "N", relationship: "R", permissions: ["adherence_summary"], expires_at: "2027-01-01T00:00:00Z" };
    expect(parseMyCircle({ members: [base], invites: [] }).members[0]?.missedDoseAlert).toBe(false);
    expect(parseMyCircle({ members: [{ ...base, missed_dose_alert: true }], invites: [] }).members[0]?.missedDoseAlert).toBe(true);
  });

  it("only a clean ok is a quiet 'not now'", () => {
    expect(parseDeclined({ ok: true })).toBe(true);
    expect(parseDeclined({ ok: false })).toBe(false);
    expect(parseDeclined(null)).toBe(false);
  });

  it("tasks keep the fixed fields only, and drop a row that is not understood", () => {
    const list = parseTasks({
      role: "helper",
      tasks: [
        { task_id: "t1", kind: "take_to_lab", needed_by: "2026-10-27", state: "open", can_claim: true, free_text: "BP 180/110" },
        { task_id: "t2", kind: "x", state: "weird" },
      ],
    });
    expect(list?.tasks).toHaveLength(1);
    expect(list?.tasks[0]).toEqual({ taskId: "t1", kind: "take_to_lab", neededBy: "2026-10-27", state: "open", claimedByName: null, mine: false, canClaim: true, canRelease: false, canComplete: false, canCancel: false });
    expect(JSON.stringify(list)).not.toMatch(/180/);
    expect(parseTasks({ role: "boss", tasks: [] })).toBeNull();
  });

  it("the digest keeps only the counts the database sent", () => {
    const d = parseDigest({ name: "Mum", days: 7, readings: { days_logged: 5 }, bp: { systolic: 150 } });
    expect(d).toEqual({ name: "Mum", days: 7, readings: { daysLogged: 5 } });
    expect(parseDigest({ days: 7 })).toBeNull();
  });

  it("nudges are a first name and a time, nothing else", () => {
    expect(parseNudges([{ patient_id: "p", name: "Mum", since: "2026-10-22T08:00:00Z", medicine: "x" }, { name: "bad" }])).toEqual([{ patientId: "p", name: "Mum", since: "2026-10-22T08:00:00Z" }]);
    expect(parseNudges("nope")).toEqual([]);
  });
});

describe("S69b calls", () => {
  it("a failed tools read is 'all off'", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await loadToolsStatus()).toEqual(TOOLS_OFF);
  });

  it("'not now' is saved only on a clean answer", async () => {
    mockRpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
    expect(await declineInvite("tok")).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("decline_care_circle_invite", { p_token: "tok" });
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await declineInvite("tok")).toBe(false);
  });

  it("the nudge switch, jobs and digest call the right functions", async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    expect(await setMissedDoseAlert("m1", true)).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("set_circle_missed_dose_alert", { p_member: "m1", p_on: true });
    expect(await taskAction("claim_circle_task", "t1")).toBe(true);
    expect(mockRpc).toHaveBeenLastCalledWith("claim_circle_task", { p_task: "t1" });
    expect(await postTask("p", "errand", null)).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenLastCalledWith("post_circle_task", { p_patient: "p", p_kind: "errand" });
  });

  it("a refused claim is false (someone else got there first) and a failed one is null", async () => {
    mockRpc.mockResolvedValueOnce({ data: false, error: null });
    expect(await taskAction("claim_circle_task", "t1")).toBe(false);
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await taskAction("claim_circle_task", "t1")).toBeNull();
  });

  it("the job limit is reported as such", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "task_limit" } });
    expect(await postTask("p", "errand", null)).toEqual({ ok: false, limit: true });
  });

  it("an ended access, an off module or a failed read all read as nothing to show", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "circle_not_found" } });
    expect(await loadTasks("p")).toBeNull();
    expect(await loadDigest("p")).toBeNull();
    expect(await loadNudges()).toEqual([]);
  });
});
