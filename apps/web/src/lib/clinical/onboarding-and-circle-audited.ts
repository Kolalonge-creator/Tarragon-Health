import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONDITION_CODES, GOAL_CODES, type Database } from "@tarragon/shared";
import { CIRCLE_PERMISSIONS, type CirclePermission } from "@/lib/care-circle/model";
import { ROUTINE_CHART_READ_REASON } from "./audited-chart";

/**
 * DW-07 / DW-08 (2026-11-06): the patient's own onboarding answers and their Care Circle, read through the audited, tie-gated
 * functions (20261106183232). Every reply is parsed; "denied" and "error" are never shown as "none" (the same rule as the
 * audited chart read).
 */
export type AuditedRead<T> = { status: "ok"; value: T } | { status: "denied" } | { status: "error" };

const answerRow = z.object({
  question_code: z.enum(["goals", "conditions"]),
  answer: z.array(z.string()),
  answered_at: z.string().nullable(),
});
export type OnboardingView = { goals: string[]; conditions: string[]; answeredAt: string | null };

const supporterRow = z.object({
  supporter_name: z.string().nullable(),
  relationship: z.string(),
  permissions: z.array(z.string()),
  contact_role: z.string().nullable(),
  since: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export type CircleSupporter = {
  name: string;
  relationship: string;
  permissions: CirclePermission[];
  primaryContact: boolean;
  since: string | null;
};
export type CareCircleView = { supporters: CircleSupporter[]; pausedUntil: string | null };

const okEnvelope = z.object({ status: z.literal("ok") }).passthrough();
const deniedEnvelope = z.object({ status: z.literal("denied") });

export function parseOnboarding(data: unknown): AuditedRead<OnboardingView> {
  if (deniedEnvelope.safeParse(data).success) return { status: "denied" };
  const env = okEnvelope.safeParse(data);
  const rows = env.success ? z.array(answerRow).safeParse((env.data as { answers?: unknown }).answers) : null;
  if (!rows?.success) return { status: "error" };
  const pick = (q: "goals" | "conditions", allowed: readonly string[]) =>
    rows.data.find((r) => r.question_code === q)?.answer.filter((a) => allowed.includes(a)) ?? [];
  const dates = rows.data.map((r) => r.answered_at).filter((d): d is string => !!d).sort();
  return {
    status: "ok",
    value: { goals: pick("goals", GOAL_CODES), conditions: pick("conditions", CONDITION_CODES), answeredAt: dates.at(-1) ?? null },
  };
}

export function parseCareCircle(data: unknown): AuditedRead<CareCircleView> {
  if (deniedEnvelope.safeParse(data).success) return { status: "denied" };
  const env = okEnvelope.safeParse(data);
  if (!env.success) return { status: "error" };
  const body = env.data as { supporters?: unknown; paused_until?: unknown };
  const rows = z.array(supporterRow).safeParse(body.supporters);
  const paused = z.string().nullable().optional().safeParse(body.paused_until);
  if (!rows.success || !paused.success) return { status: "error" };
  return {
    status: "ok",
    value: {
      pausedUntil: paused.data ?? null,
      supporters: rows.data.map((r) => ({
        name: r.supporter_name ?? "Name not on file",
        relationship: r.relationship,
        // An unknown permission is dropped, never allowed to hide the supporter (same rule as the Care Circle screens).
        permissions: r.permissions.filter((p): p is CirclePermission => (CIRCLE_PERMISSIONS as readonly string[]).includes(p)),
        primaryContact: r.contact_role === "primary",
        since: r.since,
      })),
    },
  };
}

export async function readOnboardingAndCircle(
  supabase: SupabaseClient<Database>,
  patientId: string,
): Promise<{ onboarding: AuditedRead<OnboardingView>; circle: AuditedRead<CareCircleView> }> {
  const [onb, circle] = await Promise.all([
    supabase.rpc("read_patient_onboarding_answers_audited", { p_patient: patientId, p_reason: ROUTINE_CHART_READ_REASON }),
    supabase.rpc("read_patient_care_circle_audited", { p_patient: patientId, p_reason: ROUTINE_CHART_READ_REASON }),
  ]);
  return {
    onboarding: onb.error ? { status: "error" } : parseOnboarding(onb.data),
    circle: circle.error ? { status: "error" } : parseCareCircle(circle.data),
  };
}
