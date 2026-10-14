import { z } from "zod";

/**
 * S74 (module 21): shapes, labels and error mapping for the partner portal, the admin partner desk and the pharmacist conversation. Pure: no I/O.
 * The database decides every outcome; this file only gives a plain-words reading of what it returned. Every answer is parsed, and a parse failure
 * is shown as a load failure, never as an empty list.
 */
export const PARTNER_KINDS = ["lab", "pharmacy", "clinic"] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = { lab: "Laboratory", pharmacy: "Pharmacy", clinic: "Clinic" };

export const BREACH_LABEL: Record<string, string> = {
  licence_expired: "Licence expired",
  complaints_upheld_limit: "Too many upheld complaints",
  turnaround_below_target: "Results are too often later than the target",
  score_below_floor: "Overall score is below the floor",
};
export const breachLabel = (code: string): string => BREACH_LABEL[code] ?? code.replace(/_/g, " ");

export const LICENCE_LABEL: Record<string, string> = {
  current: "Current",
  expiring: "Expires soon",
  expired: "Expired",
  unverified: "Not yet verified",
  not_tracked: "Not tracked",
};

export const COMPLAINT_CATEGORIES = ["late_result", "wrong_result", "communication", "charge_dispute", "safety", "licence", "other"] as const;
export const COMPLAINT_LABEL: Record<(typeof COMPLAINT_CATEGORIES)[number], string> = {
  late_result: "Late result",
  wrong_result: "Wrong result",
  communication: "Communication",
  charge_dispute: "Charge dispute",
  safety: "Safety",
  licence: "Licence",
  other: "Other",
};

export const partnerQualitySchema = z.object({
  partner_kind: z.enum(PARTNER_KINDS),
  work_state: z.enum(["open", "suspended"]),
  reason_codes: z.array(z.string()),
  score: z.number().nullable(),
  breaches: z.array(z.string()),
  licence_state: z.string().nullable(),
  licence_expires_at: z.string().nullable(),
  turnaround_target_hours: z.number().nullable(),
  turnaround_median_hours: z.number().nullable(),
  pct_within_target: z.number().nullable(),
  orders_measured: z.number().nullable(),
  complaints_upheld: z.number().nullable(),
  complaints_open: z.number().nullable(),
  complaints: z.array(z.object({ category: z.string(), state: z.string(), opened: z.string(), resolved: z.string().nullable() })),
  computed_at: z.string().nullable(),
});
export type PartnerQuality = z.infer<typeof partnerQualitySchema>;

export const overviewRowSchema = z.object({
  partner_kind: z.enum(PARTNER_KINDS),
  partner_id: z.string().uuid(),
  partner_name: z.string().nullable(),
  is_active: z.boolean(),
  work_state: z.enum(["open", "suspended"]),
  reason_codes: z.array(z.string()),
  score: z.number().nullable(),
  breaches: z.array(z.string()),
  licence_state: z.string().nullable(),
  licence_expires_at: z.string().nullable(),
  pct_within_target: z.number().nullable(),
  orders_measured: z.number().nullable(),
  complaints_upheld: z.number().nullable(),
  complaints_open: z.number().nullable(),
  computed_at: z.string().nullable(),
  override_until: z.string().nullable(),
});
export type OverviewRow = z.infer<typeof overviewRowSchema>;
export const overviewSchema = z.array(overviewRowSchema);

export const statementRowSchema = z.object({
  settlement_id: z.string().uuid(),
  period_month: z.string(),
  amount_kobo: z.number().int(),
  item_count: z.number().int(),
  state: z.enum(["issued", "disputed", "settled"]),
  issued_at: z.string().nullable(),
  settled_at: z.string().nullable(),
  external_reference: z.string().nullable(),
  disputed_at: z.string().nullable(),
});
export type StatementRow = z.infer<typeof statementRowSchema>;
export const statementsSchema = z.array(statementRowSchema);

export const statementLineSchema = z.object({
  line_ref: z.string(),
  paid_on: z.string(),
  catalog_code: z.string(),
  basis_amount_kobo: z.number().int(),
  amount_kobo: z.number().int(),
});
export const statementLinesSchema = z.array(statementLineSchema);

export const adminSettlementSchema = z.object({
  settlement_id: z.string().uuid(),
  partner_kind: z.enum(["pharmacy", "clinic"]),
  partner_id: z.string().uuid(),
  partner_name: z.string().nullable(),
  period_month: z.string(),
  amount_kobo: z.number().int(),
  item_count: z.number().int(),
  state: z.enum(["draft", "issued", "disputed", "settled", "void"]),
  issued_at: z.string().nullable(),
  settled_at: z.string().nullable(),
  dispute_note: z.string().nullable(),
});
export type AdminSettlement = z.infer<typeof adminSettlementSchema>;
export const adminSettlementsSchema = z.array(adminSettlementSchema);

export const previewRowSchema = z.object({
  term_id: z.string().uuid(),
  partner_kind: z.enum(["pharmacy", "clinic"]),
  partner_id: z.string().uuid(),
  partner_name: z.string().nullable(),
  orders: z.number().int(),
  amount_kobo: z.number().int(),
});
export const previewSchema = z.array(previewRowSchema);

export const findingSchema = z.object({ finding: z.string(), order_id: z.string().uuid(), detail: z.string().nullable() });
export const findingsSchema = z.array(findingSchema);

