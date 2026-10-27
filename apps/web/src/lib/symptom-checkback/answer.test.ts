import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { SymptomCapture } from "@tarragon/symptom-triage-engine";

/**
 * S59c: reading and answering a follow-up. The red-flag floor is re-run here from the STORED capture plus the newly ticked signs (never from
 * a value the client sent) and handed to the database function, which can only raise the action from it.
 */
const rpc = jest.fn<(fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string; code?: string } | null }>>();
const isOpen = jest.fn<() => Promise<boolean>>();
const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));
jest.mock("@/lib/symptom-triage/protocol", () => ({ isSymptomCheckerOpen: () => isOpen() }));

import { answerCheckback, floorForAnswer, readCheckbackView } from "./answer";

const ID = "11111111-1111-4111-8111-111111111111";
const ASSESSMENT = "22222222-2222-4222-8222-222222222222";
const headacheCapture: SymptomCapture = { presentingComplaintKey: "headache", onset: "gradual", severity: 4, associatedSymptoms: ["nausea_vomiting"], triggers: [], relevantHistory: [], measurements: {} };

const view = (over: Record<string, unknown> = {}) => ({
  id: ID,
  state: "open",
  assessment_id: ASSESSMENT,
  due_at: "2026-10-23T10:00:00Z",
  opened_at: "2026-10-23T10:00:00Z",
  category: "routine",
  urgency_level: null,
  complaint_key: "headache",
  complaint_label: "Headache",
  checked_at: "2026-10-22T10:00:00Z",
  hours_since_check: 30,
  same_nudge_after_hours: 24,
  sign_vocabulary: ["fever", "neck_stiffness", "visual_disturbance", "vision_loss", "weakness_or_numbness", "confusion", "nausea_vomiting"],
  capture: headacheCapture,
  protocol_version: 1,
  outcome: null,
  ...over,
});
const client = { rpc: (fn: string, args?: Record<string, unknown>) => rpc(fn, args) } as never;
const outcome = { action: "escalate", escalated: true, alert_raised: true, emergency: false, doctor_access: true, assessment_id: ASSESSMENT, repeat: false };

beforeEach(() => {
  rpc.mockReset();
  isOpen.mockReset();
  captureException.mockReset();
  isOpen.mockResolvedValue(true);
  rpc.mockImplementation(async (fn) => (fn === "my_symptom_checkback" ? { data: view(), error: null } : { data: outcome, error: null }));
});

const lastAnswerArgs = () => rpc.mock.calls.filter(([fn]) => fn === "answer_symptom_checkback").at(-1)?.[1];

describe("floorForAnswer", () => {
  it("is null when nothing newly ticked fires a rule", () => {
    expect(floorForAnswer(headacheCapture, [])).toBeNull();
    expect(floorForAnswer(headacheCapture, ["fever"])).toBeNull();
  });
  it("fires the signed rules on the original answers plus what is newly ticked", () => {
    expect(floorForAnswer(headacheCapture, ["confusion"])).toBe("emergency");
    expect(floorForAnswer(headacheCapture, ["fever", "neck_stiffness"])).toBe("emergency");
  });
  it("re-evaluates the chest pain pattern from the stored answers (sweating plus severity)", () => {
    const chest: SymptomCapture = { ...headacheCapture, presentingComplaintKey: "chest_pain", severity: 7, associatedSymptoms: [] };
    expect(floorForAnswer(chest, [])).toBeNull();
    expect(floorForAnswer(chest, ["sweating"])).toBe("emergency");
  });
  it("never returns a category below urgent: a quieter floor result is null, not a lower category", () => {
    for (const signs of [[], ["fever"], ["confusion"]]) expect([null, "urgent", "emergency"]).toContain(floorForAnswer(headacheCapture, signs));
  });
});

