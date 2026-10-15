import { z } from "zod";

/**
 * S80 (25.10): AI cost by feature. The database does the arithmetic as exact integers (millionths of a minor unit) and returns
 * NULL where no price exists; this only formats. Nothing here estimates a missing price.
 */
export const costRowSchema = z.object({
  system_code: z.string(),
  system_name: z.string(),
  model_identifier: z.string(),
  currency: z.string().nullable(),
  interactions: z.number().int(),
  input_tokens: z.number().int(),
  output_tokens: z.number().int(),
  priced_interactions: z.number().int(),
  cost_millionths_minor: z.number().int().nullable(),
});
export type CostRow = z.infer<typeof costRowSchema>;
export const costRowsSchema = z.array(costRowSchema);

/** Millionths of a minor unit to major units with 4 decimals, by integer arithmetic only (no float). "No price" for null. */
export function formatCost(millionthsMinor: number | null, currency: string | null): string {
  if (millionthsMinor === null || currency === null) return "No price";
  if (!Number.isSafeInteger(millionthsMinor) || millionthsMinor < 0) return "No price";
  // Whole-number arithmetic only: 1e8 millionths-of-minor make one major unit; keep 4 decimals (units of 1/10000).
  const rounded = Math.floor((millionthsMinor + 5_000) / 10_000);
  const whole = Math.floor(rounded / 10_000);
  const frac = String(rounded % 10_000).padStart(4, "0");
  return `${whole.toLocaleString("en-GB")}.${frac} ${currency}`;
}

export const NOTICES = ["added", "denied", "bad_input", "duplicate", "failed"] as const;
export type Notice = (typeof NOTICES)[number];
export const asNotice = (v: unknown): Notice | null => ((NOTICES as readonly unknown[]).includes(v) ? (v as Notice) : null);

export const priceFormSchema = z.object({
  model: z.string().trim().min(1).max(200),
  input: z.coerce.number().int().min(0),
  output: z.coerce.number().int().min(0),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
  valid_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source_note: z.string().trim().min(10).max(500),
});

export function noticeForError(code: string | undefined): Notice {
  if (code === "42501") return "denied";
  if (code === "22023") return "bad_input";
  if (code === "23505") return "duplicate";
  return "failed";
}

/** Default window: the last 30 days, as ISO dates in Lagos time. */
export function defaultWindow(now = new Date()): { from: string; to: string } {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const to = new Date(now.getTime() + 24 * 3600 * 1000);
  const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  return { from: day(from), to: day(to) };
}
