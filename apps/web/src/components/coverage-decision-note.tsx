/**
 * Null-gated coverage-decision note for a denied pre-authorisation or claim
 * (spec §93.6: "an insurer's refusal to pay should not be represented as
 * 'you do not need this clinically' — instead 'your plan does not cover this
 * service'"). Renders nothing unless a denial reason is actually on file —
 * never invented, never implied by a bare "denied" status badge alone. This
 * is the one place that distinction gets made; a preauth/claim list should
 * render this rather than composing its own denial copy, so the framing
 * can't drift per call site the way CLINICAL_TRUST_MODEL_SPEC.md's
 * ReviewedByDoctor pattern guards against for attribution.
 */
export function CoverageDecisionNote({ denialReason }: { denialReason: string | null }) {
  if (!denialReason) return null;

  return (
    <div className="rounded-md bg-amber-50 dark:bg-amber-500/15 p-3 text-sm">
      <p className="font-medium text-charcoal-ink dark:text-night-ink">Your plan doesn&apos;t cover this</p>
      <p className="mt-0.5 text-charcoal-ink/70 dark:text-night-ink/70">
        That&apos;s a decision about what your insurance pays for. It doesn&apos;t change what your care
        team recommended.
      </p>
      <p className="mt-1 text-charcoal-ink/70 dark:text-night-ink/70">{denialReason}</p>
    </div>
  );
}
