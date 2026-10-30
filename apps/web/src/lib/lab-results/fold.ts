/**
 * Which results show and which fold behind "Earlier results". The latest few always show; an older result that is not normal
 * (borderline, needs repeat testing, needs follow-up, urgent) is never folded away: it stays in view until the person has dealt with it.
 * Only older normal or unlabelled results fold. `results` must be newest first.
 */
export function splitRecentResults<T>(results: readonly T[], statusOf: (result: T) => string | undefined, recent: number): { shown: T[]; folded: T[] } {
  const needsAttention = (r: T) => {
    const status = statusOf(r);
    return status !== undefined && status !== "normal";
  };
  return {
    shown: results.filter((r, i) => i < recent || needsAttention(r)),
    folded: results.filter((r, i) => i >= recent && !needsAttention(r)),
  };
}
