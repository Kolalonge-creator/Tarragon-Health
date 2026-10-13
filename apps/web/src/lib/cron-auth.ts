import { timingSafeEqual } from "node:crypto";

/** True only when CRON_SECRET is set and the Authorization header is exactly `Bearer <secret>`. The comparison takes the same time wherever it differs. */
export function isCronAuthorised(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authHeader);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
