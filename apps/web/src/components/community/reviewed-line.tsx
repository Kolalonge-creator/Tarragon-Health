import { formatDay } from "./staff-format";

/**
 * The attribution line for a clinician-reviewed note. Null-gated: it names a reviewer only when BOTH the returned name and the
 * returned time are present. There is no hard-coded reviewer or "reviewed" label anywhere else.
 */
export function ReviewedLine({ reviewedByName, reviewedAt }: { reviewedByName: string | null; reviewedAt: string | null }) {
  if (!reviewedByName || !reviewedAt) {
    return <span className="text-sm text-charcoal-ink/70">Not yet reviewed</span>;
  }
  return (
    <span className="text-sm text-charcoal-ink">
      Reviewed by {reviewedByName} on {formatDay(reviewedAt)}
    </span>
  );
}
