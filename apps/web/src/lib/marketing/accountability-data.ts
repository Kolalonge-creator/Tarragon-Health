import { marketingAnonClient as anonClient } from "./anon-client";

/**
 * The published response-time commitments, read from the signed config.
 *
 * Bare anon supabase-js client, same marketing-boundary discipline as
 * resources-data.ts and coverage-data.ts: no auth or platform modules reach the
 * marketing tree.
 *
 * Fails soft and, importantly, fails QUIET. If the call errors, or nothing is
 * signed, this returns null and the page says what it does without quoting a
 * number. A response-time promise is exactly the kind of claim that must never
 * be filled in from a hardcoded fallback.
 */

export type ResponseCommitment = {
  tier: string;
  ceilingMinutes: number;
};

export type PublishedCommitments = {
  version: number;
  approvedAt: string | null;
  approvedByName: string | null;
  commitments: ResponseCommitment[];
};

/** Plain-language name and description per alert tier, for a patient audience. */
export const TIER_COPY: Record<string, { label: string; meaning: string }> = {
  emergency: {
    label: "Something that could be dangerous now",
    meaning:
      "A reading or a report that could mean immediate harm: a hypertensive-crisis blood pressure, a danger symptom, a screen suggesting risk of self-harm.",
  },
  urgent_escalation: {
    label: "Something that needs a doctor soon",
    meaning:
      "An abnormal result, a red-range home reading, or a reported problem that should not wait for a routine appointment.",
  },
  clinician_review: {
    label: "Something a doctor should look at",
    meaning:
      "A reading above target, or a stretch of silence where readings were expected. Silence is never assumed to be safe.",
  },
};

/**
 * Turns minutes into something a person reads without doing arithmetic.
 *
 * Anything up to and including two days is expressed in hours, not days.
 * A 1440-minute commitment is literally one day, but "within 1 day" reads as
 * loose and vaguely tomorrow-ish, while "within 24 hours" is how every urgent
 * clinical commitment is stated and is heard as a clock already running. Same
 * promise, and the stricter-sounding phrasing is the honest one here.
 */
export function humaniseMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  if (minutes <= 2880) {
    const hours = Math.round(minutes / 60);
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.round(minutes / 1440);
  return `${days} day${days === 1 ? "" : "s"}`;
}

export async function getPublishedCommitments(): Promise<PublishedCommitments | null> {
  const supabase = anonClient();
  if (!supabase) return null;

  const { data, error } = await supabase.rpc("public_response_commitments");
  if (error || typeof data !== "object" || data === null) return null;

  const row = data as Record<string, unknown>;
  if (typeof row.version !== "number") return null;

  const rawCommitments = Array.isArray(row.commitments) ? row.commitments : [];
  const commitments = rawCommitments.flatMap((entry): ResponseCommitment[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.tier !== "string" || typeof item.ceiling_minutes !== "number") return [];
    return [{ tier: item.tier, ceilingMinutes: item.ceiling_minutes }];
  });

  if (commitments.length === 0) return null;

  return {
    version: row.version,
    approvedAt: typeof row.approved_at === "string" ? row.approved_at : null,
    approvedByName: typeof row.approved_by_name === "string" ? row.approved_by_name : null,
    commitments,
  };
}
