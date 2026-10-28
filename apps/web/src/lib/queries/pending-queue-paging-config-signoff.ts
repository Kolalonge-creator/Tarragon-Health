import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { z } from "zod";
import { newestWaiting, runningUnsigned } from "@/lib/queries/pending-quality-config-signoff";

/**
 * OQ-451: what the task layer configuration (queue_task_layer_config) and the paging delivery configuration (paging_delivery_config)
 * need from the Chief Medical Officer, for the sign-off hub. Nothing signs or activates by itself. Never throws; a failed read says so.
 */

type Row = { version: number; is_active: boolean; approved_at: string | null; rules?: Record<string, unknown> };
type Loose = {
  from(table: string): { select(columns: string): PromiseLike<{ data: Row[] | null; error: unknown }> };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/** What the CMO is being asked to do with the task layer configuration. */
export type TaskLayerAsk =
  | { kind: "accept_in_force"; version: number }
  | { kind: "sign_new"; version: number }
  | null;

/**
 * Pure. A draft newer than the version in force is signed and made live. Otherwise a version in force that no one has signed yet is
 * accepted (records the signature, changes no behaviour). Nothing waiting is null.
 */
export function taskLayerAsk(rows: Row[]): TaskLayerAsk {
  const draft = newestWaiting(rows);
  if (draft !== null) return { kind: "sign_new", version: draft };
  const live = rows.filter((r) => r.is_active && r.approved_at === null).sort((a, b) => b.version - a.version)[0];
  return live ? { kind: "accept_in_force", version: live.version } : null;
}

const num = (rules: Record<string, unknown> | undefined, path: string[]): number | null => {
  let v: unknown = rules;
  for (const k of path) v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[k] : undefined;
  return typeof v === "number" ? v : null;
};

/** The numbers the task layer panel shows, read from the version being signed so the words and the values cannot differ. */
export type TaskLayerRulesView = {
  windowCapPercent: number;
  anyEligibleWhenEscalated: boolean;
  immediateMaxClass: number;
  contactAttempts: number;
  noteMaxChars: number;
  watchdogJobMinutes: { job: string; minutes: number }[];
  warningMinutes: { taskClass: string; minutes: number }[];
};

export function taskLayerRulesView(rules: Record<string, unknown> | undefined): TaskLayerRulesView | null {
  const cap = num(rules, ["lead_window_cap_fraction"]);
  const immediate = num(rules, ["escalation_alert", "immediate_max_class"]);
  const attempts = num(rules, ["completion", "contact_attempts", "min_attempts"]);
  const noteMax = num(rules, ["completion", "note_max_chars"]);
  const jobs = (rules?.watchdog as { job_max_age_minutes?: Record<string, unknown> } | undefined)?.job_max_age_minutes;
  const classes = (rules?.watchdog as { class_warning_minutes?: Record<string, unknown> } | undefined)?.class_warning_minutes;
  const anyEligible = rules?.escalated_non_red_any_eligible;
  if (cap === null || immediate === null || attempts === null || noteMax === null || typeof anyEligible !== "boolean" || !jobs || !classes) return null;
  const pairs = (o: Record<string, unknown>) => Object.entries(o).filter((e): e is [string, number] => typeof e[1] === "number");
  return {
    windowCapPercent: Math.round(cap * 100),
    anyEligibleWhenEscalated: anyEligible,
    immediateMaxClass: immediate,
    contactAttempts: attempts,
    noteMaxChars: noteMax,
    watchdogJobMinutes: pairs(jobs).map(([job, minutes]) => ({ job, minutes })),
    warningMinutes: pairs(classes).map(([taskClass, minutes]) => ({ taskClass, minutes })),
  };
}

export type PagingRulesView = {
  deliveredAckSeconds: number;
  deliveredAckSecondsUnconfirmed: number;
  mergeWindowMinutes: number;
  readinessTestPageDays: number;
  heartbeatStaleSeconds: number;
  reconcileAfterSeconds: number;
  objectiveReadinessRequired: boolean;
};

export function pagingRulesView(rules: Record<string, unknown> | undefined): PagingRulesView | null {
  const n = (k: string) => num(rules, [k]);
  const a = n("delivered_ack_seconds"), b = n("delivered_ack_seconds_unconfirmed_route"), c = n("merge_window_minutes"), d = n("readiness_test_page_days");
  const e = n("engine_heartbeat_stale_seconds"), f = n("reconcile_after_seconds"), g = n("objective_readiness_required");
  if ([a, b, c, d, e, f, g].some((v) => v === null)) return null;
  return {
    deliveredAckSeconds: a as number, deliveredAckSecondsUnconfirmed: b as number, mergeWindowMinutes: c as number,
    readinessTestPageDays: d as number, heartbeatStaleSeconds: e as number, reconcileAfterSeconds: f as number, objectiveReadinessRequired: g === 1,
  };
}

export type PendingQueuePagingConfigSignoff = {
  taskLayer: TaskLayerAsk;
  taskLayerRules: TaskLayerRulesView | null;
  /** An unsigned, inactive paging_delivery_config version newer than the one in force (v2: objective on-call readiness ON). */
  pagingVersion: number | null;
  pagingRules: PagingRulesView | null;
  /** The numbers of the paging version in force, so the panel can say what changes. */
  pagingInForceRules: PagingRulesView | null;
  /** The paging version now in force has no signature on record: it is already running unsigned. */
  pagingRunningUnsigned?: boolean;
  failed: boolean;
};

const FAILED: PendingQueuePagingConfigSignoff = { taskLayer: null, taskLayerRules: null, pagingVersion: null, pagingRules: null, pagingInForceRules: null, failed: true };

export async function readPendingQueuePagingConfigSignoff(supabase: SupabaseClient<Database>): Promise<PendingQueuePagingConfigSignoff> {
  try {
    const loose = supabase as unknown as Loose;
    const [t, p] = await Promise.all([
      loose.from("queue_task_layer_config").select("version, is_active, approved_at, rules"),
      loose.from("paging_delivery_config").select("version, is_active, approved_at, rules"),
    ]);
    if (t.error || p.error || !t.data || !p.data) return FAILED;
    const taskLayer = taskLayerAsk(t.data);
    const pagingVersion = newestWaiting(p.data);
    const live = p.data.filter((r) => r.is_active).sort((a, b) => b.version - a.version)[0];
    return {
      taskLayer,
      taskLayerRules: taskLayer === null ? null : taskLayerRulesView(t.data.find((r) => r.version === taskLayer.version)?.rules),
      pagingVersion,
      pagingRules: pagingVersion === null ? null : pagingRulesView(p.data.find((r) => r.version === pagingVersion)?.rules),
      pagingInForceRules: pagingRulesView(live?.rules),
      pagingRunningUnsigned: runningUnsigned(p.data),
      failed: false,
    };
  } catch {
    return FAILED;
  }
}

/** The pre-sign checklist as the database reports it (public.paging_delivery_activation_check). */
const checkSchema = z.object({
  version: z.number().int(),
  ready: z.boolean(),
  on_call_count: z.number().int().min(0),
  window_days: z.number().int().positive(),
  reasons: z.array(
    z.object({
      code: z.string(),
      clinician_id: z.string().optional(),
      name: z.string().nullish(),
      gaps: z.array(z.string()).optional(),
    }),
  ),
});
export type PagingActivationCheck = z.infer<typeof checkSchema>;

/** null = the checklist could not be read: the panel then disables the button rather than showing a pass. */
export async function readPagingActivationCheck(supabase: SupabaseClient<Database>, version: number): Promise<PagingActivationCheck | null> {
  try {
    const { data, error } = await (supabase as unknown as Loose).rpc("paging_delivery_activation_check", { p_version: version });
    if (error) return null;
    const parsed = checkSchema.safeParse(data);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const GAP_WORDS: Record<string, string> = {
  push_subscription: "no working push subscription",
  verified_email: "no verified email",
  test_page: "no test page acknowledged in the window",
};

/** One plain sentence per reason, for the panel and for the refusal message. */
export function describeActivationReason(r: PagingActivationCheck["reasons"][number]): string {
  switch (r.code) {
    case "clinician_not_ready":
      return `${r.name ?? "A clinician on the on-call list"}: ${(r.gaps ?? []).map((g) => GAP_WORDS[g] ?? g).join(", ")}`;
    case "no_on_call_clinicians":
      return "Nobody on your team has the on-call competency, so there is nobody to check";
    case "already_signed":
      return "This version is already signed";
    case "already_in_force":
      return "This version is already in force";
    default:
      return r.code;
  }
}

/** The refusal sentence the hub shows when the database declines to activate. Capped well under the flash detail limit (400 characters): the first few names and a count. */
export function activationRefusal(reasons: PagingActivationCheck["reasons"]): string {
  const lines = reasons.map(describeActivationReason);
  const shown = lines.slice(0, 3).map((l) => (l.length > 90 ? `${l.slice(0, 87)}...` : l));
  const more = lines.length > shown.length ? ` and ${lines.length - shown.length} more (the panel lists everyone)` : "";
  return `Not activated. Nothing was changed. ${shown.length === 0 ? "The checklist was not met." : `Still missing: ${shown.join("; ")}${more}.`}`;
}
