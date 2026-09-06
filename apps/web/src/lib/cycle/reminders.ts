import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { lagosDateString } from "@/lib/ai-coach/lagos-day";
import { predictCycle, type CyclePrediction } from "@/lib/rules/cycle-prediction";

/**
 * Daily period reminders.
 *
 * Knowing a period is coming is half of what a cycle tracker is for, and it
 * is the half that only works if something reaches the patient without them
 * opening the app.
 *
 * Delivered on the `in_app` channel only. WhatsApp and SMS are deliberately
 * not used here, and not merely because those templates are still blocked on
 * Meta/Termii approval: a period reminder is the single most sensitive
 * routine message the platform sends, phones get read over shoulders and
 * shared between family members, and nothing about this is urgent enough to
 * justify that. It is also `content_class = 'non_clinical'` (the column
 * default) because it carries no result and no clinical judgement.
 *
 * The decision half is pure and unit-tested (decideCycleReminder); only
 * runCycleReminders touches the database.
 */

export type CycleReminderKind = "period_due_soon" | "period_due_today" | "period_late";

export interface CycleReminder {
  kind: CycleReminderKind;
  template: string;
  /** Anchors idempotency: one reminder of each kind per predicted period. */
  predictedDate: string;
  payload: Record<string, string | number>;
}

/** How many days ahead the heads-up goes out. */
const DUE_SOON_LEAD_DAYS = 2;

/**
 * How overdue a period must be before the late reminder goes out. Sending
 * "you are late" while the patient is still inside their own normal
 * variation is both wrong and unkind, so this sits well past the predicted
 * window rather than at its edge.
 */
const LATE_REMINDER_DAYS_OVERDUE = 3;

/**
 * Decides which reminder (if any) is due, for the day the given prediction
 * was computed for. It deliberately does NOT take its own `today`: two
 * different notions of the current day in one decision is exactly how a
 * reminder ends up describing a cycle position the patient is not in.
 *
 * Deliberately silent when:
 *   - confidence is "none" or "low" — we are not confident enough to tell
 *     somebody their period is coming, and a wrong reminder is worse than
 *     no reminder for this particular thing;
 *   - the patient is pregnant, postpartum or menopausal — the life stages
 *     where a period reminder ranges from irrelevant to painful;
 *   - a period is already being logged right now.
 */
export function decideCycleReminder(
  prediction: CyclePrediction,
  lifeStage: string
): CycleReminder | null {
  if (prediction.confidence === "none" || prediction.confidence === "low") return null;
  if (lifeStage !== "menstruating" && lifeStage !== "trying_to_conceive") return null;
  if (prediction.currentPhase === "menstrual") return null;

  const predictedDate = prediction.predictedNextPeriodDate;
  if (!predictedDate) return null;

  if (prediction.isOverdue) {
    // Deliberately a threshold (>=) and not an exact-day match. An
    // exact-day match meant the late reminder existed for exactly one
    // daily cron run, so a single missed or failed run silently dropped it
    // for that patient's whole cycle. "Send once" is enforced instead by
    // the dedupe key in runCycleReminders, which is keyed on the predicted
    // date and so holds however many times this is evaluated.
    return (prediction.daysOverdue ?? 0) >= LATE_REMINDER_DAYS_OVERDUE
      ? {
          kind: "period_late",
          template: "cycle_period_late",
          predictedDate,
          payload: {
            days_overdue: prediction.daysOverdue as number,
            expected_date: predictedDate,
          },
        }
      : null;
  }

  const daysUntil = prediction.daysUntilNextPeriod;
  if (daysUntil === null) return null;

  if (daysUntil === 0) {
    return {
      kind: "period_due_today",
      template: "cycle_period_due_today",
      predictedDate,
      payload: { expected_date: predictedDate },
    };
  }

  if (daysUntil === DUE_SOON_LEAD_DAYS) {
    return {
      kind: "period_due_soon",
      template: "cycle_period_due_soon",
      predictedDate,
      payload: { days_until: daysUntil, expected_date: predictedDate },
    };
  }

  return null;
}

