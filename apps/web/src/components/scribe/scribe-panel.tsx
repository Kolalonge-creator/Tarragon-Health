"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScribeConsentDialog } from "./consent-dialog";
import { RecordingControls } from "./recording-controls";
import { DraftReviewPanel } from "./draft-review-panel";
import { callScribeDraft } from "@/lib/scribe/actions";

type ScribeState =
  | { step: "idle" }
  | { step: "consent" }
  | { step: "declined" }
  | { step: "recording"; consentId: string }
  | { step: "generating"; consentId: string }
  | { step: "review"; consentId: string; draft: DraftSection; patientSummary: string }
  | { step: "signed" }
  | { step: "revoked" }
  | { step: "error"; message: string; consentId?: string };

interface DraftSection {
  history: string;
  examination: string;
  assessment: string;
  plan: string;
  followUp: string;
}

interface ScribePanelProps {
  patientId: string;
  encounterNoteId: string;
  language: "en-NG" | "pcm";
  patientContext?: {
    age?: number;
    sex?: string;
    conditions?: readonly string[];
  };
}

export function ScribePanel({
  patientId,
  encounterNoteId,
  language,
  patientContext,
}: ScribePanelProps) {
  const [state, setState] = useState<ScribeState>({ step: "idle" });
  const [pending, startTransition] = useTransition();

  function handleStopRecording(consentId: string) {
    setState({ step: "generating", consentId });

    startTransition(async () => {
      try {
        // In a real implementation, the segments would come from the STT stream.
        // For now, this is wired to the edge function with a placeholder segments array.
        // The actual STT integration happens when OQ-96 resolves the vendor decision.
        const result = await callScribeDraft({
          scribeConsentId: consentId,
          encounterNoteId,
          segments: [],
          language,
          patientContext,
        });

        if (result.status === "disabled") {
          setState({ step: "error", message: t("scribe.unavailable", "en"), consentId });
          return;
        }

        setState({
          step: "review",
          consentId,
          draft: result.draft,
          patientSummary: result.patientSummary,
        });
      } catch (err) {
        setState({
          step: "error",
          message: err instanceof Error ? err.message : t("scribe.draft.failed", "en"),
          consentId,
        });
      }
    });
  }

  switch (state.step) {
    case "idle":
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => setState({ step: "consent" })}
        >
          {t("scribe.start", "en")}
        </Button>
      );

    case "consent":
      return (
        <ScribeConsentDialog
          patientId={patientId}
          encounterNoteId={encounterNoteId}
          language={language}
          onConsented={(consentId) => setState({ step: "recording", consentId })}
          onDeclined={() => setState({ step: "declined" })}
        />
      );

    case "declined":
      return (
        <Badge variant="outline" className="text-charcoal-ink/50">
          {t("scribe.consent.declined_label", "en")}
        </Badge>
      );

    case "recording":
      return (
        <RecordingControls
          consentId={state.consentId}
          language={language}
          onStop={() => handleStopRecording(state.consentId)}
          onRevoked={() => setState({ step: "revoked" })}
        />
      );

    case "generating":
      return (
        <div className="flex items-center gap-2 text-sm text-charcoal-ink/60">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-tarragon-green border-t-transparent" />
          {t("scribe.draft.generating", "en")}
        </div>
      );

    case "review":
      return (
        <DraftReviewPanel
          encounterNoteId={encounterNoteId}
          scribeConsentId={state.consentId}
          draft={state.draft}
          patientSummary={state.patientSummary}
          language={language}
          onSigned={() => setState({ step: "signed" })}
          onDiscard={() => setState({ step: "idle" })}
        />
      );

    case "signed":
      return (
        <p className="text-sm text-tarragon-green">{t("scribe.draft.saved", "en")}</p>
      );

    case "revoked":
      return (
        <Badge variant="outline" className="text-amber-600">
          {t("scribe.consent.revoked_label", "en")}
        </Badge>
      );

    case "error":
      return (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{state.message}</p>
          <Button size="sm" variant="outline" onClick={() => setState({ step: "idle" })}>
            {t("scribe.start", "en")}
          </Button>
        </div>
      );
  }
}
