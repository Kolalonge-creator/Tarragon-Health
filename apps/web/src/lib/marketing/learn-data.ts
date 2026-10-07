import { marketingAnonClient } from "./anon-client";

/**
 * A shared Learning Centre article (spec 9.8). Read through the bare anon client, like every marketing loader, and only through
 * public.learn_shared_article(), which returns an article only while it is published, clinically reviewed, shareable and
 * inside its review date. Anything else (unpublished, expired, withdrawn, unknown, a different content type)
 * returns null and the page answers with a calm 404; an outage throws so it is seen, not mistaken for a missing article. The code in the link is the only input: no patient, account or reading
 * information is ever part of the URL or the response.
 */
export interface SharedArticle {
  code: string;
  title: string;
  summary: string | null;
  body: string;
  estimatedMinutes: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  nextReviewDue: string | null;
  sourceReference: string | null;
  evidenceSource: string | null;
  selfCareAction: string | null;
  creatorName: string | null;
}

type Row = {
  code: string;
  title: string;
  summary: string | null;
  body: string;
  estimated_minutes: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  next_review_due: string | null;
  source_reference: string | null;
  evidence_source: string | null;
  self_care_action: string | null;
  creator_name: string | null;
};

export const SHARED_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

export async function loadSharedArticle(code: string): Promise<SharedArticle | null> {
  if (!SHARED_CODE_PATTERN.test(code)) return null;
  const client = marketingAnonClient();
  if (!client) return null;
  const { data, error } = await client.rpc("learn_shared_article", { p_code: code });
  // A database error is NOT "this article does not exist": throwing lets the error page and monitoring see an outage, where a
  // calm 404 would tell the sender their link is dead while the real fault goes unnoticed.
  if (error) throw new Error(`learn_shared_article failed: ${error.message}`);
  if (!Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Row;
  return {
    code: r.code,
    title: r.title,
    summary: r.summary,
    body: r.body,
    estimatedMinutes: r.estimated_minutes,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    nextReviewDue: r.next_review_due,
    sourceReference: r.source_reference,
    evidenceSource: r.evidence_source,
    selfCareAction: r.self_care_action,
    creatorName: r.creator_name,
  };
}
