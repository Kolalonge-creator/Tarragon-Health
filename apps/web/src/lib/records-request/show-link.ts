/**
 * Whether the "Ask for your records" link appears in the health passport nav. It is hidden while the letters feature is off (the page would only
 * say "not open yet"), but stays for anyone who already has a request, so their tracked letters never vanish. A failed read hides it: nothing is
 * promised that the database has not confirmed.
 */
export function showRecordsRequestsLink(guardOpen: boolean | null | undefined, existingRequestCount: number): boolean {
  return guardOpen === true || existingRequestCount > 0;
}
