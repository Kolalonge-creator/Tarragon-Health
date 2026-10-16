import { CRISIS_CARD_OFFLINE } from "@tarragon/shared";
import { t } from "@tarragon/i18n";

/**
 * Standing, always-visible support note for mental-health content (mirrors EmergencyNotice's calm, non-fear-based pattern). Shown
 * regardless of the wellbeing check's result, not gated behind a "low score": the check asks nothing about self-harm, so this is the
 * actual safety net.
 *
 * Founder decision 2026-10-07: there are no usable crisis helplines in Nigeria, so no helpline number appears anywhere. This note reads
 * the SAME copy as the in-app crisis card (the packages/i18n "crisis.*" strings and the bundled emergency number), so the two cannot
 * drift apart and no number is hard-coded here. The 112 wording is awaiting CMO approval (see crisis_card_config). Helplines can be
 * added later, in the card first and then here.
 */
export function MentalHealthSupportNotice({ className }: { className?: string }) {
  const number = CRISIS_CARD_OFFLINE.emergencyNumber;
  return (
    <div
      role="note"
      className={`mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50/70 px-6 py-5 text-center ${className ?? ""}`}
    >
      <p className="font-heading text-base font-semibold text-red-800">{t("crisis.open_card")}</p>
      <p className="mt-2 text-sm leading-relaxed text-charcoal-ink/75">
        {t("crisis.lead")} {t("crisis.hospital")}.{" "}
        <a href={`tel:${number}`} className="font-medium underline">
          {t("crisis.call", "en", { number })}
        </a>
        . {t("crisis.call_note")}
      </p>
    </div>
  );
}
