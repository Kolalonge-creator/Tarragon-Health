/**
 * The "why this matters" band for a condition page: a quiet-urgency
 * statement about how the condition actually causes harm (a gap between
 * check-ins, not a single bad reading), never a fear-based claim or an
 * unverifiable statistic. Modelled on the register of "most complications
 * happen because people go months without checking their numbers", not on a
 * blunt unverified percentage claim, per docs/BRAND_GUIDE.md's voice rules.
 */
export function ConditionRiskNote({
  eyebrow,
  statement,
  support,
}: {
  eyebrow: string;
  statement: string;
  support?: string;
}) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-medium uppercase tracking-wide text-white/60">{eyebrow}</p>
      <h2 className="mt-4 font-heading text-2xl font-semibold leading-snug text-white sm:text-3xl">
        {statement}
      </h2>
      {support ? (
        <p className="mt-4 text-lg leading-relaxed text-white/70">{support}</p>
      ) : null}
    </div>
  );
}
