import { z } from "zod";

/**
 * Provider layer admin board (S14x): the shapes the three admin-only database functions return, and the plain-words mapping.
 * Money is integer kobo (INV-15). Nothing here carries a patient name, a reading or a raw webhook body.
 */
const kobo = z.number().int();

export const healthRowSchema = z.object({
  provider: z.string(),
  operation: z.string(),
  state: z.enum(["closed", "open", "half_open"]),
  consecutive_failures: z.number().int(),
  opened_at: z.string().nullable(),
  last_failure_at: z.string().nullable(),
  last_success_at: z.string().nullable(),
  last_error_code: z.string().nullable(),
  status: z.enum(["healthy", "degraded", "down"]),
});
export type HealthRow = z.infer<typeof healthRowSchema>;

export const breakRowSchema = z.object({
  id: z.string().uuid(),
  break_type: z.enum(["missing_in_ledger", "amount_mismatch", "missing_at_provider", "settlement_total_mismatch", "reversal_unmatched"]),
  provider_reference: z.string(),
  provider_amount_kobo: kobo.nullable(),
  ledger_amount_kobo: kobo.nullable(),
  difference_kobo: kobo.nullable(),
  detail: z.string().nullable(),
  status: z.string(),
  first_seen_at: z.string(),
  last_seen_at: z.string(),
  age_hours: z.number().int(),
  ageing_bucket: z.string(),
  closing_note: z.string().nullable(),
});
export type BreakRow = z.infer<typeof breakRowSchema>;

export const inboxRowSchema = z.object({
  id: z.string().uuid(),
  provider: z.enum(["paystack", "zoom", "resend"]),
  event_type: z.string(),
  idempotency_key: z.string(),
  signature_verified: z.boolean(),
  status: z.enum(["received", "processing", "processed", "failed", "dead", "rejected"]),
  attempt_count: z.number().int(),
  delivery_count: z.number().int(),
  replay_count: z.number().int(),
  last_error: z.string().nullable(),
  linked_entity_type: z.string().nullable(),
  linked_entity_id: z.string().nullable(),
  received_at: z.string(),
  processed_at: z.string().nullable(),
});
export type InboxRow = z.infer<typeof inboxRowSchema>;

export const glAttentionRowSchema = z.object({
  payout_id: z.string().uuid(),
  attempt: z.number().int(),
  kind: z.enum(["sent", "reversal"]),
  status: z.enum(["failed", "skipped"]),
  amount_kobo: kobo,
  error: z.string().nullable(),
  created_at: z.string(),
});
export type GlAttentionRow = z.infer<typeof glAttentionRowSchema>;

export const BREAK_LABEL: Record<BreakRow["break_type"], string> = {
  missing_in_ledger: "Paystack settled it, we have no record",
  amount_mismatch: "Amount differs from our record",
  missing_at_provider: "Paid on our side, not in a settlement yet",
  settlement_total_mismatch: "Settlement total is not the sum of its lines",
  reversal_unmatched: "Reversal with no matching payment",
};

export const INBOX_STATUSES = ["received", "processing", "processed", "failed", "dead", "rejected"] as const;
export const INBOX_PROVIDERS = ["paystack", "zoom", "resend"] as const;

export function inboxTone(status: InboxRow["status"]): "green" | "amber" | "red" | "blue" | "grey" {
  switch (status) {
    case "processed": return "green";
    case "received":
    case "failed": return "amber";
    case "processing": return "blue";
    case "dead": return "red";
    case "rejected": return "grey";
  }
}

export function healthTone(status: HealthRow["status"]): "green" | "amber" | "red" {
  return status === "healthy" ? "green" : status === "degraded" ? "amber" : "red";
}

/** Only a verified event that has finished or is waiting can be replayed; the database refuses the rest, this hides the button. */
export const canReplay = (row: Pick<InboxRow, "signature_verified" | "status">): boolean => row.signature_verified && row.status !== "rejected" && row.status !== "processing";

const ERROR_WORDS: Record<string, string> = {
  provider_event_replay_needs_reason: "Please give a reason of at least ten characters.",
  provider_event_unverified_never_replayed: "An event whose signature did not verify can never be replayed.",
  provider_event_in_flight: "That event is being handled right now. Try again in a minute.",
  reconciliation_break_needs_note: "Please write what you found, at least ten characters.",
  reconciliation_break_status_invalid: "Choose explained or resolved.",
  "only an admin": "Only an admin can do this.",
};
export function describeProviderError(raw: string | null | undefined, fallback = "Something went wrong. Nothing was changed."): string {
  const message = raw ?? "";
  for (const key of Object.keys(ERROR_WORDS)) if (message.includes(key)) return ERROR_WORDS[key] as string;
  return fallback;
}

export const idSchema = z.string().uuid();
export const reasonSchema = z.string().trim().min(10).max(300);
export const closeStatusSchema = z.enum(["explained", "resolved"]);
