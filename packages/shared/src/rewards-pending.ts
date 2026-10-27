/**
 * S58b: shapes and tiny pure helpers for the "points on their way" list and the milestone card, shared by web and phone so both
 * read the database's answers the same way. No number lives here: when a credit is expected and when to ask for help are decided
 * by the database from `reward_config` (`pending_credit`), which is where the PROPOSED values are.
 */

/** One point-earning action the database has recorded and not yet decided (what `my_points_pending()` returns per item). */
export interface PendingCreditItem {
  event_id: string;
  rule_codes: string[];
  since: string;
  expected_by: string;
  ask_support: boolean;
}

/** What `my_pending_milestone()` returns, or null. */
export interface PendingMilestone {
  id: string;
  code: string;
  achieved_at: string;
}

const ITEM_KEYS = ["event_id", "rule_codes", "since", "expected_by", "ask_support"] as const;

/** Parse an RPC answer defensively. Anything unexpected becomes an empty list, never an error on the points screen. */
export function parsePendingCredit(raw: unknown): PendingCreditItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PendingCreditItem[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (!ITEM_KEYS.every((k) => k in o)) continue;
    if (typeof o.event_id !== "string" || typeof o.since !== "string" || typeof o.expected_by !== "string") continue;
    out.push({
      event_id: o.event_id,
      rule_codes: Array.isArray(o.rule_codes) ? o.rule_codes.filter((c): c is string => typeof c === "string") : [],
      since: o.since,
      expected_by: o.expected_by,
      ask_support: o.ask_support === true,
    });
  }
  return out;
}

export function parsePendingMilestone(raw: unknown): PendingMilestone | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.code !== "string" || typeof o.achieved_at !== "string") return null;
  return { id: o.id, code: o.code, achieved_at: o.achieved_at };
}

/** "10:45" in Lagos for an ISO instant (the platform timezone is always Africa/Lagos). */
export function lagosClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * What to say about one pending item: "expected" while its expected time is still ahead, "later" once it has passed (calm, no deadline
 * language), and whether to offer the support route. A clock that is a little off never produces an error, only a different sentence.
 */
export function describePending(item: PendingCreditItem, now: Date = new Date()): { state: "expected" | "later"; time: string; askSupport: boolean } {
  const expected = new Date(item.expected_by);
  const ahead = !Number.isNaN(expected.getTime()) && expected.getTime() > now.getTime();
  return { state: ahead ? "expected" : "later", time: lagosClock(item.expected_by), askSupport: item.ask_support };
}
