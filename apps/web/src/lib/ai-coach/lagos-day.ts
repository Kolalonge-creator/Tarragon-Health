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