describe("readCheckbackView", () => {
  it("returns the view, and null for a bad id, an error or a malformed answer", async () => {
    expect((await readCheckbackView(client, ID))?.complaint_label).toBe("Headache");
    expect(await readCheckbackView(client, "not-an-id")).toBeNull();
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x", code: "P0002" } });
    expect(await readCheckbackView(client, ID)).toBeNull();
    rpc.mockResolvedValueOnce({ data: { id: ID }, error: null });
    expect(await readCheckbackView(client, ID)).toBeNull();
  });
});

describe("answerCheckback", () => {
  const input = { checkbackId: ID, progress: "worse", care: "not_yet", signs: [] };

  it("rejects bad input and a missing session before any call", async () => {
    expect(await answerCheckback(client, "u1", { checkbackId: "x", progress: "worse", signs: [] })).toEqual({ ok: false, reason: "invalid" });
    expect(await answerCheckback(client, "u1", { ...input, progress: "fine" })).toEqual({ ok: false, reason: "invalid" });
    expect(await answerCheckback(client, null, input)).toEqual({ ok: false, reason: "signed_out" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is closed while the symptom checker guard is closed (INV-14), and asks the database nothing", async () => {
    isOpen.mockResolvedValue(false);
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "closed" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the answer to the database with the floor it computed itself from the stored capture", async () => {
    const r = await answerCheckback(client, "u1", { ...input, signs: ["confusion"], floor: "routine", p_floor_category: null });
    expect(r).toMatchObject({ ok: true, complaintKey: "headache" });
    expect(lastAnswerArgs()).toEqual({ p_id: ID, p_progress: "worse", p_care: "not_yet", p_new_signs: ["confusion"], p_floor_category: "emergency" });
  });

  it("passes no floor when nothing fires, and de-duplicates the signs", async () => {
    await answerCheckback(client, "u1", { ...input, progress: "better", care: null, signs: ["fever", "fever"] });
    expect(lastAnswerArgs()).toEqual({ p_id: ID, p_progress: "better", p_care: null, p_new_signs: ["fever"], p_floor_category: null });
  });

  it("refuses a sign that is not in the pathway's own vocabulary and never reaches the answer function", async () => {
    expect(await answerCheckback(client, "u1", { ...input, signs: ["chest_pain"] })).toEqual({ ok: false, reason: "invalid" });
    expect(lastAnswerArgs()).toBeUndefined();
  });

  it("does not answer a follow-up that is not waiting", async () => {
    rpc.mockImplementationOnce(async () => ({ data: view({ state: "cancelled" }), error: null }));
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "not_open" });
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "x", code: "P0002" } }));
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "not_open" });
  });

  it("an expired follow-up can still be answered (a late 'worse' must still escalate)", async () => {
    rpc.mockImplementation(async (fn) => (fn === "my_symptom_checkback" ? { data: view({ state: "expired" }), error: null } : { data: outcome, error: null }));
    expect(await answerCheckback(client, "u1", input)).toMatchObject({ ok: true });
  });

  it("maps database refusals to short reason codes, and reports an unexpected failure loudly", async () => {
    const fail = (code: string) => rpc.mockImplementation(async (fn) => (fn === "my_symptom_checkback" ? { data: view(), error: null } : { data: null, error: { message: "boom", code } }));
    fail("42501");
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "closed" });
    fail("55000");
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "not_open" });
    fail("22023");
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "invalid" });
    expect(captureException).not.toHaveBeenCalled();
    fail("XX000");
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "failed" });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it("a malformed answer from the database is a failure, not a success", async () => {
    rpc.mockImplementation(async (fn) => (fn === "my_symptom_checkback" ? { data: view(), error: null } : { data: { action: "maybe" }, error: null }));
    expect(await answerCheckback(client, "u1", input)).toEqual({ ok: false, reason: "failed" });
  });

  it("property: the floor sent is never lower than what the stored answers plus the ticked signs fire", async () => {
    for (const signs of [[], ["fever"], ["confusion"], ["fever", "neck_stiffness"], ["vision_loss"]]) {
      await answerCheckback(client, "u1", { ...input, signs });
      const sent = lastAnswerArgs()?.p_floor_category ?? null;
      expect(sent).toBe(floorForAnswer(headacheCapture, signs));
    }
  });
});
