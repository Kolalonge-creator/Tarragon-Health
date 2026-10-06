"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { signScribeDraft } from "@/lib/scribe/actions";

interface DraftSection {
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  followUp: string;
}

interface DraftReviewPanelProps {
  encounterNoteId: string;
  scribeConsentId: string;
  draft: DraftSection;
  patientSummary: string;
  language: "en-NG" | "pcm";
  onSigned: () => void;
  onDiscard: () => void;
}

export function DraftReviewPanel({
  encounterNoteId,
  scribeConsentId,
  draft,
  patientSummary,
  language,
  onSigned,
  onDiscard,
}: DraftReviewPanelProps) {
  const [fields, setFields] = useState({
    history: draft.history,
    examination: draft.examination,
    assessment: draft.assessment,
    plan: draft.plan,
    followUp: draft.followUp,
    patientSummary,
  });
  const [pending, startTransition] = useTransition();
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateField(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleSign() {
    setError(null);
    startTransition(async () => {
      try {
        await signScribeDraft({
          encounterNoteId,
          scribeConsentId,
          history: fields.history,
          examinationFindings: fields.examination,
          assessment: fields.assessment,
          plan: fields.plan,
          followUpInstructions: fields.followUp,
          patientSummary: fields.patientSummary,
          patientSummaryLanguage: language,
        });
        setSigned(true);
        onSigned();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign draft");
      }
    });
  }

  if (signed) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-sm text-tarragon-green">{t("scribe.draft.saved", "en")}</p>
        </CardContent>
      </Card>
    );
  }

  const sections: Array<{ key: keyof typeof fields; label: string }> = [
    { key: "history", label: t("scribe.draft.history", "en") },
    { key: "examination", label: t("scribe.draft.examination", "en") },
    { key: "assessment", label: t("scribe.draft.assessment", "en") },
    { key: "plan", label: t("scribe.draft.plan", "en") },
    { key: "followUp", label: t("scribe.draft.follow_up", "en") },
    { key: "patientSummary", label: t("scribe.draft.patient_summary", "en") },
  ];

  return (
    <Card className="border-amber-300/40">
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{t("scribe.draft.heading", "en")}</CardTitle>
          <Badge variant="outline" className="border-amber-400 text-amber-600">Draft</Badge>
        </div>
        <p className="text-xs text-charcoal-ink/50">
          {t("scribe.draft.disclaimer", "en")}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {sections.map(({ key, label }) => (
          <div key={key}>
            <Label>{label}</Label>
            <Textarea
              value={fields[key]}
              onChange={(e) => updateField(key, e.target.value)}
              disabled={pending}
              rows={key === "patientSummary" ? 4 : 3}
            />
          </div>
        ))}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button size="sm" onClick={handleSign} disabled={pending}>
            {pending ? t("scribe.draft.signing", "en") : t("scribe.draft.sign", "en")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDiscard}
            disabled={pending}
          >
            Discard
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
