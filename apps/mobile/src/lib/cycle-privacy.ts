/**
 * Parsers for the two privacy RPCs on mobile (S66). The functions return jsonb, so the shape is checked here: a reply that does not match is
 * a failure the screen reports, never silently read as "nothing there". Plain guards (the mobile app carries no schema library).
 */

export interface AccessRow {
  at: string;
  result: "success" | "denied";
  reader: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function parseAccessLog(raw: unknown): AccessRow[] | "failed" {
  if (!Array.isArray(raw)) return "failed";
  const out: AccessRow[] = [];
  for (const row of raw) {
    if (!isObj(row) || typeof row.at !== "string" || typeof row.reader !== "string" || (row.result !== "success" && row.result !== "denied")) return "failed";
    out.push({ at: row.at, result: row.result, reader: row.reader });
  }
  return out;
}

export interface DeletionStatus {
  pending: { execute_after: string; requested_at: string } | null;
  lastReceipt: {
    completed_at: string;
    receipt: { menstrual_cycles_deleted: number; menstrual_daily_logs_deleted: number; menopause_logs_deleted: number; menopause_logs_sealed_kept: number; reminders_deleted: number };
  } | null;
  counts: { menstrual_cycles: number; menstrual_daily_logs: number; menopause_logs_deleted: number; menopause_logs_sealed: number; reminders: number };
}

export function parseDeletionStatus(raw: unknown): DeletionStatus | "failed" {
  if (!isObj(raw) || !isObj(raw.counts)) return "failed";
  const c = raw.counts;
  if (![c.menstrual_cycles, c.menstrual_daily_logs, c.menopause_logs_deleted, c.menopause_logs_sealed, c.reminders].every(isNum)) return "failed";
  let pending: DeletionStatus["pending"] = null;
  if (raw.pending !== null) {
    if (!isObj(raw.pending) || typeof raw.pending.execute_after !== "string" || typeof raw.pending.requested_at !== "string") return "failed";
    pending = { execute_after: raw.pending.execute_after, requested_at: raw.pending.requested_at };
  }
  let lastReceipt: DeletionStatus["lastReceipt"] = null;
  if (raw.last_receipt !== null) {
    const r = raw.last_receipt;
    if (!isObj(r) || typeof r.completed_at !== "string" || !isObj(r.receipt)) return "failed";
    const x = r.receipt;
    if (![x.menstrual_cycles_deleted, x.menstrual_daily_logs_deleted, x.menopause_logs_deleted, x.menopause_logs_sealed_kept, x.reminders_deleted].every(isNum)) return "failed";
    lastReceipt = {
      completed_at: r.completed_at,
      receipt: {
        menstrual_cycles_deleted: x.menstrual_cycles_deleted as number,
        menstrual_daily_logs_deleted: x.menstrual_daily_logs_deleted as number,
        menopause_logs_deleted: x.menopause_logs_deleted as number,
        menopause_logs_sealed_kept: x.menopause_logs_sealed_kept as number,
        reminders_deleted: x.reminders_deleted as number,
      },
    };
  }
  return {
    pending,
    lastReceipt,
    counts: {
      menstrual_cycles: c.menstrual_cycles as number,
      menstrual_daily_logs: c.menstrual_daily_logs as number,
      menopause_logs_deleted: c.menopause_logs_deleted as number,
      menopause_logs_sealed: c.menopause_logs_sealed as number,
      reminders: c.reminders as number,
    },
  };
}
