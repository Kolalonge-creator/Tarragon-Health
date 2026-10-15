export type NextStepKind = "self_care" | "ask_care_team" | "book" | "emergency";

export interface NextStepAction {
  readonly kind: NextStepKind;
  /** Only the self-care step carries authored text; the other three are fixed by the template. */
  readonly text: string | null;
}

/**
 * The required "What can I do next?" block (spec 9.4). The self-care step is authored with the content; asking the care
 * team, booking and getting urgent help are always present and never authored, so no item can leave them out.
 */
export function buildNextStep(selfCareAction: string | null | undefined): NextStepAction[] {
  const actions: NextStepAction[] = [];
  const text = selfCareAction?.trim();
  if (text) actions.push({ kind: "self_care", text });
  actions.push({ kind: "ask_care_team", text: null }, { kind: "book", text: null }, { kind: "emergency", text: null });
  return actions;
}

export interface TrustFields {
  readonly reviewedByName?: string | null;
  readonly reviewedAt?: string | null;
  readonly nextReviewDue?: string | null;
  readonly sourceReference?: string | null;
  readonly evidenceSource?: string | null;
  readonly clinicalAuthorName?: string | null;
  readonly creatorName?: string | null;
}

export interface TrustLine {
  readonly reviewedBy: string | null;
  readonly reviewedOn: string | null;
  readonly nextReview: string | null;
  readonly sources: string | null;
  readonly author: string | null;
  /** True when any of reviewer, review date or sources is missing: the card then says details are being added. */
  readonly incomplete: boolean;
}

/** What the trust line shows for an item. Nothing is invented: a missing fact stays missing and is flagged incomplete. */
export function buildTrustLine(f: TrustFields): TrustLine {
  const clean = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
  const reviewedBy = clean(f.reviewedByName);
  const reviewedOn = clean(f.reviewedAt)?.slice(0, 10) ?? null;
  const sources = clean(f.sourceReference) ?? clean(f.evidenceSource);
  return {
    reviewedBy,
    reviewedOn,
    nextReview: clean(f.nextReviewDue)?.slice(0, 10) ?? null,
    sources,
    author: clean(f.creatorName) ?? clean(f.clinicalAuthorName),
    incomplete: !reviewedBy || !reviewedOn || !sources,
  };
}
