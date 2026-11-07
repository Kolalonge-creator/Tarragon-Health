/** Dates in the coordination workspace are always Lagos time (CLAUDE.md: timezone always Africa/Lagos). */
export function formatLagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function formatLagosDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

export function formatLagosTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });
}

/** "just now", "12m ago", "3h ago", "2d ago". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Due date in words relative to now: "Overdue 2d", "Due today 14:00", "Due 12 Nov", or "No due date". */
export function dueText(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return "No due date";
  const due = new Date(dueAt);
  const diff = due.getTime() - now.getTime();
  if (diff < 0) {
    const days = Math.floor(-diff / 86_400_000);
    return days >= 1 ? `Overdue ${days}d` : `Overdue since ${formatLagosTime(dueAt)}`;
  }
  const sameDay = formatLagosDate(dueAt) === formatLagosDate(now.toISOString());
  return sameDay ? `Due today ${formatLagosTime(dueAt)}` : `Due ${formatLagosDate(dueAt)}`;
}
