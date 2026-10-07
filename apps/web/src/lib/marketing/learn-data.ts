import { marketingAnonClient } from "./anon-client";

/**
 * A shared Learning Centre article (spec 9.8). Read through the bare anon client, like every marketing loader, and only through
 * public.learn_shared_article(), which returns an article only while it is published, clinically reviewed, shareable and
 * inside its review date. Anything else (unpublished, expired, withdrawn, unknown, a different content type, an outage)
 * returns null and the page answers with a calm 404. The code in the link is the only input: no patient, account or reading
 * information is ever part of the URL or the response.
 */
export interface SharedArticle {
  code: string;
  title: string;
  summary: string | null;
  /** Empty for a members-only creator lesson: the database never sends that body to a signed-out visitor. */
  body: string;
  /** True when the lesson is part of Membership: the page shows the title, the credit and the teaser only. */
  membersOnly: boolean;
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
  body: string | null;
  members_only: boolean | null;
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
  if (error || !Array.isArray(data) || data.length === 0) return null;
  const r = data[0] as Row;
  return {
    code: r.code,
    title: r.title,
    summary: r.summary,
    // belt and braces: whatever the row says, a members-only lesson never carries a body to the page
    body: r.members_only === true ? "" : (r.body ?? ""),
    membersOnly: r.members_only === true,
    estimatedMinutes: r.estimated_minutes,
    reviewedByName: r.reviewed_by_name,
    reviewedAt: r.reviewed_at,
    nextReviewDue: r.next_review_due,
    sourceReference: r.source_reference,
    evidenceSource: r.evidence_source,
    selfCareAction: r.members_only === true ? null : r.self_care_action,
    creatorName: r.creator_name,
  };
}