export interface CycleReminderRunResult {
  patientsConsidered: number;
  remindersSent: number;
  skippedAlreadySent: number;
}

interface CycleRow {
  patient_id: string;
  organisation_id: string;
  period_start_date: string;
  period_end_date: string | null;
}

/**
 * Runs one daily pass. Reads every patient with recent period history,
 * re-runs the same prediction engine the UI uses, and inserts at most one
 * in-app notification per patient.
 */
export async function runCycleReminders(
  today: string = lagosDateString()
): Promise<CycleReminderRunResult> {
  const supabase = createServiceRoleClient();

  // Two years back is the same window the tracker reads, so the cron and the
  // page can never disagree about a prediction.
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 730);

  const { data: cycleRows, error } = await supabase
    .from("menstrual_cycles")
    .select("patient_id, organisation_id, period_start_date, period_end_date")
    .gte("period_start_date", from.toISOString().slice(0, 10));
  if (error) throw error;

  const byPatient = new Map<string, CycleRow[]>();
  for (const row of (cycleRows ?? []) as CycleRow[]) {
    const list = byPatient.get(row.patient_id);
    if (list) list.push(row);
    else byPatient.set(row.patient_id, [row]);
  }

  if (byPatient.size === 0) {
    return { patientsConsidered: 0, remindersSent: 0, skippedAlreadySent: 0 };
  }

  const patientIds = [...byPatient.keys()];

  const { data: profiles } = await supabase
    .from("reproductive_health_profiles")
    .select("patient_id, life_stage, average_cycle_length_days")
    .in("patient_id", patientIds);
  const profileByPatient = new Map(
    (profiles ?? []).map((profile) => [profile.patient_id, profile])
  );

  // Everything this run might duplicate, fetched once rather than per patient.
  const { data: recentNotifications } = await supabase
    .from("notifications")
    .select("recipient_id, template, payload")
    .in("recipient_id", patientIds)
    .in("template", ["cycle_period_due_soon", "cycle_period_due_today", "cycle_period_late"]);

  const alreadySent = new Set(
    (recentNotifications ?? []).map((row) => {
      const payload = (row.payload ?? {}) as Record<string, unknown>;
      return `${row.recipient_id}|${row.template}|${String(payload.expected_date ?? "")}`;
    })
  );

  let remindersSent = 0;
  let skippedAlreadySent = 0;
  const toInsert: {
    organisation_id: string;
    recipient_id: string;
    channel: "in_app";
    template: string;
    payload: Record<string, string | number>;
  }[] = [];

  for (const [patientId, rows] of byPatient) {
    const profile = profileByPatient.get(patientId);
    // An unset life stage means the record has a gap, not that the patient
    // is not menstruating — but a reminder is a push, so here the null-gating
    // goes the quiet way: default to the stage that receives reminders only
    // if the patient has actually been logging periods, which they have, or
    // they would not be in this loop.
    const lifeStage = profile?.life_stage ?? "menstruating";

    const prediction = predictCycle({
      periods: rows.map((row) => ({
        startDate: row.period_start_date,
        endDate: row.period_end_date,
      })),
      today,
      lifeStage,
      selfReportedCycleLengthDays: profile?.average_cycle_length_days ?? null,
    });

    const reminder = decideCycleReminder(prediction, lifeStage);
    if (!reminder) continue;

    const dedupeKey = `${patientId}|${reminder.template}|${reminder.predictedDate}`;
    if (alreadySent.has(dedupeKey)) {
      skippedAlreadySent += 1;
      continue;
    }
    alreadySent.add(dedupeKey);

    toInsert.push({
      organisation_id: rows[0].organisation_id,
      recipient_id: patientId,
      channel: "in_app",
      template: reminder.template,
      payload: reminder.payload,
    });
    remindersSent += 1;
  }

  if (toInsert.length > 0) {
    const { error: insertError } = await supabase.from("notifications").insert(toInsert);
    if (insertError) throw insertError;
  }

  return { patientsConsidered: byPatient.size, remindersSent, skippedAlreadySent };
}
