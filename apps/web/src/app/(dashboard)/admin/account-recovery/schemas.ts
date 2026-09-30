import { z } from "zod";

/** The only identity checks the database accepts (private.valid_identity_checks). Names only, never the evidence. */
export const IDENTITY_CHECKS = [
  { key: "date_of_birth", label: "Date of birth matched the record" },
  { key: "last_payment_reference", label: "Last payment reference matched" },
  { key: "callback_to_verified_number", label: "Called back on the number on file" },
  { key: "recent_appointment_detail", label: "Recent appointment detail matched" },
  { key: "id_document_sighted", label: "Photo ID sighted (not stored)" },
] as const;

export const RECOVERY_METHODS = ["email_link_to_verified_email", "new_phone_reverification"] as const;

const checkKeys = IDENTITY_CHECKS.map((c) => c.key) as [string, ...string[]];

export const searchSchema = z.object({
  query: z.string().trim().min(2, "Type at least 2 characters.").max(100),
  reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500),
});

export const requestSchema = z.object({
  subjectId: z.string().uuid(),
  reason: z.string().trim().min(20, "Give a reason of at least 20 characters.").max(1000),
  identityChecks: z
    .record(z.enum(checkKeys), z.boolean())
    .refine((c) => Object.values(c).filter(Boolean).length >= 2, "Record at least two identity checks you completed."),
  method: z.enum(RECOVERY_METHODS),
});

export const requestIdSchema = z.object({ requestId: z.string().uuid() });
export const rejectSchema = requestIdSchema.extend({ reason: z.string().trim().min(10, "Give a reason of at least 10 characters.").max(500) });
export const simSwapSchema = requestIdSchema.extend({ note: z.string().trim().min(20, "Describe the extra check in at least 20 characters.").max(500) });
export const executeSchema = requestIdSchema.extend({
  // Only used for the phone method. Never persisted by us; handed straight to Auth.
  newPhone: z.string().trim().regex(/^\+[1-9][0-9]{7,14}$/, "Enter the new number in international format, like +2348012345678.").optional(),
});

export type ActionResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export const ERROR_COPY: Record<string, string> = {
  not_authorised: "Only an admin can do this.",
  cannot_recover_own_account: "You cannot start a recovery on your own account.",
  subject_not_eligible: "That person cannot be recovered through this tool.",
  request_already_open: "There is already an open recovery request for this person.",
  no_verified_email_on_file: "This person has no verified email on file. Use the new phone method instead.",
  requester_cannot_approve: "A different admin must approve this request.",
  requester_cannot_review: "A different admin must do the extra phone-change review.",
  sim_swap_review_required: "Their phone was changed recently. A different admin must complete the extra review first.",
  wrong_state: "This request is not in a state that allows that step.",
  expired: "This request has expired. Start a new one if it is still needed.",
  not_found: "We could not find that request.",
  not_reviewable: "This request does not need, or has already had, that review.",
  not_recordable: "That outcome cannot be recorded.",
};
