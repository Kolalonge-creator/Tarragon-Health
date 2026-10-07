import { z } from "zod";
import { getProposedConfig } from "@tarragon/shared";

/**
 * S36e: the reliability and SLA dashboard (spec 9.5, 9.4). Every answer from `reliability_dashboard` is parsed here; the database
 * decides who may read and what the ops door leaves out, so this model never hides or reveals anything by itself. A parse failure is a
 * load failure on the screen, never a row of zeros.
 */
export interface DashboardSettings {
  gap_days: number;
  min_group: number;
  bands: { key: string; min: number }[];
}

/** The display settings (PROPOSED, CMO owner): rota look-ahead, smallest group that may show a distribution, score bands. */
export function dashboardSettings(): DashboardSettings {
  return getProposedConfig("reliability.dashboard").value as unknown as DashboardSettings;
}

const waitingRow = z.object({
  priority_class: z.number().int(),
  waiting: z.number().int(),
  oldest_wait_minutes: z.number().int(),
  past_due: z.number().int(),
  oldest_past_due_minutes: z.number().int(),
});
const pageRow = z.object({ sent_at: z.string(), seconds_waiting: z.number().int(), level: z.number().int().nullable(), no_cover: z.boolean() });
const gapRow = z.object({ from: z.string(), to: z.string(), kind: z.string() });
const individualRow = z.object({
  name: z.string(),
  tier: z.string().nullable(),
  score: z.number().nullable(),
  events: z.number().int(),
  handbacks: z.number().int(),
});

export const dashboardSchema = z.object({
  viewer: z.enum(["lead", "ops"]),
  generated_at: z.string(),
  window_days: z.number().int(),
  tasks: z.object({ waiting: z.array(waitingRow), claimed: z.number().int(), claimed_past_due: z.number().int() }),
  pages: z.object({
    window_minutes: z.number().int(),
    total: z.number().int(),
    acknowledged: z.number().int(),
    acknowledged_in_window: z.number().int(),
    no_cover: z.number().int(),
    median_ack_seconds: z.number().int().nullable(),
    p90_ack_seconds: z.number().int().nullable(),
    unacknowledged: z.array(pageRow),
  }),
  cover: z.object({
    covered_now: z.boolean(),
    primary_on_call: z.boolean(),
    backup_on_call: z.boolean(),
    gap_days: z.number().int(),
    gaps: z.array(gapRow),
  }),
  handbacks: z.record(z.string(), z.number().int()),
  distribution: z.object({
    clinicians: z.number().int(),
    min_group: z.number().int(),
    suppressed: z.boolean(),
    scores: z.array(z.number()).nullable(),
  }),
  on_call: z.object({ primary: z.string().nullable(), backup: z.string().nullable() }).optional(),
  individuals: z.array(individualRow).optional(),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

/** Hand-back rate over the work that ended in a claim (completed, expired or handed back). Null when there is nothing to divide. */
export function handbackRate(h: Dashboard["handbacks"]): { handedBack: number; total: number; percent: number | null } {
  const handedBack = (h.handed_back_other ?? 0) + (h.handed_back_reasoned ?? 0);
  const total = handedBack + (h.completed_on_time ?? 0) + (h.completed_late ?? 0) + (h.claim_expired ?? 0);
  return { handedBack, total, percent: total === 0 ? null : Math.round((handedBack / total) * 100) };
}

/** How many clinicians sit in each band. Bands are read top-down by their lower bound; nothing is named or ordered by person. */
export function bandCounts(scores: number[], bands: DashboardSettings["bands"]): { key: string; min: number; count: number }[] {
  const sorted = [...bands].sort((a, b) => b.min - a.min);
  const out = sorted.map((b) => ({ key: b.key, min: b.min, count: 0 }));
  for (const s of scores) {
    const slot = out.find((b) => s >= b.min);
    if (slot) slot.count += 1;
  }
  return out;
}

/** The share of pages answered inside the window, as a whole percent, or null when there were none. */
export function ackPercent(p: Dashboard["pages"]): number | null {
  return p.total === 0 ? null : Math.round((p.acknowledged_in_window / p.total) * 100);
}

/** "1 h 5 min", "12 min", "45 s". */
export function waitLabel(minutes: number): string {
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
export function secondsLabel(seconds: number | null): string {
  if (seconds === null) return "-";
  return seconds < 60 ? `${seconds} s` : waitLabel(Math.floor(seconds / 60));
}
