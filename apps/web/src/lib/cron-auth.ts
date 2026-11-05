import { timingSafeEqual } from "node:crypto";

/** True only when CRON_SECRET is set and the Authorization header is exactly `Bearer <secret>`. The comparison takes the same time wherever it differs. */
export function isCronAuthorised(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(authHeader);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** True only when both values are non-empty and identical. The comparison takes the same time wherever they differ. */
export function isSameSecret(provided: string | null | undefined, expected: string | null | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
