/** Africa/Lagos is a fixed UTC+1 offset with no DST (CLAUDE.md: "Timezone
 * always Africa/Lagos"), so the day boundary can be computed with plain
 * offset math instead of a timezone database lookup. */
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** The UTC instant corresponding to 00:00 Africa/Lagos time on the given
 * instant's Lagos calendar day. */
export function startOfLagosDayUtc(now: Date): Date {
  const lagosNow = new Date(now.getTime() + LAGOS_OFFSET_MS);
  const startOfLagosDayAsUtc = Date.UTC(
    lagosNow.getUTCFullYear(),
    lagosNow.getUTCMonth(),
    lagosNow.getUTCDate()
  );
  return new Date(startOfLagosDayAsUtc - LAGOS_OFFSET_MS);
}

/** Today's calendar date in Africa/Lagos as YYYY-MM-DD.
 *
 * Anything that reasons about which DAY something happened on must go
 * through this rather than `toISOString().slice(0, 10)`: between 23:00 and
 * midnight UTC, Lagos is already on the next day, so the naive version
 * silently reports yesterday for an hour every night. That is a real bug for
 * a cycle tracker, where "day 1 of your period" is the anchor every
 * prediction is measured from. */
export function lagosDateString(now: Date = new Date()): string {
  return new Date(now.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 10);
}
