import { z } from "zod";

/** S81: research governance (spec 26). The database decides every status and permission; this parses answers and fixes the vocabulary. */
export const RESEARCH_FIELDS = [
  "pathway_code", "day", "enrolment_month", "bp_avg_7d_sys", "bp_avg_7d_dia", "bp_readings_7d", "bp_status",
  "target_source", "adherence_pct", "adherence_doses_due", "config_version", "computed_month",
] as const;
export const RECIPIENT_TYPES = ["academic", "public_health_body", "ngo", "regulator", "internal_quality"] as const;

export const protocolRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  recipient_name: z.string(),
  recipient_type: z.enum(RECIPIENT_TYPES),
  status: z.enum(["draft", "approved", "closed"]),
  ethics_approval_ref: z.string().nullable(),
  data_sharing_agreement_ref: z.string().nullable(),
  cmo_approved: z.boolean(),
  dpo_confirmed: z.boolean(),
  export_count: z.coerce.number(),
  can_approve: z.boolean(),
  can_confirm_dpo: z.boolean(),
  can_export: z.boolean(),
});
export type ProtocolRow = z.infer<typeof protocolRowSchema>;
export const protocolRowsSchema = z.array(protocolRowSchema);

export const NOTICES = ["created", "approved", "failed", "denied"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: string | undefined): Notice | null => (NOTICES as readonly string[]).includes(v ?? "") ? (v as Notice) : null;

export const createFormSchema = z.object({
  title: z.string().trim().min(5).max(200),
  question: z.string().trim().min(20).max(1000),
  method: z.string().trim().min(20).max(1000),
  recipient: z.string().trim().min(3).max(200),
  recipient_type: z.enum(RECIPIENT_TYPES),
  ethics_ref: z.string().trim().max(100),
  ethics_body: z.string().trim().max(200),
  ethics_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).or(z.literal("")),
  agreement: z.string().trim().max(100),
  fields: z.array(z.enum(RESEARCH_FIELDS)).min(1),
});

/** CSV for a released export. Values are escaped; a leading = + - @ is neutralised so a spreadsheet never runs one as a formula. */
export function toCsv(fields: readonly string[], rows: readonly Record<string, unknown>[]): string {
  const cols = ["participant", ...fields];
  const cell = (v: unknown): string => {
    let t = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
