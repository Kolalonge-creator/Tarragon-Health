/** Choices the patient is offered when creating a share link. They must stay inside the database limits (see share-options.test.ts). */
export const SHARE_MAX_VIEWS_CHOICES = [1, 3, 5, 10] as const;
export const SHARE_WINDOW_DAYS_CHOICES = [30, 90, 180] as const;

/** How many openings a capped link has left; null when the link has no cap. Never negative. */
export function viewsLeft(maxViews: number | null, viewCount: number): number | null {
  if (maxViews === null) return null;
  return Math.max(maxViews - viewCount, 0);
}
