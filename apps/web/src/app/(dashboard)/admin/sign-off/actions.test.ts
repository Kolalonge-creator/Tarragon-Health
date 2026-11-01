import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { knowledgeFingerprint, stepFingerprint, type KnowledgeRow, type StepRow } from "@/lib/frontdesk/signoff-model";

const getCurrentProfile = jest.fn<() => Promise<{ id: string } | null>>();
const getCallerPermissions = jest.fn<() => Promise<{ isSuperAdmin: boolean }>>();
const fdRpc = jest.fn<(s: unknown, fn: string, args: Record<string, unknown>) => Promise<{ error: string | null }>>();
const readPending = jest.fn<() => Promise<{ steps: StepRow[]; knowledge: KnowledgeRow[]; failed: boolean }>>();

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("server-only", () => ({}));
jest.mock("@/lib/auth/current-profile", () => ({ getCurrentProfile: () => getCurrentProfile() }));
jest.mock("@/lib/auth/permissions", () => ({ getCallerPermissions: () => getCallerPermissions() }));
jest.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
jest.mock("@/lib/frontdesk/raw-db", () => ({ fdRpc: (s: unknown, fn: string, args: Record<string, unknown>) => fdRpc(s, fn, args) }));
jest.mock("@/lib/queries/pending-front-desk-signoff", () => ({ readPendingFrontDeskSignoff: () => readPending() }));

import { approveAllAction, approveKnowledgeAction, approveStepAction, saveStepAction } from "./actions";

const ID1 = "11111111-1111-4111-8111-111111111111";
const ID2 = "22222222-2222-4222-8222-222222222222";
const KID = "33333333-3333-4333-8333-333333333333";

const step = (id: string, o: Partial<StepRow> = {}): StepRow => ({
  id, sequenceKey: "welcome", sequenceName: "Welcome", sequencePurpose: "service_followup", position: 1, delayMinutes: 0, stepKey: "welcome_1",
  subject: "Hello there", bodyText: "Hello {{first_name}} {{link}} body text", status: "draft", approvedAt: null, ...o,
});
const know = (o: Partial<KnowledgeRow> = {}): KnowledgeRow => ({ id: KID, topic: "launch", version: 1, content: "The platform opens soon.", active: false, approvedAt: null, ...o });

const form = (entries: [string, string][]) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

beforeEach(() => {
  jest.clearAllMocks();
  getCurrentProfile.mockResolvedValue({ id: "admin" });
  getCallerPermissions.mockResolvedValue({ isSuperAdmin: true });
  fdRpc.mockResolvedValue({ error: null });
  readPending.mockResolvedValue({ steps: [step(ID1), step(ID2, { position: 2, stepKey: "welcome_2" })], knowledge: [know()], failed: false });
});

describe("admin sign-off actions", () => {
  it("refuses anyone who is not a super admin and calls nothing", async () => {
    getCallerPermissions.mockResolvedValue({ isSuperAdmin: false });
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.error).toMatch(/admin/i);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("approves a step whose wording matches what the reader saw", async () => {
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.done).toBe("1 approved");
    expect(fdRpc).toHaveBeenCalledWith(expect.anything(), "fd_approve_sequence_step", { p_step_id: ID1 });
  });

  it("does NOT approve a step whose wording changed after the page loaded", async () => {
    const stale = stepFingerprint(step(ID1, { bodyText: "The old wording that was on screen." }));
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stale}`]]));
    expect(r?.error).toMatch(/changed after you opened/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("approves knowledge through the knowledge function", async () => {
    const r = await approveKnowledgeAction(undefined, form([["approval", `${KID}:${knowledgeFingerprint(know())}`]]));
    expect(r?.done).toBe("1 approved");
    expect(fdRpc).toHaveBeenCalledWith(expect.anything(), "fd_approve_knowledge", { p_id: KID });
  });

  it("approve all needs the confirmation box ticked", async () => {
    const r = await approveAllAction(undefined, form([["step", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.error).toMatch(/Tick the box/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("approve all approves every matching item and refuses only the changed one", async () => {
    readPending.mockResolvedValue({ steps: [step(ID1), step(ID2, { position: 2, stepKey: "welcome_2", bodyText: "Edited after the page loaded, long enough." })], knowledge: [know()], failed: false });
    const r = await approveAllAction(
      undefined,
      form([
        ["confirm", "on"],
        ["step", `${ID1}:${stepFingerprint(step(ID1))}`],
        ["step", `${ID2}:${stepFingerprint(step(ID2, { position: 2, stepKey: "welcome_2" }))}`],
        ["knowledge", `${KID}:${knowledgeFingerprint(know())}`],
      ]),
    );
    const approvedFns = fdRpc.mock.calls.map((c) => `${c[1]}:${JSON.stringify(c[2])}`);
    expect(approvedFns).toContain(`fd_approve_sequence_step:${JSON.stringify({ p_step_id: ID1 })}`);
    expect(approvedFns).not.toContain(`fd_approve_sequence_step:${JSON.stringify({ p_step_id: ID2 })}`);
    expect(r?.error).toMatch(/welcome_2 changed after you opened/);
  });

  it("skips an item that is already approved", async () => {
    readPending.mockResolvedValue({ steps: [step(ID1, { status: "approved", approvedAt: "2026-11-01" })], knowledge: [], failed: false });
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.done).toBe("Nothing needed approving");
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("approves nothing when the current wording cannot be read", async () => {
    readPending.mockResolvedValue({ steps: [], knowledge: [], failed: true });
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.error).toMatch(/nothing was approved/);
    expect(fdRpc).not.toHaveBeenCalled();
  });

  it("surfaces a database refusal instead of reporting success", async () => {
    fdRpc.mockResolvedValue({ error: "admin only" });
    const r = await approveStepAction(undefined, form([["approval", `${ID1}:${stepFingerprint(step(ID1))}`]]));
    expect(r?.error).toMatch(/admin only/);
  });

  it("rejects a malformed approval value", async () => {
    const r = await approveStepAction(undefined, form([["approval", "not-an-approval"]]));
    expect(r?.error).toBe("Invalid request");
  });

  it("validates edited wording before calling the database", async () => {
    const r = await saveStepAction(undefined, form([["id", ID1], ["subject", "ok subject"], ["body", "too short"]]));
    expect(r?.error).toBeDefined();
    expect(fdRpc).not.toHaveBeenCalled();
  });
});
