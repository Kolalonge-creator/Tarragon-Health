import { z } from "zod";

/**
 * §24's support tickets are narrowed to technical support only — see
 * supabase/migrations/20260903005851_narrow_support_tickets_to_technical_only.sql.
 * Every other category (appointment, laboratory, pharmacy, payment,
 * clinical navigation) is handled by navigation_requests (module 75)
 * instead, which already had a live "I need help" flow when this was built.
 */
export const supportTicketCategorySchema = z.enum(["technical"]);
export type SupportTicketCategoryInput = z.infer<typeof supportTicketCategorySchema>;

export const SUPPORT_TICKET_CATEGORY_LABEL: Record<SupportTicketCategoryInput, string> = {
  technical: "App or technical issue",
};

export const createSupportTicketSchema = z.object({
  subject: z.string().trim().min(3, "Give it a short subject").max(200),
  description: z.string().trim().min(10, "A sentence or two helps your care team get this right the first time").max(4000),
});
export type CreateSupportTicketInput = z.infer<typeof createSupportTicketSchema>;

export const ticketCommentSchema = z.object({
  ticket_id: z.string().uuid(),
  body: z.string().trim().min(1, "Write a reply first").max(4000),
});
export type TicketCommentInput = z.infer<typeof ticketCommentSchema>;

export const internalTicketCommentSchema = ticketCommentSchema.extend({
  is_internal: z.boolean().default(false),
});
export type InternalTicketCommentInput = z.infer<typeof internalTicketCommentSchema>;

export const ticketSatisfactionSchema = z.object({
  ticket_id: z.string().uuid(),
  satisfaction_score: z.number().int().min(1).max(5),
  satisfaction_comment: z.string().trim().max(1000).optional(),
});
export type TicketSatisfactionInput = z.infer<typeof ticketSatisfactionSchema>;

export const resolveTicketSchema = z.object({
  ticket_id: z.string().uuid(),
  resolution_note: z.string().trim().min(5, "Say what fixed it, so the record actually explains the resolution").max(2000),
});
export type ResolveTicketInput = z.infer<typeof resolveTicketSchema>;

export const escalateTicketSchema = z.object({
  ticket_id: z.string().uuid(),
  note: z.string().trim().min(10, "Explain what needs clinical judgment here").max(1000),
});
export type EscalateTicketInput = z.infer<typeof escalateTicketSchema>;
