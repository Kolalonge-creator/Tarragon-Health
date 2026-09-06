import type { SupabaseClient } from "@supabase/supabase-js";
import type { CoachChatMessage, Database } from "@tarragon/shared";
import { loadPatientContext } from "./context";
import {
  careTasksThisMonth,
  explainHealthRecord,
  prepareForAppointment,
  type AppointmentPrepSummary,
  type CareTasksThisMonth,
  type HealthRecordExplanation,
} from "./composed-surfaces";
import { COACH_ACCESS_DENIED_REPLY, hasCoachAccess } from "./entitlement";
import { logAssistantTurn } from "./audit";
import { appendMessages, resolveOrCreateConversation } from "./conversation-store";

/**
 * The three "patient selects a quick action" entry points named in §36.5/
 * §36.8/§36.9 (docs/AI_HEALTH_ASSISTANT_ARCHITECTURE.md §7 Phase C) — a
 * server-action-callable counterpart to runCoachTurn (index.ts) for the
 * composed-surfaces.ts functions, which are deterministic and never call
 * Claude. Reuses runCoachTurn's own entitlement gate (same UI card, same
 * PHI-reading surface) but not its daily rate limit, which exists
 * specifically to bound Claude spend (rate-limit.ts's own doc comment) —
 * these three cost nothing to run.
 */
export type QuickActionKind = "explain_record" | "care_plan_summary" | "appointment_prep";

export interface RunQuickActionParams {
  supabase: SupabaseClient<Database>;
  getServiceRoleSupabase: () => SupabaseClient<Database>;
  profileId: string;
  organisationId: string;
  conversationId?: string;
  kind: QuickActionKind;
}

export interface RunQuickActionResult {
  conversationId: string;
  reply: string;
}

function formatHealthRecordExplanation(record: HealthRecordExplanation): string {
  const lines: string[] = ["Here's what's on file for you right now:"];

  lines.push(
    "\nCurrent conditions: " +
      (record.currentConditions.length > 0
        ? record.currentConditions.map((c) => `${c.conditionName} (${c.status})`).join(", ")
        : "none on file.")
  );
  lines.push(
    "\nRecent results: " +
      (record.recentResults.length > 0
        ? record.recentResults
            .map((r) => `${r.code}: ${r.value ?? "pending"}${r.unit ? ` ${r.unit}` : ""} on ${r.takenAt.slice(0, 10)}`)
            .join("; ")
        : "none on file.")
  );
  lines.push(
    "\nCurrent medicines: " +
      (record.currentMedicines.length > 0
        ? record.currentMedicines.map((m) => `${m.drugName}${m.dose ? ` ${m.dose}` : ""}`).join(", ")
        : "none on file.")
  );
  lines.push(
    "\nUpcoming appointments: " +
      (record.upcomingAppointments.length > 0
        ? record.upcomingAppointments
            .map((a) => `${a.scheduledFor.slice(0, 10)}${a.reason ? ` (${a.reason})` : ""}`)
            .join(", ")
        : "none scheduled.")
  );
  lines.push(
    "\nActive care goals: " +
      (record.activeCareGoals.length > 0
        ? record.activeCareGoals.map((g) => `${g.conditionLabel}: ${g.goalTitles.join(", ")}`).join("; ")
        : "none on file.")
  );
  lines.push(
    "\nThis is exactly what's documented in your record — I haven't added any interpretation of my own."
  );
  return lines.join("\n");
}

function formatCareTasksThisMonth(tasks: CareTasksThisMonth): string {
  if (tasks.items.length === 0) {
    return `Nothing due on your care plan for ${tasks.monthLabel} that I can see.`;
  }
  const lines = [`This month (${tasks.monthLabel}):`];
  for (const item of tasks.items) {
    const mark = item.done === null ? "○" : item.done ? "✓" : "○";
    lines.push(`${mark} ${item.label} — due ${item.dueOn.slice(0, 10)}`);
  }
  return lines.join("\n");
}

