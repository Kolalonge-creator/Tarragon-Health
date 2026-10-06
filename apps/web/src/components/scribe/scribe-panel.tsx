"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScribeConsentDialog } from "./consent-dialog";
import { DraftReviewPanel, type DraftSection } from "./draft-review-panel";
import { draftScribeFromText, revokeScribeConsent } from "@/lib/scribe/actions";
import { scribeErrorMessage } from "@/lib/scribe/error-messages";
import { MAX_TYPED_NOTES_CHARS, MIN_TYPED_NOTES_CHARS } from "@/lib/scribe/parse-typed-notes";

type Language = "en-NG" | "pcm";

type ScribeState =
  | { step: "idle" }
  | { step: "consent" }
  | { step: "declined" }
  | { step: "input"; consentId: string }
  | { step: "generating"; consentId: string }
  | { step: "review"; consentId: string; draft: DraftSection; patientSummary: string }
  | { step: "used" }
  | { step: "revoked" }
  | { step: "error"; message: string; consentId?: string };

/** What the note form receives when the clinician chooses "Use in note". */
export interface ScribeDraftResult {
  draft: DraftSection;
  patientSummary: string;
  consentId: string;
  language: Language;
}

interface ScribePanelProps {
  patientId: string;
  encounterNoteId: string;
  patientContext?: {
    age?: number;
    sex?: string;
    conditions?: string[];
  };
  onUseDraft: (result: ScribeDraftResult) => void;
}

export function ScribePanel({ patientId, encounterNoteId, patientContext, onUseDraft }: ScribePanelProps) {
  const [state, setState] = useState<ScribeState>({ step: "idle" });
  const [language, setLanguage] = useState<Language>("en-NG");
  const [text, setText] = useState("");
  const [, startTransition] = useTransition();

  function handleGenerate(consentId: string) {
    setState({ step: "generating", consentId });
    startTransition(async () => {
      try {
        const result = await draftScribeFromText({
          scribeConsentId: consentId,
          encounterNoteId,
          language,
          text,
          patientContext,
        });
        if (result.status === "disabled") {
          setState({ step: "error", message: t("scribe.unavailable", "en"), consentId });
          return;
        }
        setState({ step: "review", consentId, draft: result.draft, patientSummary: result.patientSummary });
      } catch (err) {
        setState({ step: "error", message: scribeErrorMessage(err), consentId });
      }
    });
  }

  async function handleRevoke(consentId: string) {
    try {
      await revokeScribeConsent(consentId);
      setText("");
      setState({ step: "revoked" });
    } catch (err) {
      setState({ step: "error", message: scribeErrorMessage(err), consentId });
    }
  }

  switch (state.step) {
    case "idle":
      return (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>{t("scribe.language.label", "en")}</Label>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="en-NG">{t("scribe.language.en", "en")}</option>
              <option value="pcm">{t("scribe.language.pcm", "en")}</option>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={() => setState({ step: "consent" })}>
            {t("scribe.start", "en")}
          </Button>
        </div>
      );

    case "consent":
      return (
        <ScribeConsentDialog
          patientId={patientId}
          encounterNoteId={encounterNoteId}
          language={language}
          onConsented={(consentId) => setState({ step: "input", consentId })}
          onDeclined={() => setState({ step: "declined" })}
        />
      );

    case "declined":
      return <Badge variant="grey">{t("scribe.consent.declined_label", "en")}</Badge>;

    case "input": {
      const tooShort = text.trim().length < MIN_TYPED_NOTES_CHARS;
      return (
        <div className="space-y-2 rounded-lg border border-tarragon-green/20 bg-tarragon-green/5 p-3">
          <p className="text-sm font-medium">{t("scribe.input.heading", "en")}</p>
          <Label>{t("scribe.input.label", "en")}</Label>
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_TYPED_NOTES_CHARS))}
            rows={8}
            placeholder={t("scribe.input.placeholder", "en")}
          />
          <p className="text-xs text-charcoal-ink/50">{t("scribe.input.help", "en")}</p>
          {text.length > 0 && tooShort && <p className="text-xs text-amber-700">{t("scribe.input.too_short", "en")}</p>}
          <div className="flex gap-2">
            <Button size="sm" disabled={tooShort} onClick={() => handleGenerate(state.consentId)}>
              {t("scribe.input.generate", "en")}
            </Button>
            <Button size="sm" variant="ghost" className="text-red-600" onClick={() => handleRevoke(state.consentId)}>
              {t("scribe.consent.revoked_label", "en")}
            </Button>
          </div>
        </div>
      );
    }

    case "generating":
      return (
        <div className="flex items-center gap-2 text-sm text-charcoal-ink/60">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-tarragon-green border-t-transparent" />
          {t("scribe.draft.generating", "en")}
        </div>
      );

    case "review": {
      const { consentId } = state;
      return (
        <DraftReviewPanel
          draft={state.draft}
          patientSummary={state.patientSummary}
          onUse={(draft, patientSummary) => {
            onUseDraft({ draft, patientSummary, consentId, language });
            setText("");
            setState({ step: "used" });
          }}
          onDiscard={() => {
            setText("");
            setState({ step: "idle" });
          }}
        />
      );
    }

    case "used":
      return <p className="text-sm text-tarragon-green">{t("scribe.draft.used", "en")}</p>;

    case "revoked":
      return <Badge variant="amber">{t("scribe.consent.revoked_label", "en")}</Badge>;

    case "error":
      return (
        <div className="space-y-2">
          <p className="text-sm text-red-600">{state.message}</p>
          <div className="flex gap-2">
            {state.consentId && (
              <Button size="sm" variant="outline" onClick={() => setState({ step: "input", consentId: state.consentId as string })}>
                {t("scribe.input.generate", "en")}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setState({ step: "idle" })}>
              {t("scribe.draft.discard", "en")}
            </Button>
          </div>
        </div>
      );
  }
}
