import { t, type MessageKey } from "@tarragon/i18n";

/**
 * Who stands behind a timeline item (S43, spec 2.1). The database derives the tier
 * (patient_timeline.trust_tier, set by a trigger, never trusted from a writer), so
 * this component only says it in plain words. A value read from a photo that the
 * person has not confirmed is shown in the amber attention colour, because it is a
 * suggestion, not a fact in the record.
 */
export const TRUST_TIERS = ["lab_pushed", "clinician", "device", "patient", "ocr_unconfirmed", "ocr_confirmed", "imported", "system"] as const;
export type TrustTier = (typeof TRUST_TIERS)[number];

export function isTrustTier(value: unknown): value is TrustTier {
  return typeof value === "string" && (TRUST_TIERS as readonly string[]).includes(value);
}

/** Exported so the rule is testable: only the unconfirmed-photo tier is flagged as needing attention. */
export function trustTierTone(tier: TrustTier): "attention" | "neutral" {
  return tier === "ocr_unconfirmed" ? "attention" : "neutral";
}

export function TimelineTrustTier({ tier }: { tier: string | null | undefined }) {
  if (!isTrustTier(tier)) return null;
  const tone = trustTierTone(tier);
  return (
    <p
      data-trust-tier={tier}
      className={
        tone === "attention"
          ? "text-xs font-medium text-amber-800 dark:text-amber-300"
          : "text-xs text-charcoal-ink/55 dark:text-night-ink/55"
      }
    >
      {t(`passport.tier.${tier}` as MessageKey)}
    </p>
  );
}
