"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { DraftReviewPanel, type DraftSection } from "./draft-review-panel";
import { draftScribeFromText, getScribeConsentState, recordScribeConsent, revokeScribeConsent } from "@/lib/scribe/actions";
import { consentView, type ConsentView } from "@/lib/scribe/consent-state";
import type { DraftFields } from "@/lib/scribe/draft-review";
import { scribeErrorMessage } from "@/lib/scribe/error-messages";
import { MAX_TYPED_NOTES_CHARS, MIN_TYPED_NOTES_CHARS } from "@/lib/scribe/parse-typed-notes";

type Language = "en-NG" | "pcm";

type ScribeState =
  | { step: "checking" }
  | { step: "gate"; view: ConsentView }
  | { step: "gate_error" }
  | { step: "idle" }
  | { step: "input"; consentId: string }
  | { step: "generating"; consentId: string }
  | { step: "review"; consentId: string; draft: DraftSection; patientSummary: string; modelId: string; promptVersion: string }
  | { step: "used" }
  | { step: "revoked" }
  | { step: "error"; message: string; consentId?: string };

/** What the note form receives when the clinician chooses "Use in note". */
export interface ScribeDraftResult {
  draft: DraftSection;
  patientSummary: string;
  consentId: string;
  language: Language;
  /** The draft exactly as the model generated it, before the clinician edited anything (for the review record's hash and outcomes). */
  original: DraftFields;
  modelId: string;
  promptVersion: string;
  source: "stt" | "typed";
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
  const [state, setState] = useState<ScribeState>({ step: "checking" });
  const [language, setLanguage] = useState<Language>("en-NG");
  const [text, setText] = useState("");
  const [, startTransition] = useTransition();

  // The patient's own in-app answer decides whether the scribe can start. The clinician never answers for the patient.
  const fetchGate = useCallback(() => {
    getScribeConsentState(encounterNoteId)
      .then((s) => {
        const view = consentView(s);
        setState(view.kind === "can_start" ? { step: "idle" } : { step: "gate", view });
      })
      .catch(() => setState({ step: "gate_error" }));
  }, [encounterNoteId]);
  const loadGate = useCallback(() => {
    setState({ step: "checking" });
    fetchGate();
  }, [fetchGate]);
  // First load: the state already starts as "checking", so the effect only starts the read.
  useEffect(() => {
    fetchGate();
  }, [fetchGate]);

  function handleStart() {
    startTransition(async () => {
      try {
        // The database accepts this row only because the patient allowed it in the app (S21g); it is the audit record.
        const row = await recordScribeConsent({ patientId, encounterNoteId, granted: true, language });
        setState({ step: "input", consentId: row.id });
      } catch (err) {
        setState({ step: "error", message: scribeErrorMessage(err) });
      }
    });
  }

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
        setState({
          step: "review",
          consentId,
          draft: result.draft,
          patientSummary: result.patientSummary,
          modelId: typeof result.modelId === "string" ? result.modelId : "unknown",
          promptVersion: typeof result.promptVersion === "string" ? result.promptVersion : "unversioned",
        });
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
    case "checking":
      return <p className="text-sm text-charcoal-ink/60">{t("scribe.gate.checking", "en")}</p>;

    case "gate":
      return (
        <div className="space-y-2 rounded-md border border-charcoal-ink/15 p-3">
          <p role="status" className="text-sm text-charcoal-ink">{t(state.view.kind === "blocked" ? state.view.messageKey : "scribe.gate.checking", "en")}</p>
          <Button size="sm" variant="outline" onClick={loadGate}>{t("scribe.gate.refresh", "en")}</Button>
        </div>
      );

    case "gate_error":
      return (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-red-600">{t("scribe.gate.load_error", "en")}</p>
          <Button size="sm" variant="outline" onClick={loadGate}>{t("scribe.gate.refresh", "en")}</Button>
        </div>
      );

    case "idle":
      return (
        <div className="flex flex-wrap items-end gap-3">
          <p className="w-full text-xs text-brand-green">{t("scribe.gate.agreed", "en")}</p>
          <div>
            <Label>{t("scribe.language.label", "en")}</Label>
            <Select value={language} onChange={(e) => setLanguage(e.target.value as Language)}>
              <option value="en-NG">{t("scribe.language.en", "en")}</option>
              <option value="pcm">{t("scribe.language.pcm", "en")}</option>
            </Select>
          </div>
          <Button size="sm" variant="outline" onClick={handleStart}>
            {t("scribe.start", "en")}
          </Button>
        </div>
      );

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
            onUseDraft({
              draft,
              patientSummary,
              consentId,
              language,
              original: { ...state.draft, patientSummary: state.patientSummary },
              modelId: state.modelId,
              promptVersion: state.promptVersion,
              source: "typed",
            });
            setText("");
            setState({ step: "used" });
          }}
          onDiscard={() => {
            setText("");
            loadGate();
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
            <Button size="sm" variant="ghost" onClick={loadGate}>
              {t("scribe.draft.discard", "en")}
            </Button>
          </div>
        </div>
      );
  }
}