function formatAppointmentPrep(summary: AppointmentPrepSummary): string {
  const lines: string[] = [];
  lines.push(
    summary.nextAppointment
      ? `Your next appointment is ${summary.nextAppointment.scheduledFor.slice(0, 10)}${
          summary.nextAppointment.reason ? ` (${summary.nextAppointment.reason})` : ""
        }. Here's what might be worth mentioning:`
      : "You don't have an appointment scheduled yet, but here's what's worth mentioning at your next one:"
  );
  lines.push(
    "\nRecent symptoms: " +
      (summary.recentSymptoms.length > 0
        ? summary.recentSymptoms
            .map((s) => `${s.description ?? "symptom"}${s.severity ? ` (severity ${s.severity}/10)` : ""}`)
            .join("; ")
        : "none logged in the last 30 days.")
  );
  lines.push(
    "\nRecent measurements: " +
      (summary.recentMeasurements.length > 0
        ? summary.recentMeasurements.map((m) => `${m.vitalType}: ${m.value}${m.unit ? ` ${m.unit}` : ""}`).join(", ")
        : "none on file.")
  );
  lines.push(
    "\nMedication issues: " +
      (summary.medicationIssues.length > 0
        ? summary.medicationIssues.map((m) => `${m.drugName} — ${m.issue}`).join("; ")
        : "none flagged.")
  );
  return lines.join("\n");
}

export async function runQuickAction(params: RunQuickActionParams): Promise<RunQuickActionResult> {
  const { supabase, getServiceRoleSupabase, profileId, organisationId, kind } = params;

  const { conversationId, fullMessages } = await resolveOrCreateConversation(
    supabase,
    organisationId,
    profileId,
    params.conversationId
  );

  // Same entitlement gate as runCoachTurn — see this file's own docstring
  // for why the daily rate limit is deliberately not applied here too.
  const hasAccess = await hasCoachAccess(supabase);
  if (!hasAccess) {
    const now = new Date().toISOString();
    const assistantMessage: CoachChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: COACH_ACCESS_DENIED_REPLY,
      tier: "routine",
      created_at: now,
    };
    await appendMessages(supabase, conversationId, fullMessages, [assistantMessage]);
    await logAssistantTurn(getServiceRoleSupabase(), {
      organisationId,
      patientId: profileId,
      conversationId,
      interactionType: quickActionInteractionType(kind),
      finalAction: "declined",
      status: "access_denied",
    });
    return { conversationId, reply: COACH_ACCESS_DENIED_REPLY };
  }

  const context = await loadPatientContext(supabase, profileId);

  let reply: string;
  switch (kind) {
    case "explain_record":
      reply = formatHealthRecordExplanation(explainHealthRecord(context));
      break;
    case "care_plan_summary":
      reply = formatCareTasksThisMonth(await careTasksThisMonth(supabase, profileId, context));
      break;
    case "appointment_prep":
      reply = formatAppointmentPrep(await prepareForAppointment(supabase, profileId, context));
      break;
  }

  const assistantMessage: CoachChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: reply,
    tier: "routine",
    created_at: new Date().toISOString(),
  };
  await appendMessages(supabase, conversationId, fullMessages, [assistantMessage]);

  await logAssistantTurn(getServiceRoleSupabase(), {
    organisationId,
    patientId: profileId,
    conversationId,
    interactionType: quickActionInteractionType(kind),
    // No model call for any of these three — deliberately deterministic,
    // see composed-surfaces.ts's own top comment. modelId/promptVersion
    // stay null, matching the "never reached a model call" convention
    // audit.ts documents for the chat's own short-circuit paths.
    finalAction: "replied",
    status: "completed",
    inputSnapshot: { kind },
  });

  return { conversationId, reply };
}

function quickActionInteractionType(
  kind: QuickActionKind
): "record_explanation" | "care_plan_summary" | "appointment_prep" {
  switch (kind) {
    case "explain_record":
      return "record_explanation";
    case "care_plan_summary":
      return "care_plan_summary";
    case "appointment_prep":
      return "appointment_prep";
  }
}
