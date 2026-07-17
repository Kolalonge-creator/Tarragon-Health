/** Categorical colours for analytics distribution charts, defined in
 * globals.css (`--color-chart-analytics-1..6`). Consumed as recharts fills. */
export const ANALYTICS_PALETTE = [
  "var(--color-chart-analytics-1)",
  "var(--color-chart-analytics-2)",
  "var(--color-chart-analytics-3)",
  "var(--color-chart-analytics-4)",
  "var(--color-chart-analytics-5)",
  "var(--color-chart-analytics-6)",
] as const;

export function paletteColor(index: number): string {
  return ANALYTICS_PALETTE[index % ANALYTICS_PALETTE.length];
}
