"use client";

import { useState, useTransition } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recordScribeConsent } from "@/lib/scribe/actions";

interface ScribeConsentDialogProps {
  patientId: string;
  encounterNoteId?: string;
  language: "en-NG" | "pcm";
  onConsented: (consentId: string) => void;
  onDeclined: () => void;
}

function toLocale(lang: "en-NG" | "pcm"): Locale {
  return lang === "pcm" ? "pcm" : "en";
}

export function ScribeConsentDialog({
  patientId,
  encounterNoteId,
  language,
  onConsented,
  onDeclined,
}: ScribeConsentDialogProps) {
  const locale = toLocale(language);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleChoice(granted: boolean) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordScribeConsent({
          patientId,
          encounterNoteId,
          granted,
          language,
        });
        if (granted) {
          onConsented(result.id);
        } else {
          onDeclined();
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to record consent");
      }
    });
  }

  return (
    <Card className="border-tarragon-green/20">
      <CardHeader>
        <CardTitle className="text-base">{t("scribe.consent.title", locale)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/70">
          {t("scribe.consent.body", locale)}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Button
            size="sm"
            onClick={() => handleChoice(true)}
            disabled={pending}
          >
            {t("scribe.consent.agree", locale)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleChoice(false)}
            disabled={pending}
          >
            {t("scribe.consent.decline", locale)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
