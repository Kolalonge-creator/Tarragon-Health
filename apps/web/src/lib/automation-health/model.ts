import { z } from "zod";

/** S80b: the automations registry (spec 25.8). The database computes health; this parses it and fixes the notice vocabulary. */
export const HEALTHS = ["failed", "unowned", "stale", "ok", "disabled"] as const;
export type Health = (typeof HEALTHS)[number];
export const OWNER_ROLES = ["admin", "operations", "finance", "clinical_lead", "engineering"] as const;

export const automationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(["pg_cron", "vercel_cron", "edge"]),
  schedule: z.string().nullable(),
  enabled: z.boolean(),
  owner_role: z.string().nullable(),
  owner_user_name: z.string().nullable(),
  runbook_url: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_status: z.string().nullable(),
  health: z.enum(HEALTHS),
  can_edit: z.boolean(),
});
export type AutomationRow = z.infer<typeof automationRowSchema>;
export const automationRowsSchema = z.array(automationRowSchema);

export const NOTICES = ["saved", "failed", "denied"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: string | undefined): Notice | null => (NOTICES as readonly string[]).includes(v ?? "") ? (v as Notice) : null;

export const ownerFormSchema = z.object({
  id: z.string().uuid(),
  owner_role: z.enum(OWNER_ROLES),
  runbook_url: z.string().url().startsWith("https://").max(500).or(z.literal("")).transform((v) => (v === "" ? null : v)),
  interval: z.coerce.number().int().positive().max(525600).nullable().or(z.literal("").transform(() => null)),
});

export function groupByHealth(rows: AutomationRow[]): Record<Health, AutomationRow[]> {
  const out: Record<Health, AutomationRow[]> = { failed: [], unowned: [], stale: [], ok: [], disabled: [] };
  for (const r of rows) out[r.health].push(r);
  return out;
}
