import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OnboardingNarration } from "@/app/onboarding/onboarding-narration";

/** The purposes the summary explains, in the order a person meets them. Each key exists in every language. */
const PURPOSES = [
  "data_processing",
  "telehealth",
  "care_circle_sharing",
  "device_data",
  "wearable_device_data",
  "scribe_default",
  "research",
  "sponsor_reporting",
  "marketing",
] as const;

/**
 * Plain-language summary of what each consent means (v5 function 1.14). Text only for now: the audio for it (ONB-010)
 * is S32's.
 */
export function PrivacySummary({ locale }: { locale: Locale }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("privacy.summary.title", locale)}</CardTitle>
        <CardDescription>{t("privacy.summary.intro", locale)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{t("privacy.summary.matrix", locale)}</p>
        {/* Audio seam (spec 1.14): the words of the S32 script for this screen; no recording or player exists yet. */}
        <OnboardingNarration clipId="HLP-036" />
        {/* S47: account deletion anonymises and keeps the clinical record. The retention PERIOD is not decided, so the sentence says it is still to be confirmed. Wording is a placeholder pending counsel. */}
        <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {t("privacy.retention.statement", locale, { period: t("privacy.retention.period_unconfirmed", locale) })}
        </p>
        <ul className="space-y-3 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {PURPOSES.map((purpose) => (
            <li key={purpose}>{t(`privacy.purpose.${purpose}` as MessageKey, locale)}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
