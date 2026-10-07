import { marketingAnonClient as anonClient } from "./anon-client";

/**
 * A Learning Centre item that has been flagged public (S55, 9.8). Read through the BARE anon client, same marketing-boundary
 * discipline as resources-data.ts. The database function public_health_education_item returns a row only while the item is
 * flagged public, published, in date, clinician reviewed with a review date, and not a Members item, so an item that goes out of
 * date simply stops resolving. Fails soft (null) on any error.
 */
export interface PublicHealthItem {
  code: string;
  title: string;
  summary: string | null;
  body: string;
  estimatedMinutes: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  sourceReference: string | null;
  nextReviewDue: string | null;
  nextAction: string | null;
}

export async function loadPublicHealthItem(code: string): Promise<PublicHealthItem | null> {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(code)) return null;
  const supabase = anonClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("public_health_education_item", { p_code: code });
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Record<string, unknown>;
  if (typeof r.code !== "string" || typeof r.title !== "string" || typeof r.body !== "string") return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    code: r.code,
    title: r.title,
    summary: str(r.summary),
    body: r.body,
    estimatedMinutes: typeof r.estimated_minutes === "number" ? r.estimated_minutes : null,
    reviewedByName: str(r.reviewed_by_name),
    reviewedAt: str(r.reviewed_at),
    sourceReference: str(r.source_reference),
    nextReviewDue: str(r.next_review_due),
    nextAction: str(r.next_action),
  };
}
