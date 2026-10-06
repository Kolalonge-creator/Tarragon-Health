"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { recordScribeConsent } from "@/lib/scribe/actions";

interface ScribeConsentDialogProps {
  patientId: string;
  encounterNoteId?: string;
  language: "en-NG";
  onConsented: (consentId: string) => void;
  onDeclined: () => void;
}

export function ScribeConsentDialog({
  patientId,
  encounterNoteId,
  language,
  onConsented,
  onDeclined,
}: ScribeConsentDialogProps) {
  const locale = "en" as const;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // S21g (OQ-161, INV-11): the patient's own answer in the app is the only consent. The clinician cannot give it for them, so this
  // control does not ask "do you agree": it starts the note-taker, and the database refuses unless the patient has already allowed it
  // for this live consultation (it then stamps the audit row). "Write the note myself" records nothing.
  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await recordScribeConsent({ patientId, encounterNoteId, granted: true, language });
        if (result.ok) onConsented(result.id);
        else setError(result.reason === "not_allowed" ? t("scribe.consent.not_allowed", locale) : t("scribe.consent.start_failed", locale));
      } catch {
        setError(t("scribe.consent.start_failed", locale));
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
          {t("scribe.consent.clinician_body", locale)}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-3">
          <Button size="sm" onClick={start} disabled={pending}>
            {t("scribe.consent.start", locale)}
          </Button>
          <Button size="sm" variant="outline" onClick={onDeclined} disabled={pending}>
            {t("scribe.consent.write_myself", locale)}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
