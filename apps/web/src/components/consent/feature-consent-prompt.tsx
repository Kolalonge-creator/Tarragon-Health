"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { t, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { grantFeatureConsentAction } from "@/app/(dashboard)/patient/privacy/consent-matrix-actions";

export type FeatureConsentType = "reproductive" | "mental_health" | "device_data";

/**
 * The prompt shown the first time a person uses a feature that handles reproductive health, mental health or device data (S47). Wording is a PLACEHOLDER key
 * pending counsel (consent.feature.<type>.ask); nothing here is approved legal text. "Not now" records nothing and the feature stays off. The database refuses
 * the write without the yes (migration s47d), so this prompt is the friendly half of a rule that holds even if the prompt is skipped.
 */
export function FeatureConsentPrompt({ dataType }: { dataType: FeatureConsentType }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [declined, setDeclined] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (declined) {
    return (
      <Card variant="soft">
        <CardContent className="py-4 text-sm text-charcoal-ink/70 dark:text-night-ink/70">
          {t("consent.feature.declined")}
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">{t("consent.feature.ask_title")}</CardTitle>
        <CardDescription>{t(`consent.feature.${dataType}.ask` as MessageKey)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{t("consent.matrix.off_stops_feature_only")}</p>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await grantFeatureConsentAction({ dataType });
                if (result?.error) setError(result.error);
                else router.refresh();
              })
            }
          >
            {t("consent.feature.ask_allow")}
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => setDeclined(true)}>
            {t("consent.feature.ask_not_now")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
