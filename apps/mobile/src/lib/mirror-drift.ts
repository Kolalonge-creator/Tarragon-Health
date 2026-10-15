/**
 * Pure rules for the post-pull count check (S06x). See verifyCounts in offline-store.ts.
 */

/** The mirror is short only when it holds FEWER rows than the server; extra local rows are not drift (the server never deletes these tables). */
export function hasDrifted(localCount: number, remoteCount: number): boolean {
  return localCount < remoteCount;
}

/**
 * Start of the window the count compares: the later of the first-pull horizon and the retention horizon
 * behind the cursor. Rows older than the retention horizon are purged on purpose (purgeMirror), so
 * counting them would report drift that is really housekeeping.
 */
export function driftFloor(cursorIso: string, initialPullDays: number, retentionDays: number, now: Date = new Date()): string {
  const initial = now.getTime() - initialPullDays * 86_400_000;
  const retention = new Date(cursorIso).getTime() - retentionDays * 86_400_000;
  return new Date(Math.max(initial, retention)).toISOString();
}
