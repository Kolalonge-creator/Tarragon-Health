import type { HealthDomainKey } from "@/lib/health-domains/domains";

/**
 * Small abstract-texture thumbnail per health domain — a visual anchor
 * distinct from a generic icon, purely decorative (aria-hidden). Built from
 * the app's own existing categorical palette (globals.css's chart-analytics
 * and cycle tokens, already designed for exactly this "tell N categories
 * apart" job) rather than new hex values or an external image
 * generator: two colors per domain, one gradient background plus two soft
 * blurred circles for texture. The reproductive domain deliberately reuses
 * the same pink tones as the app's own menstrual-cycle tracking elsewhere.
 */
const DOMAIN_ART: Record<HealthDomainKey, { from: string; to: string; circle: string }> = {
  mind: { from: "var(--chart-analytics-4)", to: "var(--cycle-follicular)", circle: "#ffffff" },
  rhythm_recovery: { from: "var(--clinical-navy)", to: "var(--cycle-fertile)", circle: "#ffffff" },
  fitness: { from: "var(--brand-green)", to: "var(--sprout-gold)", circle: "#ffffff" },
  hormones: { from: "var(--cycle-luteal)", to: "var(--cycle-ovulation)", circle: "#ffffff" },
  inflammation: { from: "var(--chart-analytics-5)", to: "var(--sprout-gold)", circle: "#ffffff" },
  cardiovascular: { from: "var(--chart-analytics-5)", to: "var(--clinical-navy)", circle: "#ffffff" },
  metabolic: { from: "var(--sprout-gold)", to: "var(--brand-green)", circle: "#ffffff" },
  brain: { from: "var(--chart-analytics-4)", to: "var(--clinical-navy)", circle: "#ffffff" },
  reproductive: { from: "var(--cycle-period)", to: "var(--cycle-predicted)", circle: "#ffffff" },
};

export function HealthDomainArt({
  domainKey,
  className,
}: {
  domainKey: HealthDomainKey;
  className?: string;
}) {
  const art = DOMAIN_ART[domainKey];
  const gradientId = `health-domain-art-${domainKey}`;

  return (
    <svg
      viewBox="0 0 40 40"
      className={className}
      role="presentation"
      aria-hidden
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={art.from} />
          <stop offset="100%" stopColor={art.to} />
        </linearGradient>
        <filter id={`${gradientId}-blur`}>
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      <rect width="40" height="40" rx="10" fill={`url(#${gradientId})`} />
      <g filter={`url(#${gradientId}-blur)`} opacity="0.35">
        <circle cx="10" cy="12" r="9" fill={art.circle} />
        <circle cx="30" cy="30" r="7" fill={art.circle} />
      </g>
    </svg>
  );
}
