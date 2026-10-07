import { z } from "zod";

/**
 * The body a partner laboratory's system sends to push structured results (S44, spec 2.12): one order, one message id of the lab's own (a retry
 * of the same id is answered, never duplicated), and coded items: a LOINC code with a number and a UCUM unit, or a qualitative value.
 * The mapping to Tarragon's analytes is the database's, per laboratory, confirmed by the CMO; nothing here translates a code.
 */
const loinc = z.string().regex(/^[0-9]{1,7}-[0-9]$/, "A LOINC code looks like 2160-0");

const numericItem = z.object({
  loinc,
  value: z.number().finite(),
  unit: z.string().max(40),
});

const qualitativeItem = z.object({
  loinc,
  value_text: z.string().min(1).max(20),
  unit: z.string().max(40).optional(),
});

export const labPushSchema = z.object({
  order_id: z.string().uuid(),
  message_id: z.string().min(6).max(120),
  items: z.array(z.union([numericItem, qualitativeItem])).min(1).max(200),
});

export type LabPushBody = z.infer<typeof labPushSchema>;

/** What a lab is told. Never the clinical reason a result is held (S27). */
export const labPushResponseSchema = z.object({
  status: z.enum(["received", "rejected"]),
  state: z.enum(["released", "held"]).optional(),
  replayed: z.boolean().optional(),
  reject_code: z.string().nullable().optional(),
  unmapped: z.array(z.object({ loinc: z.string().nullable().optional(), unit: z.string().optional(), problem: z.string().optional() })).optional(),
});
