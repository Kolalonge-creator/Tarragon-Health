import { z } from "zod";

/**
 * EMP: the employer seat pilot. Pure helpers shared by the employer page, the CSV route and the finance form.
 *
 * Rule I9: the employer sees counts only. Everything an employer can see about a pilot is the JSON that
 * `employer_seat_pilot_report` returns, parsed here with a CLOSED shape (unknown keys are dropped, never passed on), and the CSV
 * is built from that same parsed object. There is no second query, so the CSV can never carry more than the page does.
 */

const count = z.number().int().nonnegative();
const nullableCount = count.nullable();

export const pilotReportSchema = z.object({
  pilot: z.object({
    id: z.string().uuid(),
    state: z.enum(["draft", "invoiced", "active", "ended", "cancelled"]),
    starts_on: z.string(),
    ends_on: z.string(),
    terms_version: z.string(),
    total_kobo: z.number().int().nonnegative(),
    seat_price_kobo: z.number().int().nonnegative(),
  }),
  seats: z.object({
    purchased: count,
    claimed: count,
    active: count,
    unclaimed: count,
    claims_without_seat: count,
  }),
  usage: z.union([
    z.object({ suppressed: z.literal(true), reason: z.string() }),
    z.object({
      suppressed: z.literal(false),
      members_with_consultation: nullableCount,
      consultations_completed: nullableCount,
      members_with_check_in: nullableCount,
    }),
  ]),
  min_cell: count,
  rounded_to: count,
  usage_through: z.string(),
  generated_at: z.string(),
});
export type PilotReport = z.infer<typeof pilotReportSchema>;

export function parsePilotReport(raw: unknown): PilotReport | null {
  const r = pilotReportSchema.safeParse(raw);
  return r.success ? r.data : null;
}

/** Whole naira text for an integer kobo amount (INV-15: stored as kobo, shown as naira). */
export function nairaFromKobo(kobo: number): string {
  const naira = Math.trunc(kobo / 100);
  return `NGN ${naira.toLocaleString("en-NG")}`;
}

function csvCell(v: string | number | null): string {
  if (v === null) return "";
  const s = String(v);
  // spreadsheet formula injection: a cell never starts with = + - @ tab or CR
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The report as CSV: label, value, note. Aggregate rows only; a suppressed figure is written as "withheld". */
export function pilotReportToCsv(report: PilotReport): string {
  const withheld = "withheld";
  const rows: Array<[string, string | number | null, string]> = [
    ["Report generated", report.generated_at, ""],
    ["Terms version", report.pilot.terms_version, ""],
    ["Pilot state", report.pilot.state, ""],
    ["Claim window starts", report.pilot.starts_on, ""],
    ["Claim window ends", report.pilot.ends_on, ""],
    ["Seats purchased", report.seats.purchased, ""],
    ["Seats claimed", report.seats.claimed, ""],
    ["Seats active", report.seats.active, ""],
    ["Seats not yet claimed", report.seats.unclaimed, ""],
    ["Claims waiting for a seat", report.seats.claims_without_seat, ""],
  ];
  const note = `Rounded to the nearest ${report.rounded_to}. Counts under ${report.min_cell} people are withheld. Through ${report.usage_through}.`;
  if (report.usage.suppressed) {
    rows.push(["Members who had a consultation", withheld, "Too few members yet to report usage"]);
    rows.push(["Consultations completed", withheld, "Too few members yet to report usage"]);
    rows.push(["Members who logged a check-in", withheld, "Too few members yet to report usage"]);
  } else {
    rows.push(["Members who had a consultation", report.usage.members_with_consultation ?? withheld, note]);
    rows.push(["Consultations completed", report.usage.consultations_completed ?? withheld, note]);
    rows.push(["Members who logged a check-in", report.usage.members_with_check_in ?? withheld, note]);
  }
  return ["Measure,Value,Note", ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n") + "\r\n";
}

// --- Finance form ------------------------------------------------------------------------------------------------------------

export const createPilotSchema = z
  .object({
    organisationId: z.string().uuid("Choose an employer."),
    benefitPackageId: z.string().uuid("Choose the Membership benefit package."),
    seats: z.coerce.number().int("Seats must be a whole number.").min(1, "Seats must be at least 1."),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date."),
    termsVersion: z.string().trim().min(1, "Enter the terms version the employer accepted.").max(60),
  })
  .refine((d) => d.endsOn >= d.startsOn, { message: "The end date must not be before the start date.", path: ["endsOn"] });

export const confirmPaymentSchema = z.object({
  pilotId: z.string().uuid(),
  method: z.enum(["bank_transfer", "paystack_link"]),
  reference: z.string().trim().min(4, "Enter the bank or Paystack reference (at least 4 characters).").max(120),
});

export const closePilotSchema = z.object({
  pilotId: z.string().uuid(),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
});

const ERROR_TEXT: Record<string, string> = {
  pilot_not_authorised: "Only finance can do this.",
  pilot_unknown_employer: "That organisation has no employer account.",
  pilot_needs_membership_package: "Create a Membership benefit package for this employer first.",
  pilot_seat_count_out_of_range: "That seat count is outside the allowed range for a pilot.",
  pilot_window_invalid: "Check the dates: the window cannot start in the past or run longer than the allowed length.",
  pilot_terms_version_needed: "Enter the terms version.",
  pilot_no_price_in_force: "No organisation Membership price is in force.",
  pilot_not_in_draft: "This pilot already has an invoice.",
  pilot_not_awaiting_payment: "This pilot is not waiting for payment.",
  pilot_already_paid_other_reference: "This pilot was already confirmed with a different reference.",
  pilot_payment_reference_invalid: "Enter the bank or Paystack reference (4 to 120 characters).",
  pilot_reason_needed: "Give a reason of at least 10 characters.",
  pilot_unknown: "That pilot was not found.",
  organisation_membership_not_open: "Organisation Membership is not switched on yet.",
};

/** Maps a database error to words a finance person can act on. Unknown errors become a neutral line, never raw SQL text. */
export function pilotErrorText(message: string | undefined): string {
  if (!message) return "Something went wrong. Please try again.";
  for (const [code, text] of Object.entries(ERROR_TEXT)) if (message.includes(code)) return text;
  if (message.includes("employer_seat_pilots_payment_reference_key")) return "That reference has already been used for another pilot.";
  if (message.includes("employer_seat_pilots_one_live_per_org")) return "This employer already has a live pilot. Close it before starting another.";
  if (message.includes("employer_invoices_org_period_key")) return "An invoice already exists for this employer and these dates.";
  return "Something went wrong. Please try again.";
}
