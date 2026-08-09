/** "Today, 8:40 AM" / "Yesterday, 7:55 AM" / "Aug 7, 2:05 PM", always
 * evaluated in Africa/Lagos (CLAUDE.md: timezone always Africa/Lagos) rather
 * than the viewer's own — a pharmacist in Lagos and a server in eu-west-1
 * must agree on what "today" means. */
export function formatRequestedAt(iso: string, now: Date = new Date()): string {
  const dayKey = (d: Date) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

  const target = dayKey(new Date(iso));
  const today = dayKey(now);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  if (target === today) return `Today, ${time}`;
  if (target === yesterday) return `Yesterday, ${time}`;

  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
  return `${date}, ${time}`;
}

export function isLagosToday(dateOnly: string, now: Date = new Date()): boolean {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(now);
  return dateOnly === today;
}
