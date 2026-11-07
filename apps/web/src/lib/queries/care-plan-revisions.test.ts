/** PD-06 data helpers: each throws on a failed read or refused write, so the UI can never mistake failure for "nothing". */
jest.mock("@/lib/supabase/client", () => ({ createClient: jest.fn() }));

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  fetchCarePlanRevisionsForPlan,
  fetchPatientCarePlanActions,
  fetchPatientCarePlanRevisions,
  publishCarePlanRevision,
  updateCarePlanReviewDates,
} from "./care-plan-revisions";

type Result = { data: unknown; error: unknown };

/** A chainable fake: every builder method returns itself; awaiting it resolves to the given result. */
function fakeClient(result: Result, rpcResult?: Result) {
  const calls: { method: string; args: unknown[] }[] = [];
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "in", "eq", "order", "update"]) {
    builder[m] = (...args: unknown[]) => {
      calls.push({ method: m, args });
      return builder;
    };
  }
  builder.then = (resolve: (r: Result) => unknown) => resolve(result);
  const rpc = jest.fn(async () => rpcResult ?? { data: null, error: null });
  const client = { ...builder, rpc } as unknown as SupabaseClient<Database>;
  return { client, calls, rpc };
}

describe("fetchPatientCarePlanActions", () => {
  it("returns nothing without a query when there are no plans", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(fetchPatientCarePlanActions(client, [])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it("maps rows to the patient view and reads only active actions", async () => {
    const { client, calls } = fakeClient({
      data: [
        { care_plan_id: "p1", description: "Check BP", frequency: "daily", category: "monitoring", why_text: "W", when_text: "AM", how_text: "Seated", created_at: "x" },
        { care_plan_id: null, description: "orphan", frequency: null, category: null, why_text: null, when_text: null, how_text: null, created_at: "x" },
      ],
      error: null,
    });
    await expect(fetchPatientCarePlanActions(client, ["p1"])).resolves.toEqual([
      { carePlanId: "p1", description: "Check BP", frequency: "daily", category: "monitoring", why: "W", when: "AM", how: "Seated" },
    ]);
    expect(calls).toContainEqual({ method: "eq", args: ["status", "active"] });
  });

  it("throws on a failed read", async () => {
    const { client } = fakeClient({ data: null, error: { message: "boom" } });
    await expect(fetchPatientCarePlanActions(client, ["p1"])).rejects.toEqual({ message: "boom" });
  });
});

describe("revision reads", () => {
  it("fetchPatientCarePlanRevisions filters by patient and throws on error", async () => {
    const ok = fakeClient({ data: [{ id: "r1" }], error: null });
    await expect(fetchPatientCarePlanRevisions(ok.client, "pat")).resolves.toEqual([{ id: "r1" }]);
    expect(ok.calls).toContainEqual({ method: "eq", args: ["patient_id", "pat"] });
    const bad = fakeClient({ data: null, error: { message: "no" } });
    await expect(fetchPatientCarePlanRevisions(bad.client, "pat")).rejects.toBeTruthy();
  });

  it("fetchCarePlanRevisionsForPlan filters by plan and throws on error", async () => {
    const ok = fakeClient({ data: [], error: null });
    await expect(fetchCarePlanRevisionsForPlan(ok.client, "plan")).resolves.toEqual([]);
    expect(ok.calls).toContainEqual({ method: "eq", args: ["care_plan_id", "plan"] });
    const bad = fakeClient({ data: null, error: { message: "no" } });
    await expect(fetchCarePlanRevisionsForPlan(bad.client, "plan")).rejects.toBeTruthy();
  });
});

describe("publishCarePlanRevision", () => {
  it("calls the publish RPC and returns the new id", async () => {
    const { client, rpc } = fakeClient({ data: null, error: null }, { data: "rev-1", error: null });
    await expect(
      publishCarePlanRevision(client, { carePlanId: "plan", changeSummary: "We added a check.", needsAcknowledgement: true }),
    ).resolves.toBe("rev-1");
    expect(rpc).toHaveBeenCalledWith("publish_care_plan_revision", {
      p_care_plan: "plan",
      p_change_summary: "We added a check.",
      p_needs_acknowledgement: true,
    });
  });

  it("throws when the database refuses (for example a care coordinator)", async () => {
    const { client } = fakeClient({ data: null, error: null }, { data: null, error: { code: "42501" } });
    await expect(
      publishCarePlanRevision(client, { carePlanId: "plan", changeSummary: "x".repeat(10), needsAcknowledgement: false }),
    ).rejects.toEqual({ code: "42501" });
  });
});

describe("updateCarePlanReviewDates", () => {
  it("updates both dates", async () => {
    const { client, calls } = fakeClient({ data: [{ id: "plan" }], error: null });
    await updateCarePlanReviewDates(client, { carePlanId: "plan", lastReviewedAt: "2026-11-07T00:00:00Z", nextReviewAt: "2027-02-07" });
    expect(calls).toContainEqual({ method: "update", args: [{ last_reviewed_at: "2026-11-07T00:00:00Z", next_review_at: "2027-02-07" }] });
  });

  it("treats a zero-row update (refused by RLS) as a failure", async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(
      updateCarePlanReviewDates(client, { carePlanId: "plan", lastReviewedAt: null, nextReviewAt: null }),
    ).rejects.toThrow();
  });
});
