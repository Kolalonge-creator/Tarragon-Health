export type SessionState = "Cancelled" | "Not open yet" | "Open now" | "Closed";

/** Where a doctor question session is in its life. Kept out of the page component so the page stays pure. */
export function sessionState(opens: string, closes: string, cancelled: boolean): SessionState {
  if (cancelled) return "Cancelled";
  const now = Date.now();
  if (now < new Date(opens).getTime()) return "Not open yet";
  if (now < new Date(closes).getTime()) return "Open now";
  return "Closed";
}
