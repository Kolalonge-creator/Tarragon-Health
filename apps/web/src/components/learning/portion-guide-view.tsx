import { portionPhrase, t } from "@tarragon/i18n";
import {
  HAND_SHAPES,
  getProposedConfig,
  parsePortionGuide,
  portionFor,
  type PortionAudience,
  type PortionGuideConfig,
  type PortionHand,
} from "@tarragon/shared";

/** A plain line drawing of one hand measure. Outline only, so it follows the text colour in light and dark. No image file, no emoji. */
export function HandIcon({ hand, size = 40 }: { hand: PortionHand; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0 text-brand-green dark:text-brand-green-bright"
    >
      {HAND_SHAPES[hand].map((s, i) =>
        s.t === "rect" ? (
          <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />
        ) : s.t === "circle" ? (
          <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />
        ) : (
          <path key={i} d={s.d} />
        ),
      )}
    </svg>
  );
}

/**
 * Local food portion guide (hand measures for common Nigerian foods). Text first: every line reads on its own and the drawing is a
 * helper (aria-hidden). Amounts come only from the versioned configuration `learning.portion_guide`; while that is still proposed, a
 * visible note says the amounts are placeholders. The renderer is pure, so the same body renders offline from a saved lesson.
 */
export function PortionGuideView({
  body,
  audience,
  config,
  confirmed,
}: {
  body: string;
  audience: PortionAudience;
  /** Test seam. Defaults to the bundled versioned configuration. */
  config?: PortionGuideConfig;
  confirmed?: boolean;
}) {
  const bundled = getProposedConfig("learning.portion_guide");
  const value = config ?? (bundled.value as unknown as PortionGuideConfig);
  const isConfirmed = confirmed ?? bundled.status === "confirmed";
  const parsed = parsePortionGuide(body);
  return (
    <div className="space-y-4" data-testid="portion-guide">
      {parsed.intro.map((l, i) => (
        <p key={i} className="text-sm text-charcoal-ink/90 dark:text-night-ink/90">
          {l}
        </p>
      ))}
      <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.portion.legend")}</p>
      {!isConfirmed && (
        <p role="note" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-950 dark:bg-amber-500/10 dark:text-amber-100" data-testid="portion-draft-note">
          {t("learn.portion.draft_numbers")}
        </p>
      )}
      <ul className="space-y-3">
        {parsed.foods.map((f) => {
          const amount = portionFor(value, f.ref, audience);
          return (
            <li key={f.ref + f.name} className="flex gap-3 rounded-xl border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
              <HandIcon hand={f.hand} />
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-semibold text-charcoal-ink dark:text-night-ink">{f.name}</p>
                {amount && <p className="text-sm font-medium text-brand-green dark:text-brand-green-bright">{portionPhrase(amount)}</p>}
                {f.tip && <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{f.tip}</p>}
              </div>
            </li>
          );
        })}
      </ul>
      {parsed.notes.map((l, i) => (
        <p key={i} className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
          {l}
        </p>
      ))}
    </div>
  );
}
