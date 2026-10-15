import { z } from "zod";

/**
 * S80 (25.8): the automations registry screen. The database decides everything (who may pause, which jobs are safety critical, what
 * the cron job is doing); this parses the answer and turns it into fixed notices. Nothing here guesses an owner or a purpose.
 */
export const automationRowSchema = z.object({
  job_name: z.string(),
  purpose: z.string().nullable(),
  owner: z.string(),
  schedule: z.string().nullable(),
  source: z.enum(["pg_cron", "vercel"]),
  safety_critical: z.boolean(),
  is_paused: z.boolean(),
  paused_at: z.string().nullable(),
  reason: z.string().nullable(),
  last_run_at: z.string().nullable(),
  last_status: z.string().nullable(),
  registered: z.boolean(),
});
export type AutomationRow = z.infer<typeof automationRowSchema>;
export const automationRowsSchema = z.array(automationRowSchema);

export const NOTICES = ["paused", "resumed", "pause_failed", "pause_denied", "pause_safety", "pause_vercel", "reason_short"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

export const pauseFormSchema = z.object({
  job_name: z.string().trim().min(1).max(200),
  paused: z.enum(["true", "false"]).transform((v) => v === "true"),
  reason: z.string().trim().max(300),
});

/** Whether the screen offers a pause control for this row (the database still decides). */
export function pauseState(r: AutomationRow): "paused" | "safety_critical" | "vercel" | "unregistered" | "can_pause" {
  if (r.is_paused) return "paused";
  if (!r.registered) return "unregistered";
  if (r.safety_critical) return "safety_critical";
  if (r.source === "vercel") return "vercel";
  return "can_pause";
}

export function noticeForError(code: string | undefined): Notice {
  if (code === "42501") return "pause_denied";
  if (code === "23514") return "pause_safety";
  if (code === "0A000") return "pause_vercel";
  if (code === "22023") return "reason_short";
  return "pause_failed";
}
