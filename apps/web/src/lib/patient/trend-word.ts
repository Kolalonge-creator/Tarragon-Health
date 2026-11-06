import type { SparkPoint } from "@/components/charts/sparkline";

const DAY = 86_400_000;

/**
 * A plain word for which way a reading has moved this month (2026-11-06 big-number tiles). It describes the shape only:
 * "Higher" is not "worse" and the tile never colours it, because whether higher is good depends on the reading and the
 * person, which is the care team's call. The last 7 days are compared with the 23 before; each side needs at least two
 * readings, otherwise there is no word at all rather than a guess. Within 3 percent reads as steady.
 */
export function trendWord(points: readonly SparkPoint[], nowMs: number): string | null {
  const recent = points.filter((p) => p.t > nowMs - 7 * DAY);
  const earlier = points.filter((p) => p.t <= nowMs - 7 * DAY && p.t > nowMs - 30 * DAY);
  if (recent.length < 2 || earlier.length < 2) return null;
  const mean = (xs: readonly SparkPoint[]) => xs.reduce((s, p) => s + p.v, 0) / xs.length;
  const a = mean(recent);
  const b = mean(earlier);
  if (b === 0) return null;
  const change = (a - b) / Math.abs(b);
  if (Math.abs(change) < 0.03) return "Steady this month";
  return change > 0 ? "Higher than earlier this month" : "Lower than earlier this month";
}

/** "Today, 08:10", "Yesterday", "3 days ago" or "12 Oct", in Lagos time. */
export function whenLabel(takenAtMs: number, nowMs: number): string {
  const lagosDay = (ms: number) => new Date(ms + 3_600_000).toISOString().slice(0, 10);
  const days = Math.round((Date.parse(lagosDay(nowMs)) - Date.parse(lagosDay(takenAtMs))) / DAY);
  if (days <= 0) {
    const hm = new Date(takenAtMs).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
    return `Today, ${hm}`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(takenAtMs).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}