export const conversationMessageSchema = z.object({
  message_id: z.string().uuid(),
  sender_kind: z.enum(["patient", "pharmacist"]),
  body: z.string(),
  sent_at: z.string(),
  is_open: z.boolean(),
});
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export const conversationSchema = z.array(conversationMessageSchema);

export const conversationListSchema = z.array(
  z.object({ prescription_id: z.string().uuid(), last_message_at: z.string().nullable(), unread: z.boolean().nullable(), is_open: z.boolean() }),
);

/** The month of a statement as "October 2026" (Lagos calendar month; the database stores the first day). */
export function monthLabel(isoDate: string): string {
  const d = new Date(`${isoDate.slice(0, 7)}-01T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

export const STATEMENT_STATE_LABEL: Record<string, string> = {
  draft: "Draft, not yet sent",
  issued: "Issued",
  disputed: "You raised a question",
  settled: "Paid",
  void: "Withdrawn",
};

const ERRORS: ReadonlyArray<readonly [string, string]> = [
  ["licence_expired_renew_first", "The licence has expired. Renew it first; an expired licence cannot be reinstated."],
  ["partner_not_suspended", "That partner is not suspended."],
  ["settlement_guard_off", "Partner settlement is not switched on yet."],
  ["settlement_not_issuable", "That statement cannot be issued in its current state."],
  ["nothing_to_issue", "There is nothing to issue: the amount is zero."],
  ["settlement_not_issued", "Only an issued statement can be recorded as paid."],
  ["settlement_not_disputable", "That statement can no longer be questioned."],
  ["four_eyes", "A second person must approve these terms."],
  ["laboratories are owed nothing", "Laboratories are paid by the patient directly, so no settlement is made for them."],
  ["chat_closed", "This conversation is closed."],
  ["message_limit_reached", "You have reached today's message limit. Please try again tomorrow."],
  ["message_invalid", "Please write a message of up to 1,000 characters."],
  ["the patient starts the conversation", "The patient starts the conversation. You can reply once they write."],
  ["nafdac_number_invalid", "That does not look like a NAFDAC registration number, for example A4-1234."],
  ["supplier_invalid", "Please give the supplier's name."],
  ["sourcing_already_recorded", "The source was already recorded for this supply and cannot be changed."],
  ["slot_full", "That time is full."],
  ["hold_expired", "Your hold on that time ran out. Please choose it again."],
  ["clinic_not_bookable", "That clinic is not taking bookings right now."],
  ["partner_suspended_from_new_work", "That partner is not taking new work right now."],
];

/** A plain-words reading of a database error. Anything unknown is a plain failure that changed nothing. */
export function describePartnerError(error: { message?: string } | null | undefined, fallback = "That did not work. Please try again."): string {
  const m = error?.message ?? "";
  for (const [code, text] of ERRORS) if (m.includes(code)) return text;
  if (m.includes("only an admin") || m.includes("This action is for") || m.includes("not found")) return "You do not have access to that.";
  if (m.startsWith("say why") || m.startsWith("say what") || m.startsWith("record ")) return m;
  return fallback;
}

export const reasonSchema = z.string().trim().min(20, "Please give a reason of at least 20 characters.").max(500);
export const shortNoteSchema = z.string().trim().min(10, "Please write at least 10 characters.").max(500);

export const complaintFormSchema = z.object({
  kind: z.enum(PARTNER_KINDS),
  partner: z.string().uuid(),
  category: z.enum(COMPLAINT_CATEGORIES),
  note: z.string().trim().max(500).optional(),
});
export const resolveComplaintSchema = z.object({ id: z.string().uuid(), outcome: z.enum(["upheld", "dismissed"]), note: shortNoteSchema });
export const suspendSchema = z.object({ kind: z.enum(PARTNER_KINDS), partner: z.string().uuid(), reason: reasonSchema });
export const settlementIdSchema = z.object({ id: z.string().uuid() });
export const paidSchema = z.object({ id: z.string().uuid(), reference: z.string().trim().min(4).max(120) });
export const voidSchema = z.object({ id: z.string().uuid(), reason: shortNoteSchema });
export const disputeSchema = z.object({ id: z.string().uuid(), note: shortNoteSchema });
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/).optional() });
export const declareSourcingSchema = z.object({ statement: z.string().trim().min(20, "Please say which registered distributors you buy from (at least 20 characters).").max(500) });
export const verifySourcingSchema = z.object({ partner: z.string().uuid(), note: reasonSchema, months: z.coerce.number().int().min(1).max(24).default(12) });
export const recordSourcingSchema = z.object({
  dispense: z.string().uuid(),
  nafdac: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,3}-[0-9]{3,6}[A-Z]?$/, "That does not look like a NAFDAC registration number, for example A4-1234."),
  supplier: z.string().trim().min(2).max(120),
});
export const messageSchema = z.object({ prescription: z.string().uuid(), body: z.string().trim().min(1, "Please write a message.").max(1000, "Messages can be up to 1,000 characters.") });
export const termsSchema = z.object({
  kind: z.enum(["pharmacy", "clinic"]),
  partner: z.string().uuid(),
  catalogCode: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/, "Choose a catalogue item."),
  source: z.enum(["sponsor_paid_item", "pharmacy_margin"]),
  basis: z.enum(["fixed_kobo", "basis_points"]),
  value: z.coerce.number().int().positive(),
  sponsorPaidOnly: z.boolean().default(true),
  reason: reasonSchema,
});
