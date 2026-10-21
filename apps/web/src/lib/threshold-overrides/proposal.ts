import { z } from "zod";
import { validateOverrideParams, type OverrideDomain } from "@tarragon/clinical";

/**
 * Reads the "set a personal threshold" form. Pure: the safety clamps are the engine's own (`validateOverrideParams`), the same numbers the database
 * enforces, so the form refuses first with a clear message and the database refuses regardless. The period is checked against the signed policy
 * maximum by the database (the page shows the maximum).
 */
const optionalNumber = z.preprocess((v) => (v === "" || v === null || v === undefined ? undefined : v), z.coerce.number().finite().optional());

const schema = z.object({
  patient_id: z.string().uuid(),
  domain: z.enum(["bp", "glucose"]),
  reason: z.string().trim().min(10, "Write the clinical reason in at least 10 characters.").max(1000, "Keep the reason under 1000 characters."),
  days: z.coerce.number().int("Enter whole days.").min(1, "Enter 1 or more days.").max(180, "Enter at most 180 days."),
  bp_target_systolic: optionalNumber,
  bp_target_diastolic: optionalNumber,
  bp_low_amber: optionalNumber,
  glucose_alert: optionalNumber,
  glucose_severe: optionalNumber,
});

export type Proposal = { patientId: string; domain: OverrideDomain; params: Record<string, unknown>; reason: string; days: number };

export function parseProposal(form: FormData): { ok: true; value: Proposal } | { ok: false; error: string } {
  const parsed = schema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Please check the form." };
  const d = parsed.data;
  const params: Record<string, unknown> = {};
  if (d.domain === "bp") {
    if ((d.bp_target_systolic === undefined) !== (d.bp_target_diastolic === undefined)) return { ok: false, error: "Enter both numbers of the target, or neither." };
    if (d.bp_target_systolic !== undefined && d.bp_target_diastolic !== undefined) params["target"] = { systolic: d.bp_target_systolic, diastolic: d.bp_target_diastolic };
    if (d.bp_low_amber !== undefined) params["lowAmberSystolic"] = d.bp_low_amber;
  } else {
    if (d.glucose_alert !== undefined) params["hypoAlertMmol"] = d.glucose_alert;
    if (d.glucose_severe !== undefined) params["hypoSevereMmol"] = d.glucose_severe;
  }
  const errors = validateOverrideParams(d.domain, params);
  if (errors.length > 0) return { ok: false, error: `${errors[0]}. Personal settings can only stay inside the safety limits.` };
  return { ok: true, value: { patientId: d.patient_id, domain: d.domain, params, reason: d.reason, days: d.days } };
}
