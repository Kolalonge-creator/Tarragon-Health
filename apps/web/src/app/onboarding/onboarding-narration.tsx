import { AUDIO_SCRIPTS, t } from "@tarragon/i18n";

/**
 * The seam for spoken help on a web onboarding screen (spec 1.12). The words come from the audio script table
 * (`@tarragon/i18n` AUDIO_SCRIPTS, the same text S32 shows when a clip cannot play). No recording exists yet and the web app
 * has no player, so this shows the words only and says so; when the S32 manifest has a signed-off recording and a web player
 * exists, this is the one place that gains a Listen button. It never plays anything on its own.
 */
export function OnboardingNarration({ clipId }: { clipId: string }) {
  const script = AUDIO_SCRIPTS[clipId]?.en;
  if (!script) return null;
  return (
    <details className="rounded-lg border border-charcoal-ink/10 bg-charcoal-ink/[0.02] px-3 py-2 text-sm text-charcoal-ink/80">
      <summary className="min-h-8 cursor-pointer text-xs font-medium text-brand-green">{t("onb.narration.title")}</summary>
      <p className="mt-2">{script}</p>
      <p className="mt-1 text-xs text-charcoal-ink/50">{t("onb.narration.no_audio")}</p>
    </details>
  );
}
