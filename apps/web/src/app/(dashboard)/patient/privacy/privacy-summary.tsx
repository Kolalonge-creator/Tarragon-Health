import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
 * is S32's, and Pidgin wording still needs a native reviewer (OQ-19).
 */
export function PrivacySummary({ locale }: { locale: Locale }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("privacy.summary.title", locale)}</CardTitle>
        <CardDescription>{t("privacy.summary.intro", locale)}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3 text-sm text-charcoal-ink/80 dark:text-night-ink/80">
          {PURPOSES.map((purpose) => (
            <li key={purpose}>{t(`privacy.purpose.${purpose}` as MessageKey, locale)}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
