/**
 * Module 21 §21.6 — "Medication likely to run out in N days."
 *
 * A best-effort estimate from data already on hand (quantity dispensed,
 * doses/day from schedule_times, and the most recent fill date) — not a
 * substitute for the clinician/patient-set refill_date, which drives the
 * existing lead-time reminder (medication_refill_reminder_rules). Returns
 * null whenever there isn't enough structured data to estimate honestly
 * (freeform dosing, or no quantity recorded) rather than guessing.
 */
export function estimateDaysRemaining(input: {
  /** medications.quantity — free text, e.g. "30" or "30 tablets". */
  quantity: string | null;
  /** medications.schedule_times, parsed. */
  scheduleTimes: string[] | null;
  /** medications.created_at (ISO) — when this prescription started. */
  startedOn: string;
  /** Latest pharmacy_order_dispenses.dispensed_on for this medication, if any. */
  lastCollectedOn?: string | null;
  /** Latest medication_receipt_confirmations.received_at for this medication, if any. */
  lastReceivedOn?: string | null;
  today?: Date;
}): number | null {
  const dosesPerDay = input.scheduleTimes?.length ?? 0;
  if (dosesPerDay <= 0) return null;

  const match = input.quantity?.match(/\d+/);
  if (!match) return null;
  const quantity = Number.parseInt(match[0], 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;

  const today = startOfDay(input.today ?? new Date());
  const candidates = [input.startedOn, input.lastCollectedOn, input.lastReceivedOn]
    .filter((value): value is string => !!value)
    .map((value) => startOfDay(new Date(value)))
    .filter((date) => !Number.isNaN(date.getTime()));
  const fillDate = candidates.length > 0 ? new Date(Math.max(...candidates.map((d) => d.getTime()))) : today;

  const daysElapsed = Math.max(0, Math.round((today.getTime() - fillDate.getTime()) / 86_400_000));
  const daysSupplied = Math.floor(quantity / dosesPerDay);

  return Math.max(0, daysSupplied - daysElapsed);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
