import { describe, expect, it } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import {
  activationRefusal,
  describeActivationReason,
  pagingRulesView,
  readPagingActivationCheck,
  readPendingQueuePagingConfigSignoff,
  taskLayerAsk,
  taskLayerRulesView,
} from "./pending-queue-paging-config-signoff";

const taskRules = {
  lead_window_cap_fraction: 0.5,
  escalated_non_red_any_eligible: true,
  escalation_alert: { immediate_max_class: 2 },
  completion: { contact_attempts: { min_attempts: 3 }, note_max_chars: 1000 },
  watchdog: { job_max_age_minutes: { "sweep-clinical-tasks": 5 }, class_warning_minutes: { "2": 60 } },
};
const pagingRules = {
  delivered_ack_seconds: 90, delivered_ack_seconds_unconfirmed_route: 180, merge_window_minutes: 30, readiness_test_page_days: 7,
  engine_heartbeat_stale_seconds: 120, reconcile_after_seconds: 60, objective_readiness_required: 1,
};

describe("taskLayerAsk", () => {
  it("asks to accept a version in force that was never signed (today's state)", () => {
    expect(taskLayerAsk([{ version: 1, is_active: true, approved_at: null }])).toEqual({ kind: "accept_in_force", version: 1 });
  });
  it("asks to sign a newer draft in preference to accepting the old version", () => {
    expect(taskLayerAsk([{ version: 1, is_active: true, approved_at: null }, { version: 2, is_active: false, approved_at: null }])).toEqual({ kind: "sign_new", version: 2 });
  });
  it("asks nothing once the version in force is signed, and ignores an old unsigned superseded version", () => {
    expect(taskLayerAsk([{ version: 1, is_active: false, approved_at: null }, { version: 2, is_active: true, approved_at: "2026-10-20T00:00:00Z" }])).toBeNull();
  });
});

describe("rule views", () => {
  it("reads the task layer numbers from the version itself and refuses to guess", () => {
    expect(taskLayerRulesView(taskRules)).toMatchObject({ windowCapPercent: 50, immediateMaxClass: 2, contactAttempts: 3, noteMaxChars: 1000 });
    expect(taskLayerRulesView({ ...taskRules, lead_window_cap_fraction: undefined })).toBeNull();
    expect(taskLayerRulesView(undefined)).toBeNull();
  });
  it("reads the paging numbers and the readiness flag", () => {
    expect(pagingRulesView(pagingRules)).toMatchObject({ deliveredAckSeconds: 90, readinessTestPageDays: 7, objectiveReadinessRequired: true });
    expect(pagingRulesView({ ...pagingRules, objective_readiness_required: 0 })?.objectiveReadinessRequired).toBe(false);
    expect(pagingRulesView({ ...pagingRules, merge_window_minutes: "30" })).toBeNull();
  });
});

type Rows = Record<string, { data: unknown; error: unknown }>;
const client = (rows: Rows, rpcResult?: { data: unknown; error: unknown }): SupabaseClient<Database> =>
  ({
    from: (t: string) => ({ select: () => Promise.resolve(rows[t] ?? { data: null, error: new Error("no table") }) }),
    rpc: () => Promise.resolve(rpcResult ?? { data: null, error: new Error("no rpc") }),
  }) as unknown as SupabaseClient<Database>;

describe("readPendingQueuePagingConfigSignoff", () => {
  const task = [{ version: 1, is_active: true, approved_at: null, rules: taskRules }];
  const paging = [
    { version: 1, is_active: true, approved_at: null, rules: { ...pagingRules, objective_readiness_required: 0 } },
    { version: 2, is_active: false, approved_at: null, rules: pagingRules },
  ];
  it("finds the task layer acceptance and the paging v2 draft, with the in-force numbers beside it", async () => {
    const r = await readPendingQueuePagingConfigSignoff(client({ queue_task_layer_config: { data: task, error: null }, paging_delivery_config: { data: paging, error: null } }));
    expect(r).toMatchObject({ taskLayer: { kind: "accept_in_force", version: 1 }, pagingVersion: 2, failed: false });
    expect(r.pagingRules?.objectiveReadinessRequired).toBe(true);
    expect(r.pagingInForceRules?.objectiveReadinessRequired).toBe(false);
  });
  it("finds nothing when both are signed", async () => {
    const signedTask = task.map((x) => ({ ...x, approved_at: "2026-10-20T00:00:00Z" }));
    const signedPaging = [{ ...paging[1], is_active: true, approved_at: "2026-10-20T00:00:00Z" }];
    const r = await readPendingQueuePagingConfigSignoff(client({ queue_task_layer_config: { data: signedTask, error: null }, paging_delivery_config: { data: signedPaging, error: null } }));
    expect(r).toMatchObject({ taskLayer: null, pagingVersion: null, failed: false });
  });
  it("says it failed, never reading as all clear, when a table cannot be read", async () => {
    const r = await readPendingQueuePagingConfigSignoff(client({ queue_task_layer_config: { data: null, error: new Error("denied") }, paging_delivery_config: { data: paging, error: null } }));
    expect(r.failed).toBe(true);
    expect(r.taskLayer).toBeNull();
  });
});

describe("the activation checklist", () => {
  const notReady = {
    version: 2, ready: false, on_call_count: 2, window_days: 7,
    reasons: [{ code: "clinician_not_ready", clinician_id: "c1", name: "Dr A", gaps: ["push_subscription", "test_page"] }],
  };
  it("parses the database answer and returns null for anything it cannot read", async () => {
    expect(await readPagingActivationCheck(client({}, { data: notReady, error: null }), 2)).toMatchObject({ ready: false, on_call_count: 2 });
    expect(await readPagingActivationCheck(client({}, { data: { ready: true }, error: null }), 2)).toBeNull();
    expect(await readPagingActivationCheck(client({}, { data: null, error: { message: "x" } }), 2)).toBeNull();
  });
  it("words each reason and the refusal in plain sentences", () => {
    expect(describeActivationReason(notReady.reasons[0])).toBe("Dr A: no working push subscription, no test page acknowledged in the window");
    expect(activationRefusal(notReady.reasons)).toMatch(/^Not activated\. Nothing was changed\. Still missing: Dr A/);
    expect(activationRefusal([{ code: "no_on_call_clinicians" }])).toMatch(/Nobody on your team has the on-call competency/);
  });
});
