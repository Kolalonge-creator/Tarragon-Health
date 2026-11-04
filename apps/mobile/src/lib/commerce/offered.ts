import { EVERGREEN_PLUS_CODE, UPGRADE_CODE } from "@tarragon/commerce";

/**
 * One Membership (T2-01, T2-09, 2026-11-04): Membership Plus and the upgrade to it are retired and never sold. The database marks both
 * inactive; this also drops them if a stale catalogue still returns them, so the phone never prices, shows or offers them. A Plus year
 * bought earlier is still described from the person's membership state, not from the catalogue.
 */
const NOT_OFFERED: ReadonlySet<string> = new Set([EVERGREEN_PLUS_CODE, UPGRADE_CODE]);

export function offeredItems<T extends { readonly code: string }>(items: readonly T[]): T[] {
  return items.filter((i) => !NOT_OFFERED.has(i.code));
}
