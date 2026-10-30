/**
 * The care team's recent reply time, as the database function public.care_team_reply_time() reports it. The database decides whether the
 * figure is trustworthy (enough replies, few old messages left unanswered); anything this parser does not recognise is "no figure".
 */
export interface ReplyTime {
  medianMinutes: number;
  replies: number;
  windowDays: number;
}

export function parseReplyTime(data: unknown): ReplyTime | null {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.available !== true) return null;
  const { median_minutes: m, replies, window_days: w } = d;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0) return null;
  if (typeof replies !== "number" || typeof w !== "number") return null;
  return { medianMinutes: m, replies, windowDays: w };
}

/** "about 40 minutes", "about an hour", "about 3 hours", "about 2 days". Rounded, because a median to the minute would look more exact than it is. */
export function replyTimePhrase(minutes: number): string {
  if (minutes < 60) return `about ${Math.max(5, Math.round(minutes / 5) * 5)} minutes`;
  if (minutes < 90) return "about an hour";
  if (minutes < 24 * 60) return `about ${Math.round(minutes / 60)} hours`;
  const days = Math.round(minutes / (24 * 60));
  return days <= 1 ? "about a day" : `about ${days} days`;
}

export function replyTimeSentence(rt: ReplyTime): string {
  return `Over the last ${rt.windowDays} days, the care team usually replied in ${replyTimePhrase(rt.medianMinutes)}. This describes recent replies and is not a promise.`;
}
