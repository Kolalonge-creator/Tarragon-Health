import { z } from "zod";

/**
 * Cover the patient typed in for the emergency card (S09y): HMO or NHIA, a member number and a plan name. Optional, patient entered, never checked
 * against a scheme, and shown on the printed card and the live emergency view ONLY when filled. Pure, so the web card, the QR text, the phone and the
 * tests all share it. Mirrors public.emergency_card_coverage and public.set_emergency_card_coverage.
 *
 * Deliberately NOT part of the lock-screen payload: that field list awaits CMO sign-off.
 */
export interface EmergencyCoverage {
  scheme: "hmo" | "nhia";
  member_number: string | null;
  plan_name: string | null;
  provenance: "patient_entered";
}

export const COVERAGE_SCHEME_LABEL: Record<EmergencyCoverage["scheme"], string> = { hmo: "HMO", nhia: "NHIA" };

/** The database's own limits, so a form refuses what the function would. */
export const MEMBER_NUMBER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 /._-]*$/;
const CONTROL_OR_ANGLE = /[\u0000-\u001f\u007f<>]/;

export const coverageInputSchema = z
  .object({
    scheme: z.enum(["hmo", "nhia"]),
    member_number: z.string().trim().max(40).optional().default(""),
    plan_name: z.string().trim().max(80).optional().default(""),
  })
  .superRefine((v, ctx) => {
    if (v.member_number !== "" && (v.member_number.length < 3 || !MEMBER_NUMBER_PATTERN.test(v.member_number))) {
      ctx.addIssue({ code: "custom", path: ["member_number"], message: "member_number" });
    }
    if (v.plan_name !== "" && (v.plan_name.length < 2 || CONTROL_OR_ANGLE.test(v.plan_name))) {
      ctx.addIssue({ code: "custom", path: ["plan_name"], message: "plan_name" });
    }
  });
export type CoverageInput = z.input<typeof coverageInputSchema>;

/** Narrows whatever a payload or a row gave to cover the card may show, or null (nothing filled, or an unknown scheme). */
export function toEmergencyCoverage(value: unknown): EmergencyCoverage | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const scheme = v.scheme === "hmo" || v.scheme === "nhia" ? v.scheme : null;
  const member = typeof v.member_number === "string" && v.member_number.trim() !== "" ? v.member_number : null;
  const plan = typeof v.plan_name === "string" && v.plan_name.trim() !== "" ? v.plan_name : null;
  if (!scheme || (!member && !plan)) return null;
  return { scheme, member_number: member, plan_name: plan, provenance: "patient_entered" };
}
