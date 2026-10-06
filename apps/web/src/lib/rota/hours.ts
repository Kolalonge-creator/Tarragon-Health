/** Hours of declared working time (queue and bookable) that start inside the next seven days. On-call hours are rota duty, not this. */
export function declaredHoursNext7Days(
  blocks: ReadonlyArray<{ kind: string; state: string; starts_at: string; ends_at: string }>,
  now: Date,
): number {
  const from = now.getTime();
  const to = from + 7 * 24 * 60 * 60 * 1000;
  let ms = 0;
  for (const b of blocks) {
    if (b.state === "cancelled" || (b.kind !== "queue" && b.kind !== "bookable_consultations")) continue;
    const start = new Date(b.starts_at).getTime();
    const end = new Date(b.ends_at).getTime();
    const s = Math.max(start, from);
    const e = Math.min(end, to);
    if (e > s) ms += e - s;
  }
  return Math.round((ms / 3_600_000) * 10) / 10;
}
