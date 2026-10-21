import { supabase } from "./supabase";
import { CARE_ACCESS_CATEGORIES, type CareAccessCategory } from "./family-consent";

/**
 * The yearly "does this person still need access?" check, on the phone. The same three functions the web card calls; the database decides
 * who is due, and an answer is made by `answer_proxy_review`. Nothing here removes access by itself, and not answering never changes anything.
 */
export interface ProxyReviewRow {
  grantId: string;
  granteeId: string;
  firstName: string;
  since: string;
  categories: string[];
  dueAt: string;
  isDue: boolean;
  daysOverdue: number;
  lastReviewedAt: string | null;
}

export type ProxyReviewLoad = { ok: true; rows: ProxyReviewRow[] } | { ok: false };

function parseRow(raw: unknown): ProxyReviewRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.grant_id !== "string" ||
    typeof r.grantee_id !== "string" ||
    typeof r.first_name !== "string" ||
    typeof r.since !== "string" ||
    !Array.isArray(r.categories) ||
    typeof r.due_at !== "string" ||
    typeof r.is_due !== "boolean" ||
    typeof r.days_overdue !== "number"
  ) {
    return null;
  }
  return {
    grantId: r.grant_id,
    granteeId: r.grantee_id,
    firstName: r.first_name,
    since: r.since,
    categories: r.categories.filter((c): c is string => typeof c === "string"),
    dueAt: r.due_at,
    isDue: r.is_due,
    daysOverdue: Math.max(0, Math.trunc(r.days_overdue)),
    lastReviewedAt: typeof r.last_reviewed_at === "string" ? r.last_reviewed_at : null,
  };
}

/** A failed or malformed read is `{ ok: false }`, never an empty list: an empty list would read as "nothing to review". */
export async function loadProxyReviews(): Promise<ProxyReviewLoad> {
  const { data, error } = await supabase.rpc("my_proxy_reviews");
  if (error || !Array.isArray(data)) return { ok: false };
  const rows: ProxyReviewRow[] = [];
  for (const item of data as unknown[]) {
    const row = parseRow(item);
    if (!row) return { ok: false };
    rows.push(row);
  }
  return { ok: true, rows };
}

/** Only the rows that are due, oldest first. */
export function dueReviews(rows: readonly ProxyReviewRow[]): ProxyReviewRow[] {
  return rows.filter((r) => r.isDue).sort((a, b) => a.dueAt.localeCompare(b.dueAt));
}

export function reviewCategoryLabel(value: string): string {
  if (value === "reproductive_health") return "Reproductive health";
  return CARE_ACCESS_CATEGORIES.find((c) => c.value === value)?.label ?? "Something else";
}

export type ProxyReviewAnswer = { action: "keep" } | { action: "narrow"; keep: string[] } | { action: "remove" };
export type ProxyReviewAnswerResult = { ok: true } | { ok: false; reason: "changed" | "failed" };

/**
 * Sends the answer. The proxy is never told about a narrowing or a removal (`p_notify: false`). A removal of access that is already gone
 * (P0002) counts as done, because that is the outcome the person asked for; a narrowing against a list that has changed (22023) says so.
 */
export async function answerProxyReview(granteeId: string, answer: ProxyReviewAnswer): Promise<ProxyReviewAnswerResult> {
  const args =
    answer.action === "narrow"
      ? { p_grantee: granteeId, p_action: "narrow", p_categories: answer.keep as CareAccessCategory[], p_notify: false }
      : { p_grantee: granteeId, p_action: answer.action };
  const { error } = await supabase.rpc("answer_proxy_review", args);
  if (!error) return { ok: true };
  if (answer.action === "remove" && error.code === "P0002") return { ok: true };
  if (error.code === "22023") return { ok: false, reason: "changed" };
  return { ok: false, reason: "failed" };
}
