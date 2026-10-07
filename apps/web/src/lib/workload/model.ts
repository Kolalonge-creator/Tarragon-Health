import { z } from "zod";

/** One clinician's row of the workload dashboard (S78c, spec 23.21). Advisory counts only: nothing here ranks or scores anyone. */
export const workloadRowSchema = z.object({
  clinician_id: z.uuid(),
  name: z.string(),
  claims: z.number().int().min(0),
  completed: z.number().int().min(0),
  handbacks: z.number().int().min(0),
  median_minutes: z.number().nullable(),
  p90_minutes: z.number().nullable(),
  overdue: z.number().int().min(0),
});
export type WorkloadRow = z.infer<typeof workloadRowSchema>;

export const workloadSchema = z.object({
  days: z.number().int().min(1),
  generated_at: z.string().min(10),
  clinicians: z.array(workloadRowSchema),
});
export type Workload = z.infer<typeof workloadSchema>;

/** The window the screen asks for; a short list so a typed value can never reach the database. */
export const WORKLOAD_WINDOWS = [7, 30, 90] as const;
export function parseWindow(raw: string | string[] | undefined): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return (WORKLOAD_WINDOWS as readonly number[]).includes(n) ? n : 30;
}

/** "45 min", "2 h 5 min"; a missing figure (nothing completed) is a dash, never a zero. */
export function minutesLabel(m: number | null): string {
  if (m === null) return "-";
  const total = Math.round(m);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}
